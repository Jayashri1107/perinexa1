import { Router } from 'express';
import { z } from 'zod';
import { DEFAULTER_GRACE_DAYS, HIGH_RISK_REASONS, SCHEDULE_SOURCE, SCREENS, schedule } from '../clinical/newbornSchedule.js';
import { hasRole } from '../models/Membership.js';
import { NewbornFollowUp, SCREEN_RESULTS } from '../models/NewbornFollowUp.js';
import { Patient } from '../models/Patient.js';
import { isClosed } from '../patients/deathRules.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { assertNotHidden, departmentListed, patientAccess } from '../utils/patientAccess.js';
import { findPatientById } from '../utils/patientLookup.js';
import { safeText } from '../utils/pcpndt.js';
import { objectId, parse } from '../utils/validate.js';

// Newborn screening and high-risk follow-up (Clinical Requirements Group A, item 4): /api/newborn-follow-up.
//  - the list: babies with a screen or a clinic visit due, the defaulters (a screen past its last day, a visit not
//    attended 14 days after its date), or all;
//  - one baby's log: the schedule worked out from her birth, gestation and weight, and what was done.
// Doctors, RMOs and nurses who may see the baby's medical details record screens and their results, set the gestation
// and whether she is high-risk. The newborn follow-up coordinator sees names, numbers, phones and dates – which screen
// or visit is due and whether it was done, never a result or a note – and records that a clinic visit was attended.
// Babies born in the last BABY_DAYS days are listed even before anyone opened their log (every baby is screened).

export const newbornFollowUpRouter = Router();
const CLINICAL = ['doctor', 'rmo', 'nurse'];
const COORDINATOR = 'followup_coordinator';
const BABY_DAYS = 120;
const DAY = 24 * 60 * 60 * 1000;
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const conflict = (m) => new HttpError(409, m, 'CONFLICT');
const invalid = (fields) => Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });

newbornFollowUpRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...CLINICAL, COORDINATOR)) throw forbidden('Newborn follow-up is for doctors, RMOs, nurses and the follow-up coordinator.');
  next();
});

const clinicalView = (req, baby) => hasRole(req.membership, ...CLINICAL) && patientAccess(req, baby).view.has('pregnancy');
const clinicalWrite = (req, baby) => {
  if (!hasRole(req.membership, ...CLINICAL)) return false;
  const a = patientAccess(req, baby);
  return a.editClinical || a.recordVitals;
};
const isCoordinator = (req) => hasRole(req.membership, COORDINATOR);
const endOfDay = (d) => new Date(d.getTime() + DAY - 1 - 330 * 60 * 1000); // the last moment of that day in India time

/** The schedule with what was done: each screen and visit with its state. PURE. */
export function itemsFor(baby, doc, now) {
  const s = schedule({ birthAt: baby.newborn?.birthAt, gestationWeeks: doc?.gestationWeeks ?? null, gestationDays: doc?.gestationDays ?? 0, birthWeightGrams: baby.newborn?.birthWeightGrams ?? null, highRisk: Boolean(doc?.highRisk) });
  const rec = (kind, key) => doc?.records?.find((r) => r.kind === kind && r.key === key) ?? null;
  // A ROP screen added by a NICU admission (Build 13, N3) gives the first-exam date, and the screen even when the
  // schedule alone would not ask for it
  const ropEvent = (doc?.events ?? []).filter((e) => e.key === 'rop').sort((a, b) => new Date(a.dueBy) - new Date(b.dueBy))[0];
  if (ropEvent) {
    const by = new Date(ropEvent.dueBy);
    const at = s.screens.findIndex((x) => x.key === 'rop');
    const screen = { key: 'rop', label: SCREENS.rop.label, dueFrom: new Date(Math.min(by.getTime(), at >= 0 ? s.screens[at].dueFrom.getTime() : by.getTime() - 7 * DAY)), dueBy: by, fromNicu: true };
    if (at >= 0) s.screens[at] = screen;
    else s.screens.push(screen);
  }
  const screens = s.screens.map((x) => {
    const r = rec('screen', x.key);
    const state = r ? r.status : now > endOfDay(x.dueBy) ? 'overdue' : now >= x.dueFrom ? 'due' : 'upcoming';
    return { ...x, state, record: r };
  });
  const visits = s.visits.map((x) => {
    const r = rec('visit', x.key);
    const state = r ? 'attended' : now > endOfDay(new Date(x.dueOn.getTime() + DEFAULTER_GRACE_DAYS * DAY)) ? 'defaulter' : now >= new Date(x.dueOn.getTime() - 7 * DAY) ? 'due' : 'upcoming';
    return { ...x, state, record: r };
  });
  return { screens, visits, rop: ropEvent ? true : s.rop };
}

const recordView = (r, full) => (r ? { status: r.status, on: r.on, byName: r.byName, at: r.at, ...(full ? { result: r.result, note: r.note } : {}) } : null);
function babyView(baby, doc, now, full) {
  const { screens, visits, rop } = itemsFor(baby, doc, now);
  const item = (x) => ({ key: x.key, label: x.label, state: x.state, ...(x.dueOn ? { dueOn: x.dueOn } : { dueFrom: x.dueFrom, dueBy: x.dueBy }), record: recordView(x.record, full) });
  return {
    patientId: String(baby._id),
    fullName: baby.fullName,
    mrn: baby.mrn,
    phone: baby.phone ?? '',
    birthAt: baby.newborn?.birthAt ?? null,
    closed: isClosed(baby),
    ...(full
      ? { gestationWeeks: doc?.gestationWeeks ?? null, gestationDays: doc?.gestationDays ?? 0, birthWeightGrams: baby.newborn?.birthWeightGrams ?? null, highRisk: Boolean(doc?.highRisk), highRiskReasons: doc?.highRiskReasons ?? [], needsRop: rop }
      : { highRisk: Boolean(doc?.highRisk) }),
    screens: screens.map(item),
    visits: visits.map(item),
    defaulter: !isClosed(baby) && [...screens, ...visits].some((x) => x.state === 'overdue' || x.state === 'defaulter'),
    due: !isClosed(baby) && [...screens, ...visits].some((x) => x.state === 'due'),
  };
}

const listQuery = z.object({ show: z.enum(['due', 'defaulters', 'all']).default('due') }).strict();
newbornFollowUpRouter.get('/', async (req, res) => {
  const { show } = parse(listQuery, req.query);
  const now = req.now ?? new Date();
  const docs = await NewbornFollowUp.find({ tenantId: req.tenantId }).lean();
  const recent = await Patient.find({ tenantId: req.tenantId, careType: 'newborn', 'newborn.birthAt': { $gte: new Date(now.getTime() - BABY_DAYS * DAY) } }, { _id: 1 }).lean();
  const ids = [...new Set([...docs.map((d) => String(d.patientId)), ...recent.map((p) => String(p._id))])];
  const babies = await Patient.find({ tenantId: req.tenantId, _id: { $in: ids }, careType: 'newborn' });
  const byPatient = new Map(docs.map((d) => [String(d.patientId), d]));
  const rows = babies
    // Another department's baby is left out for a doctor, also when she is the coordinator too (departments, 9 Nov 2026)
    .filter((b) => departmentListed(req, b) && (isCoordinator(req) || clinicalView(req, b)))
    .map((b) => babyView(b, byPatient.get(String(b._id)), now, clinicalView(req, b)))
    .filter((r) => show === 'all' || (show === 'due' ? r.due || r.defaulter : r.defaulter))
    .sort((a, b) => new Date(a.birthAt) - new Date(b.birthAt));
  await audit(req, 'NEWBORN_FOLLOW_UP_LISTED', { details: { show, count: rows.length } });
  res.json({ babies: rows, source: SCHEDULE_SOURCE, graceDays: DEFAULTER_GRACE_DAYS });
});

async function loadBaby(req) {
  const { patientId } = parse(z.object({ patientId: objectId }), req.params);
  // Another department's baby is "not found" for a doctor (departments, 9 Nov 2026)
  const baby = assertNotHidden(req, await findPatientById(req.tenantId, patientId));
  if (baby.careType !== 'newborn') throw invalid({ patientId: 'The screening log is for a baby’s record.' });
  if (!isCoordinator(req) && !clinicalView(req, baby)) throw forbidden("You can't see this baby's medical details.");
  const doc = await NewbornFollowUp.findOne({ tenantId: req.tenantId, patientId: baby._id });
  return { baby, doc };
}

newbornFollowUpRouter.get('/patients/:patientId', async (req, res) => {
  const { baby, doc } = await loadBaby(req);
  const full = clinicalView(req, baby);
  await audit(req, 'NEWBORN_FOLLOW_UP_VIEWED', { details: { patientId: String(baby._id), mrn: baby.mrn } });
  res.json({ baby: babyView(baby, doc, req.now ?? new Date(), full), access: { write: clinicalWrite(req, baby), attend: clinicalWrite(req, baby) || isCoordinator(req) }, ...(full ? { highRiskReasons: HIGH_RISK_REASONS, results: SCREEN_RESULTS } : {}), source: SCHEDULE_SOURCE });
});

// The gestation at birth and whether she is high-risk (the follow-up clinic is for high-risk babies)
const detailsBody = z
  .object({
    gestationWeeks: z.union([z.null(), z.number().int().min(22, 'From 22 weeks').max(44, 'Up to 44 weeks')]),
    gestationDays: z.number().int().min(0).max(6).default(0),
    highRisk: z.boolean(),
    highRiskReasons: z.array(z.enum(HIGH_RISK_REASONS)).max(HIGH_RISK_REASONS.length).default([]),
  })
  .strict();
newbornFollowUpRouter.put('/patients/:patientId', async (req, res) => {
  const { baby } = await loadBaby(req);
  if (!clinicalWrite(req, baby)) throw forbidden('The gestation and the high-risk reasons are recorded by a doctor, RMO or nurse.');
  const body = parse(detailsBody, req.body);
  if (body.highRisk && !body.highRiskReasons.length) throw invalid({ highRiskReasons: 'Choose why she is high-risk' });
  if (!body.highRisk) body.highRiskReasons = [];
  await NewbornFollowUp.updateOne({ tenantId: req.tenantId, patientId: baby._id }, { $set: { ...body, updatedByName: req.user.name } }, { upsert: true });
  await audit(req, 'NEWBORN_FOLLOW_UP_UPDATED', { details: { patientId: String(baby._id), mrn: baby.mrn, highRisk: body.highRisk } });
  const doc = await NewbornFollowUp.findOne({ tenantId: req.tenantId, patientId: baby._id });
  res.json({ baby: babyView(baby, doc, req.now ?? new Date(), true) });
});

// A screen done (with its result) or not needed (why); a clinic visit attended. Saved once (no change afterwards).
const recordBody = z
  .object({
    kind: z.enum(['screen', 'visit']),
    key: z.string().max(20),
    status: z.enum(['done', 'not_needed', 'attended']),
    on: z.iso.date('Please enter a valid date').transform((d) => new Date(`${d}T00:00:00Z`)),
    result: z.enum(['', ...SCREEN_RESULTS]).default(''),
    note: safeText('Note', 1000).default(''),
  })
  .strict();
newbornFollowUpRouter.post('/patients/:patientId/records', async (req, res) => {
  const { baby, doc } = await loadBaby(req);
  const body = parse(recordBody, req.body);
  const now = req.now ?? new Date();
  const clinical = clinicalWrite(req, baby);
  if (body.kind === 'screen' && !clinical) throw forbidden('Screens and their results are recorded by a doctor, RMO or nurse.');
  if (body.kind === 'visit' && !clinical && !isCoordinator(req)) throw forbidden('You may not record this visit.');
  if (!clinical && body.note) throw invalid({ note: 'Notes are written by the clinical staff.' });
  const { screens, visits } = itemsFor(baby, doc, now);
  const item = (body.kind === 'screen' ? screens : visits).find((x) => x.key === body.key);
  if (!item) throw invalid({ key: 'This screen or visit is not on her schedule.' });
  if (item.record) throw conflict(`Already recorded by ${item.record.byName}.`);
  if (body.kind === 'screen' && body.status === 'attended') throw invalid({ status: 'Choose done or not needed' });
  if (body.kind === 'visit' && body.status !== 'attended') throw invalid({ status: 'A visit is recorded as attended' });
  if (body.kind === 'screen' && body.status === 'done' && !body.result) throw invalid({ result: 'Choose the result' });
  if (body.status === 'not_needed' && !body.note) throw invalid({ note: 'Write why it is not needed' });
  const born = baby.newborn?.birthAt ? new Date(new Date(baby.newborn.birthAt).toISOString().slice(0, 10)) : null;
  if (born && body.on < new Date(born.getTime() - DAY)) throw invalid({ on: 'This is before she was born.' });
  if (body.on.getTime() > now.getTime() + DAY) throw invalid({ on: "This can't be in the future." });
  const record = { ...body, result: body.kind === 'screen' && body.status === 'done' ? body.result : '', by: req.user._id, byName: req.user.name, at: now };
  const r = await NewbornFollowUp.updateOne(
    { tenantId: req.tenantId, patientId: baby._id, records: { $not: { $elemMatch: { kind: body.kind, key: body.key } } } },
    { $push: { records: record }, $setOnInsert: { gestationWeeks: null, gestationDays: 0, highRisk: false, highRiskReasons: [] } },
    { upsert: true },
  ).catch((e) => {
    if (e?.code === 11000) throw conflict('Someone recorded this at the same moment. Reload to see it.');
    throw e;
  });
  if (!r.matchedCount && !r.upsertedCount) throw conflict('Someone recorded this at the same moment. Reload to see it.');
  await audit(req, 'NEWBORN_SCREEN_RECORDED', { details: { patientId: String(baby._id), mrn: baby.mrn, kind: body.kind, key: body.key, status: body.status } });
  const saved = await NewbornFollowUp.findOne({ tenantId: req.tenantId, patientId: baby._id });
  res.status(201).json({ baby: babyView(baby, saved, now, clinicalView(req, baby)) });
});
