import { Router } from 'express';
import { z } from 'zod';
import { addDays, hospitalDayStart, isoDay, toHospitalDate, utcDay } from '../careplans/dates.js';
import { Admission } from '../models/Admission.js';
import { Arrival } from '../models/Arrival.js';
import { Patient } from '../models/Patient.js';
import { PharmacyInvoice } from '../models/Pharmacy.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { desk, today } from '../pharmacy/pharmacyHttp.js';
import { invoiceTotals } from '../pharmacy/pharmacyService.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { escapeRegex, parse, requiredDateOnly } from '../utils/validate.js';

// The pharmacy's daily register (owner, 26 Oct 2026): the pharmacist sees only the day's patients who need the
// pharmacy – never the whole patient list:
//  - GET /api/pharmacy/register?date=   OPD (arrived that day, or a prescription written that day), IPD (in hospital
//                                       that day) and External (walk-in customers billed that day), with what the
//                                       pharmacy has done for each
//  - GET /api/pharmacy/register/find?q= someone from another day: by her exact patient number or her phone number
//                                       (and earlier walk-in bills by phone) – audited
// Names, numbers, phones, ward and bed only; nothing medical. The pharmacist only (the admin sees no patient data).

export const pharmacyRegisterRouter = Router();

pharmacyRegisterRouter.use((req, _res, next) => {
  desk(req);
  next();
});

const identity = (p) => ({ id: String(p._id), fullName: p.fullName, mrn: p.mrn, phone: p.phone ?? '' });
const billOf = (inv) => ({ id: String(inv._id), number: inv.number, netPaise: invoiceTotals(inv).netPaise });

pharmacyRegisterRouter.get('/', async (req, res) => {
  const q = parse(z.object({ date: requiredDateOnly('Date').optional() }).strict(), req.query);
  const t = today(req);
  const day = q.date ? utcDay(q.date) : utcDay(t);
  if (day > utcDay(t)) throw new HttpError(400, 'The register is for today or an earlier day.', 'VALIDATION_ERROR');
  const isToday = day.getTime() === utcDay(t).getTime();
  const start = hospitalDayStart(day);
  const end = hospitalDayStart(addDays(day, 1));

  const [arrivals, visits, stays, invoices] = await Promise.all([
    Arrival.find({ tenantId: req.tenantId, on: day }, { patientId: 1, at: 1, opdNo: 1 }).lean(),
    Visit.find({ tenantId: req.tenantId, visitOn: day, status: 'active', 'prescription.items.0': { $exists: true } }, { patientId: 1, 'prescription.by': 1, createdAt: 1 }).lean(),
    Admission.find(
      isToday ? { tenantId: req.tenantId, status: 'admitted' } : { tenantId: req.tenantId, admittedAt: { $lt: end }, $or: [{ status: 'admitted' }, { dischargedAt: { $gte: start } }] },
      { patientId: 1, ward: 1, bed: 1, admittedAt: 1, status: 1 },
    ).lean(),
    PharmacyInvoice.find({ tenantId: req.tenantId, 'created.at': { $gte: start, $lt: end } }).sort({ 'created.at': 1 }).lean(),
  ]);

  const ids = [...new Set([...arrivals, ...visits, ...stays].map((x) => String(x.patientId)))];
  const patients = new Map((await Patient.find({ tenantId: req.tenantId, _id: { $in: ids } }, { fullName: 1, mrn: 1, phone: 1, assignedDoctor: 1 }).lean()).map((p) => [String(p._id), p]));
  const doctorIds = [...visits.map((v) => v.prescription?.by), ...[...patients.values()].map((p) => p.assignedDoctor)].filter(Boolean);
  const doctors = new Map((await User.find({ _id: { $in: doctorIds } }, { name: 1 }).lean()).map((u) => [String(u._id), u.name]));
  const billsFor = (patientId, kind) => invoices.filter((i) => String(i.patientId) === patientId && i.kind === kind).map(billOf);

  // OPD: everyone who arrived that day or had a prescription written that day, in the order they came
  const opd = new Map();
  for (const a of arrivals) opd.set(String(a.patientId), { at: a.at, opdNo: a.opdNo ?? '', rxBy: null, rx: false, rxVisit: null });
  // The day's latest prescription is the one "Bill the prescription" puts on the bill
  for (const v of [...visits].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) {
    const row = opd.get(String(v.patientId)) ?? { at: v.createdAt, opdNo: '', rxBy: null, rx: false, rxVisit: null };
    opd.set(String(v.patientId), { ...row, rx: true, rxBy: v.prescription?.by ?? row.rxBy, rxVisit: String(v._id) });
  }
  const opdRows = [...opd.entries()]
    .filter(([pid]) => patients.has(pid))
    .map(([pid, r]) => {
      const p = patients.get(pid);
      const bills = billsFor(pid, 'sale');
      const doctorId = r.rxBy ?? p.assignedDoctor;
      return {
        type: 'opd',
        patient: identity(p),
        at: r.at,
        opdNo: r.opdNo,
        doctor: doctorId ? (doctors.get(String(doctorId)) ?? '') : '',
        prescription: r.rx,
        prescriptionVisitId: r.rxVisit,
        bills,
        status: bills.length ? 'billed' : r.rx ? 'rx_waiting' : 'no_rx',
      };
    })
    .sort((a, b) => new Date(a.at) - new Date(b.at));

  // IPD: in hospital that day (today: admitted now), newest admission first
  const ipdRows = stays
    .filter((s) => patients.has(String(s.patientId)))
    .sort((a, b) => b.admittedAt - a.admittedAt)
    .map((s) => {
      const pid = String(s.patientId);
      const bills = billsFor(pid, 'issue');
      return { type: 'ipd', patient: identity(patients.get(pid)), at: s.admittedAt, ward: s.ward ?? '', bed: s.bed ?? '', discharged: s.status === 'discharged', bills, status: bills.length ? 'issued' : 'not_issued' };
    });

  // External: walk-in customers billed that day (no Perinexa record – their name and phone are on the bill only)
  const externalRows = invoices
    .filter((i) => !i.patientId)
    .map((i) => ({ type: 'external', customer: { name: i.customer?.name ?? i.buyer?.name ?? '', phone: i.customer?.phone ?? '' }, at: i.created.at, bills: [billOf(i)], status: 'billed' }));

  res.json({
    date: isoDay(day),
    today: isoDay(t),
    counts: { opd: opdRows.length, ipd: ipdRows.length, external: externalRows.length },
    rows: [...opdRows, ...ipdRows, ...externalRows],
  });
});

// Someone who is not on today's register: her exact patient number, or her phone number (the last 10 digits).
pharmacyRegisterRouter.get('/find', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().min(3, 'Type her patient number or phone number.').max(40) }).strict(), req.query);
  const digits = q.replace(/\D/g, '');
  const byPhone = digits.length >= 10 && !/[a-z]/i.test(q);
  // the last 10 digits, however the number was written (+91, spaces, dashes)
  const phoneRx = byPhone ? new RegExp(`${digits.slice(-10).split('').join('\\D*')}\\D*$`) : null;
  const found = await Patient.find({ tenantId: req.tenantId, ...(byPhone ? { phone: phoneRx } : { mrn: new RegExp(`^${escapeRegex(q)}$`, 'i') }) }, { fullName: 1, mrn: 1, phone: 1 })
    .sort({ fullName: 1 })
    .limit(10)
    .lean();
  const admitted = new Set((await Admission.find({ tenantId: req.tenantId, status: 'admitted', patientId: { $in: found.map((p) => p._id) } }, { patientId: 1 }).lean()).map((s) => String(s.patientId)));
  // Earlier walk-in bills to that phone number
  const walkIns = byPhone ? await PharmacyInvoice.find({ tenantId: req.tenantId, patientId: null, 'customer.phone': phoneRx }).sort({ 'created.at': -1 }).limit(10).lean() : [];
  await audit(req, 'PHARMACY_PATIENT_LOOKED_UP', { details: { by: byPhone ? 'phone' : 'number', patientIds: found.map((p) => String(p._id)), walkInBills: walkIns.length } });
  res.json({
    patients: found.map((p) => ({ ...identity(p), admitted: admitted.has(String(p._id)) })),
    external: walkIns.map((i) => ({ customer: { name: i.customer?.name ?? '', phone: i.customer?.phone ?? '' }, at: i.created.at, date: isoDay(toHospitalDate(i.created.at)), bills: [billOf(i)] })),
  });
});
