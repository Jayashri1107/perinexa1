// Lists as Excel-ready CSV files (21 Oct 2026): /api/exports/:what?from=YYYY-MM-DD&to=YYYY-MM-DD
//   patients      her doctor's own patients (registered in the dates, or all of them without dates)
//   appointments  the doctor's own appointments on those days
//   admissions    stays of the doctor's own patients admitted in those days
//   lab           lab orders of the doctor's own patients – the tests (HIV under its neutral name) and the status, never
//                 the results
//   scans         scans of the doctor's own patients – the study and the status, never the report
//   referrals     referrals received in those days for which this doctor is the consultant
// An export shows exactly what the person may already see (developer, 21 Oct 2026): doctors, their OWN patients. A
// hospital admin with no clinical role sees no patient data in Perinexa1 (utils/patientAccess.js), so has no export;
// an admin who is also a doctor exports as that doctor. A super admin or platform admin who opened a hospital's setup
// has none either (a super admin who is a doctor switches to their doctor account). Every file is in the audit log:
// what, the dates and the number of rows – never a name.
import { Router } from 'express';
import { z } from 'zod';
import { addDays, hospitalDayStart, hospitalToday, isoDay, toHospitalDate, utcDay } from '../careplans/dates.js';
import { STUDIES } from '../imaging/templates.js';
import { shownName } from '../lab/labSetup.js';
import { Admission } from '../models/Admission.js';
import { Appointment } from '../models/Appointment.js';
import { ImagingOrder } from '../models/ImagingOrder.js';
import { LabOrder } from '../models/LabOrder.js';
import { hasRole } from '../models/Membership.js';
import { Patient, currentAge } from '../models/Patient.js';
import { Referral } from '../models/Referral.js';
import { ReferringDoctor } from '../models/ReferringDoctor.js';
import { audit } from '../utils/audit.js';
import { toCsv } from '../utils/csv.js';
import { HttpError } from '../utils/httpError.js';
import { parse, requiredDateOnly } from '../utils/validate.js';

export const EXPORTS = {
  patients: 'patients',
  appointments: 'appointments',
  admissions: 'admissions',
  lab: 'lab-orders',
  scans: 'scans',
  referrals: 'referrals',
};
export const EXPORT_MAX_DAYS = 366;
export const EXPORT_MAX_ROWS = 20_000;

const CARE_TYPE_WORDS = { antenatal: 'Antenatal', postnatal: 'Postnatal', infertility: 'Infertility', gynaecology: 'Gynaecology', abortion: 'Abortion (pregnancy loss)', newborn: 'Newborn' };
const VISIT_WORDS = { new: 'New', follow_up: 'Follow-up', scan: 'Scan', other: 'Other' };
const SOURCE_WORDS = { booked: 'Booked', next_visit: 'Next visit', walk_in: 'Walk-in', portal: 'Patient portal' };
const LAB_STATUS_WORDS = { ordered: 'Ordered', collected: 'Sample collected', entered: 'Results entered', reported: 'Reported', reviewed: 'Reviewed by doctor', cancelled: 'Cancelled' };
const SCAN_STATUS_WORDS = { ordered: 'Ordered', scheduled: 'Scheduled', done: 'Done', signed: 'Report signed', cancelled: 'Cancelled' };
const word = (v) => (v ? `${v[0].toUpperCase()}${v.slice(1)}` : '');
const day = (d) => isoDay(d) ?? '';
const hospitalDay = (instant) => (instant ? isoDay(toHospitalDate(instant)) : '');

export const exportsRouter = Router();

/** Who may export, and as whom: a hospital doctor (their own patients). */
function exporter(req) {
  if (req.membership?.platform) throw new HttpError(403, 'Exports are made by the hospital’s doctors. To export your own patients, switch to your doctor account.', 'FORBIDDEN');
  if (!hasRole(req.membership, 'doctor')) throw new HttpError(403, 'Exports are for doctors – of their own patients. A hospital admin sees no patient data, so has no export.', 'FORBIDDEN');
  return req.user._id;
}

const rangeSchema = z
  .object({ from: requiredDateOnly('From'), to: requiredDateOnly('To') })
  .refine((q) => q.to >= q.from, { path: ['to'], message: 'The end date is before the start date.' })
  .refine((q) => (q.to - q.from) / 86_400_000 < EXPORT_MAX_DAYS, { path: ['to'], message: `At most ${EXPORT_MAX_DAYS} days in one file.` });
const optionalRange = z.object({ from: requiredDateOnly('From').optional(), to: requiredDateOnly('To').optional() });

/** [start, end) instants of the hospital days from..to (dates from the browser are the hospital's days). */
const instants = ({ from, to }) => ({ $gte: hospitalDayStart(from), $lt: hospitalDayStart(addDays(to, 1)) });

/** The doctor's own patients' ids (her assigned doctor). */
const ownPatientIds = async (tenantId, doctorId) => (await Patient.find({ tenantId, assignedDoctor: doctorId }, { _id: 1 }).lean()).map((p) => p._id);
/** Patient number, name and phone of these patients, by id. */
async function identities(tenantId, ids) {
  const rows = await Patient.find({ tenantId, _id: { $in: ids } }, { mrn: 1, fullName: 1, phone: 1 }).lean();
  return new Map(rows.map((p) => [String(p._id), p]));
}
const tooMany = (n) => {
  if (n > EXPORT_MAX_ROWS) throw new HttpError(400, `More than ${EXPORT_MAX_ROWS.toLocaleString('en-IN')} rows: choose fewer days.`, 'TOO_MANY_ROWS');
};

const builders = {
  async patients(req, doctorId, q) {
    const filter = { tenantId: req.tenantId, assignedDoctor: doctorId };
    if (q.from || q.to) filter.createdAt = instants({ from: q.from ?? new Date('2000-01-01T00:00:00Z'), to: q.to ?? hospitalToday(req.now ?? new Date()) });
    tooMany(await Patient.countDocuments(filter));
    const list = await Patient.find(filter, { mrn: 1, fullName: 1, phone: 1, careType: 1, ageYears: 1, ageRecordedOn: 1, createdAt: 1, lastVisitOn: 1, death: 1, duplicateOf: 1 }).sort({ createdAt: 1 }).lean();
    const now = req.now ?? new Date();
    return [
      ['Patient number', 'Name', 'Age', 'Phone', 'Type of care', 'Registered on', 'Last visit', 'Record'],
      ...list.map((p) => [p.mrn, p.fullName, currentAge(p, now) ?? '', p.phone, CARE_TYPE_WORDS[p.careType] ?? p.careType, hospitalDay(p.createdAt), day(p.lastVisitOn), p.duplicateOf ? `Duplicate of ${p.duplicateOf.mrn}` : p.death ? 'Closed' : 'Open']),
    ];
  },

  async appointments(req, doctorId, q) {
    const filter = { tenantId: req.tenantId, doctorId, on: { $gte: utcDay(q.from), $lte: utcDay(q.to) } };
    tooMany(await Appointment.countDocuments(filter));
    const list = await Appointment.find(filter).sort({ on: 1, start: 1, token: 1 }).lean();
    const who = await identities(req.tenantId, list.map((a) => a.patientId).filter(Boolean));
    return [
      ['Date', 'Time', 'Token', 'Patient number', 'Name', 'Phone', 'Visit type', 'Booked through', 'Status'],
      ...list.map((a) => {
        const p = a.patientId ? who.get(String(a.patientId)) : null;
        const status = a.status === 'cancelled' ? 'Cancelled' : a.done ? 'Seen' : 'Booked';
        return [day(a.on), a.start ?? '', a.token ?? '', p?.mrn ?? '', p?.fullName ?? a.guest?.name ?? '', p?.phone ?? a.guest?.phone ?? '', VISIT_WORDS[a.visitType] ?? a.visitType, SOURCE_WORDS[a.source] ?? a.source, status];
      }),
    ];
  },

  async admissions(req, doctorId, q) {
    const filter = { tenantId: req.tenantId, patientId: { $in: await ownPatientIds(req.tenantId, doctorId) }, admittedAt: instants(q) };
    tooMany(await Admission.countDocuments(filter));
    const list = await Admission.find(filter, { patientId: 1, ipdNo: 1, admittedAt: 1, dischargedAt: 1, ward: 1, bed: 1, status: 1, admissionType: 1, careType: 1 }).sort({ admittedAt: 1 }).lean();
    const who = await identities(req.tenantId, list.map((a) => a.patientId));
    const now = req.now ?? new Date();
    return [
      ['IPD number', 'Patient number', 'Name', 'Type of care', 'Admitted on', 'Admission', 'Ward', 'Bed', 'Status', 'Discharged on', 'Days'],
      ...list.map((a) => {
        const p = who.get(String(a.patientId));
        const days = Math.max(1, Math.ceil(((a.dischargedAt ?? now) - a.admittedAt) / 86_400_000));
        return [a.ipdNo ?? '', p?.mrn ?? '', p?.fullName ?? '', CARE_TYPE_WORDS[a.careType] ?? a.careType, hospitalDay(a.admittedAt), word(a.admissionType?.replace('_', ' ')), a.ward, a.bed, a.status === 'discharged' ? 'Discharged' : 'Admitted', hospitalDay(a.dischargedAt), days];
      }),
    ];
  },

  async lab(req, doctorId, q) {
    const filter = { tenantId: req.tenantId, patientId: { $in: await ownPatientIds(req.tenantId, doctorId) }, 'ordered.at': instants(q) };
    tooMany(await LabOrder.countDocuments(filter));
    const list = await LabOrder.find(filter, { patientId: 1, sampleNo: 1, status: 1, urgent: 1, 'ordered.at': 1, 'ordered.byName': 1, 'tests.key': 1, 'tests.name': 1 }).sort({ 'ordered.at': 1 }).lean();
    const who = await identities(req.tenantId, list.map((o) => o.patientId));
    return [
      ['Ordered on', 'Sample number', 'Patient number', 'Name', 'Tests', 'Urgent', 'Status', 'Ordered by'],
      ...list.map((o) => {
        const p = who.get(String(o.patientId));
        return [hospitalDay(o.ordered?.at), o.sampleNo ?? '', p?.mrn ?? '', p?.fullName ?? '', (o.tests ?? []).map(shownName).join('; '), o.urgent ? 'Yes' : 'No', LAB_STATUS_WORDS[o.status] ?? o.status, o.ordered?.byName ?? ''];
      }),
    ];
  },

  async scans(req, doctorId, q) {
    const filter = { tenantId: req.tenantId, patientId: { $in: await ownPatientIds(req.tenantId, doctorId) }, 'ordered.at': instants(q) };
    tooMany(await ImagingOrder.countDocuments(filter));
    const list = await ImagingOrder.find(filter, { patientId: 1, study: 1, status: 1, urgent: 1, scheduledFor: 1, 'ordered.at': 1, 'ordered.byName': 1, 'signed.byName': 1 }).sort({ 'ordered.at': 1 }).lean();
    const who = await identities(req.tenantId, list.map((o) => o.patientId));
    const studies = new Map(STUDIES.map((s) => [s.key, s.name]));
    return [
      ['Ordered on', 'Patient number', 'Name', 'Study', 'Urgent', 'Scheduled for', 'Status', 'Ordered by', 'Signed by'],
      ...list.map((o) => {
        const p = who.get(String(o.patientId));
        return [hospitalDay(o.ordered?.at), p?.mrn ?? '', p?.fullName ?? '', studies.get(o.study) ?? o.study, o.urgent ? 'Yes' : 'No', hospitalDay(o.scheduledFor), SCAN_STATUS_WORDS[o.status] ?? o.status, o.ordered?.byName ?? '', o.signed?.byName ?? ''];
      }),
    ];
  },

  async referrals(req, doctorId, q) {
    const filter = { tenantId: req.tenantId, consultantId: doctorId, receivedAt: instants(q) };
    tooMany(await Referral.countDocuments(filter));
    const list = await Referral.find(filter, { number: 1, receivedAt: 1, urgency: 1, status: 1, via: 1, patientId: 1, guest: 1, referringDoctorId: 1 }).sort({ receivedAt: 1 }).lean();
    const who = await identities(req.tenantId, list.map((r) => r.patientId).filter(Boolean));
    const doctors = await ReferringDoctor.find({ tenantId: req.tenantId, _id: { $in: list.map((r) => r.referringDoctorId) } }, { name: 1 }).lean();
    const byId = new Map(doctors.map((d) => [String(d._id), d.name]));
    return [
      ['Referral number', 'Received on', 'Referred by', 'Patient number', 'Name', 'Urgency', 'Status'],
      ...list.map((r) => {
        const p = r.patientId ? who.get(String(r.patientId)) : null;
        return [r.number, hospitalDay(r.receivedAt), byId.get(String(r.referringDoctorId)) ?? '', p?.mrn ?? '', p?.fullName ?? r.guest?.name ?? '', word(r.urgency), word(r.status)];
      }),
    ];
  },
};

exportsRouter.get('/:what', async (req, res) => {
  const what = String(req.params.what);
  if (!Object.hasOwn(EXPORTS, what)) throw new HttpError(404, 'There is no such export.', 'NOT_FOUND');
  const doctorId = exporter(req);
  const q = parse(what === 'patients' ? optionalRange : rangeSchema, { from: req.query.from || undefined, to: req.query.to || undefined });
  const rows = await builders[what](req, doctorId, q);
  const count = rows.length - 1;
  await audit(req, 'LIST_EXPORTED', { details: { what, rows: count, from: isoDay(q.from), to: isoDay(q.to), own: true } });
  const range = q.from ? `-${isoDay(q.from)}-to-${isoDay(q.to ?? hospitalToday(req.now ?? new Date()))}` : '';
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="perinexa-${EXPORTS[what]}${range}.csv"`);
  res.set('Cache-Control', 'no-store');
  res.send(toCsv(rows));
});
