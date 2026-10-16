import { Router } from 'express';
import { labRecord, mentionsConfidential, sharedTests, visitRecord, withPatientRules } from '../abdm/shareRules.js';
import { CONFIDENTIAL_NAME } from '../billing/billingRules.js';
import { totals } from '../billing/money.js';
import { isoDay } from '../careplans/dates.js';
import { testByKey } from '../lab/labTests.js';
import { Bill } from '../models/Bill.js';
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

/** Her signed visits that may be shown, newest first, each with what its paper copy shows. */
async function readyVisits(access, patient, tenant) {
  if (patient.sensitive) return [];
  const visits = await Visit.find({ tenantId: access.tenantId, patientId: patient._id, status: 'active', signed: { $ne: null } }).sort({ visitOn: -1, createdAt: -1 }).limit(LIMIT).lean();
  const ready = visits.filter((v) => withPatientRules(patient, visitRecord(v)).state === 'ready');
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
      items: v.prescription?.items ?? [],
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
        return { name: f?.name ?? v.key, value: v.value, unit: f?.unit ?? '', range: f?.range ?? '', flag: v.flag ?? '' };
      }),
    text: t.text ?? '',
  };
}

portalRecordsRouter.get('/lab', async (req, res) => {
  const { access, patient, tenant } = await portalSession(req, res);
  let reports = [];
  if (!patient.sensitive) {
    const orders = await LabOrder.find({ tenantId: access.tenantId, patientId: patient._id, status: 'reviewed' }).sort({ createdAt: -1 }).limit(LIMIT).lean();
    reports = orders
      .filter((o) => withPatientRules(patient, labRecord(o)).state === 'ready')
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
