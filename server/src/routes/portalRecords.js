import { Router } from 'express';
import { labRecord, mentionsConfidential, sharedTests, visitRecord, withPatientRules } from '../abdm/shareRules.js';
import { CONFIDENTIAL_NAME } from '../billing/billingRules.js';
import { totals } from '../billing/money.js';
import { addDays, hospitalToday, isoDay } from '../careplans/dates.js';
import { testByKey } from '../lab/labTests.js';
import { nextAppointment, statesFor, statusOf } from '../appointments/appointmentService.js';
import { Appointment } from '../models/Appointment.js';
import { Bill } from '../models/Bill.js';
import { PatientAccount } from '../models/PatientAccount.js';
import { LabOrder } from '../models/LabOrder.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { designFor } from '../visits/designs.js';
import { portalAudit, portalSession } from './portal.js';
import { letterheadFor } from './settings.js';

// Her own records in the patient portal (docs/PATIENT_SIGNUP_PLAN.md, approved 16 Oct 2026). The rule: she sees
// online only what she has already been given on paper, and only once it is final – the same rules as sharing
// through ABHA (abdm/shareRules.js):
//  - prescriptions and visits: signed visits only, as the printed prescription shows them (the prescribing doctor's
//    print design decides what is shown – the owner chose "online = paper" for the diagnosis); never the private
//    note, the medicine-safety reasons, the AI check, additions, or a visit that mentions HIV;
//  - lab reports: only after a doctor reviewed them (the owner chose "reviewed = ready"); HIV tests left out, a report
//    that mentions HIV not shown;
//  - bills: not cancelled; a line whose name mentions HIV shows the neutral name; no staff names, no insurance;
//  - a record marked sensitive shows nothing (and HIV among her conditions: no visit), as for ABHA.
// Her session (routes/portal.js) proves this record only. Every page opened is in the audit log (ids only).

export const portalRecordsRouter = Router(); // /api/portal/records

const LIMIT = 100; // the newest 100 of each kind

const viewed = (req, access, kind) => portalAudit(req, 'PORTAL_RECORDS_VIEWED', access, { kind });

// ---------- Prescriptions and visits ----------

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj?.[k] !== undefined && obj?.[k] !== null && obj?.[k] !== '').map((k) => [k, obj[k]]));
const EXAMINATION = ['examination', 'fundalHeightCm', 'fetalHeartRate', 'presentation', 'fetalMovements', 'oedema'];

/** The parts of a signed visit the prescribing doctor's design prints – nothing else leaves the server. */
function printedParts(visit, show) {
  const d = visit.details ?? {};
  const details = {
    ...(show.complaints ? pick(d, ['complaints']) : {}),
    ...(show.examination ? pick(d, EXAMINATION) : {}),
    ...(show.diagnosis ? pick(d, ['diagnosis']) : {}),
    ...(show.investigations ? pick(d, ['investigations']) : {}),
    ...(show.advice ? pick(d, ['advice']) : {}),
    ...(show.nextVisit ? pick(d, ['nextVisitOn', 'nextVisitNote']) : {}),
  };
  const vitals = show.vitals ? pick(visit.vitals ?? {}, Object.keys(visit.vitals ?? {}).filter((k) => !['by', 'byName', 'at', 'rev'].includes(k))) : {};
  return { details, vitals };
}

async function prescribers(tenant, visits) {
  const ids = [...new Set(visits.map((v) => String(v.prescription?.by ?? v.details?.by ?? v.signed?.by ?? '')).filter(Boolean))];
  const users = new Map((await User.find({ _id: { $in: ids } }, { name: 1, professional: 1 }).lean()).map((u) => [String(u._id), u]));
  const out = new Map();
  for (const id of ids) {
    const u = users.get(id);
    const p = u?.professional ?? {};
    out.set(id, {
      doctor: { name: u?.name ?? '', professional: { qualification: p.qualification ?? '', registrationNumber: p.registrationNumber ?? '', council: p.council ?? '' } },
      design: await designFor(tenant, id),
    });
  }
  return out;
}

/** Her signed visits that may be shown (lean), newest first. */
async function readyVisitDocs(access, patient) {
  if (patient.sensitive) return [];
  const visits = await Visit.find({ tenantId: access.tenantId, patientId: patient._id, status: 'active', signed: { $ne: null } }).sort({ visitOn: -1, createdAt: -1 }).limit(LIMIT).lean();
  return visits.filter((v) => withPatientRules(patient, visitRecord(v)).state === 'ready');
}

/** Her signed visits that may be shown, newest first, each with what its paper copy shows. */
async function readyVisits(access, patient, tenant) {
  const ready = await readyVisitDocs(access, patient);
  const by = await prescribers(tenant, ready);
  return ready.map((v) => {
    const who = by.get(String(v.prescription?.by ?? v.details?.by ?? v.signed?.by ?? '')) ?? { doctor: { name: v.signed?.byName ?? '', professional: {} }, design: null };
    const { details, vitals } = printedParts(v, who.design?.show ?? {});
    return {
      id: String(v._id),
      visitOn: v.visitOn,
      doctor: who.doctor,
      design: who.design,
      details,
      vitals,
      items: (v.prescription?.items ?? []).map(({ _id, ...it }) => ({ id: String(_id), ...it })), // as the staff pages get them
      notes: v.prescription?.notes ?? '',
    };
  });
}

/** What the printout needs of her (her own details, as on her paper copy). */
function patientView(patient) {
  const p = patient.toJSON();
  return { fullName: p.fullName, mrn: p.mrn, careType: p.careType, currentAge: p.currentAge ?? null, newborn: p.newborn?.birthAt ? { birthAt: p.newborn.birthAt } : null, medical: { allergies: p.medical?.allergies ?? '' } };
}

portalRecordsRouter.get('/visits', async (req, res) => {
  const { access, patient, tenant } = await portalSession(req, res);
  const visits = await readyVisits(access, patient, tenant);
  await viewed(req, access, 'visits');
  res.json({ letterhead: letterheadFor(tenant), patient: patientView(patient), visits });
});

portalRecordsRouter.get('/prescriptions', async (req, res) => {
  const { access, patient, tenant } = await portalSession(req, res);
  const visits = (await readyVisits(access, patient, tenant)).filter((v) => v.items.length);
  await viewed(req, access, 'prescriptions');
  res.json({ letterhead: letterheadFor(tenant), patient: patientView(patient), visits });
});

// ---------- Lab reports ----------

function testView(t) {
  const known = testByKey.get(t.key);
  const fields = new Map((known?.fields ?? []).map((f) => [f.key, f]));
  return {
    name: t.name,
    values: (t.values ?? [])
      .filter((v) => String(v.value ?? '').trim())
      .map((v) => {
        const f = fields.get(v.key);
        // The words saved with the result (the range that applied to her, a test of the hospital's own) come first
        return { name: v.name ?? f?.name ?? v.key, value: v.value, unit: v.unit ?? f?.unit ?? '', range: v.range ?? f?.range ?? '', flag: v.flag ?? '' };
      }),
    text: t.text ?? '',
  };
}

/** Her lab reports that may be shown (lean), newest first: reviewed by a doctor, within the sharing rules. */
async function readyLabOrders(access, patient) {
  if (patient.sensitive) return [];
  const orders = await LabOrder.find({ tenantId: access.tenantId, patientId: patient._id, status: 'reviewed' }).sort({ createdAt: -1 }).limit(LIMIT).lean();
  return orders.filter((o) => withPatientRules(patient, labRecord(o)).state === 'ready');
}

portalRecordsRouter.get('/lab', async (req, res) => {
  const { access, patient, tenant } = await portalSession(req, res);
  let reports = [];
  if (!patient.sensitive) {
    reports = (await readyLabOrders(access, patient))
      .map((o) => ({ id: String(o._id), reportedAt: o.reported?.at ?? null, collectedAt: o.collected?.at ?? null, tests: sharedTests(o).map(testView), labNote: o.labNote ?? '' }));
  }
  await viewed(req, access, 'lab');
  res.json({ letterhead: letterheadFor(tenant), patient: patientView(patient), reports });
});

// ---------- Bills ----------

const lineName = (l) => (mentionsConfidential([l.name, l.key]) ? CONFIDENTIAL_NAME : l.name);

portalRecordsRouter.get('/bills', async (req, res) => {
  const { access, patient, tenant } = await portalSession(req, res);
  const bills = await Bill.find({ tenantId: access.tenantId, patientId: patient._id, status: 'open' }).sort({ on: -1 }).limit(LIMIT).lean();
  await viewed(req, access, 'bills');
  res.json({
    letterhead: letterheadFor(tenant),
    patient: { fullName: patient.fullName, mrn: patient.mrn },
    bills: bills.map((b) => {
      const t = totals(b);
      return {
        id: String(b._id),
        number: b.number,
        kind: b.kind,
        date: isoDay(b.on),
        totals: t,
        lines: (b.lines ?? []).filter((l) => !l.removed).map((l) => ({ name: lineName(l), qty: l.qty, ratePaise: l.ratePaise, amountPaise: l.amountPaise })),
        payments: (b.payments ?? []).map((p) => ({ receipt: p.receipt, kind: p.kind, mode: p.mode, amountPaise: p.amountPaise, at: p.at })),
      };
    }),
  });
});

// ---------- Her Home page, appointments and profile (owner, 17 Oct 2026) ----------

/**
 * Her Home page at a glance: how many prescriptions, lab reports and visits she can open (the same rules as their
 * pages), her bills and what is still to pay, and her next appointment with the doctor's name. Counts only.
 */
portalRecordsRouter.get('/summary', async (req, res) => {
  const { access, patient } = await portalSession(req, res);
  const [visits, lab, bills, next] = await Promise.all([
    readyVisitDocs(access, patient),
    readyLabOrders(access, patient),
    Bill.find({ tenantId: access.tenantId, patientId: patient._id, status: 'open' }).limit(LIMIT).lean(),
    isDuplicate(patient) ? null : nextAppointment(access.tenantId, patient._id, hospitalToday(req.now)),
  ]);
  const toPay = bills.reduce((sum, b) => sum + Math.max(0, totals(b).balance), 0);
  await viewed(req, access, 'summary');
  res.json({
    appointment: next ? { date: isoDay(next.date), start: next.start, doctorName: next.doctorName } : null,
    prescriptions: visits.filter((v) => (v.prescription?.items ?? []).length).length,
    visits: visits.length,
    lab: lab.length,
    bills: bills.length,
    toPayPaise: toPay,
  });
});

const isDuplicate = (p) => Boolean(p.duplicateOf?.patient);
// Her appointments' states, as reception sees them, in her words: upcoming, seen, arrived, missed or cancelled
const PORTAL_STATUS = { booked: 'upcoming', seen: 'seen', arrived: 'arrived', no_show: 'missed', cancelled: 'cancelled' };

/** Her appointments of the last year and to come (newest first), each with its state. Never anyone else's. */
portalRecordsRouter.get('/appointments', async (req, res) => {
  const { access, patient } = await portalSession(req, res);
  const today = hospitalToday(req.now);
  let list = [];
  // A record marked as a duplicate: its appointments went to her main record (the Home page shows the next one)
  if (!isDuplicate(patient)) {
    const from = addDays(today, -365);
    const appts = await Appointment.find({ tenantId: access.tenantId, patientId: patient._id, on: { $gte: from }, kind: 'slot' }).sort({ on: -1, start: -1 }).limit(LIMIT).lean();
    const states = await statesFor(access.tenantId, appts);
    const doctors = new Map((await User.find({ _id: { $in: [...new Set(appts.map((a) => String(a.doctorId)))] } }, { name: 1 }).lean()).map((u) => [String(u._id), u.name]));
    list = appts.map((a) => ({
      date: isoDay(a.on),
      start: a.start ?? null,
      doctorName: doctors.get(String(a.doctorId)) ?? null,
      status: PORTAL_STATUS[statusOf(a, states.get(`${a.patientId}:${isoDay(a.on)}`), today)] ?? 'upcoming',
      online: a.source === 'portal',
    }));
  }
  await viewed(req, access, 'appointments');
  res.json({ today: isoDay(today), appointments: list });
});

/** Her own details as the hospital has them (to read; changes are made at reception, who check who she is). */
portalRecordsRouter.get('/profile', async (req, res) => {
  const { access, patient, tenant } = await portalSession(req, res);
  const p = patient.toJSON();
  const account = access.accountId ? await PatientAccount.findOne({ tenantId: access.tenantId, _id: access.accountId }, { email: 1, mobile: 1 }).lean() : null;
  await viewed(req, access, 'profile');
  res.json({
    hospital: letterheadFor(tenant).name,
    fullName: p.fullName,
    mrn: p.mrn,
    age: p.currentAge ?? null,
    phone: p.phone ?? '',
    address: [p.address, p.city, p.state, p.pinCode].filter(Boolean).join(', '),
    email: account?.email ?? null,
  });
});
