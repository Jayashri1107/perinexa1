import { Router } from 'express';
import { z } from 'zod';
import { BILI_METHODS, BIRTH_CHECKS, CORD_CLAMPING, DISCHARGE_READY, EXAM_ITEMS, NEWBORN_CARE_SOURCE, NICU_OUTCOMES, NICU_REASONS, NICU_SOURCES, NICU_UNITS, RESUSCITATION, coldAtAdmission } from '../clinical/newbornCare.js';
import { nextNumber } from '../models/Counter.js';
import { hasRole } from '../models/Membership.js';
import { BilirubinReading, NewbornBirthCare, NewbornExam, NicuAdmission } from '../models/NewbornCare.js';
import { Patient } from '../models/Patient.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { findPatientById } from '../utils/patientLookup.js';
import { objectId, parse } from '../utils/validate.js';
import { monthRange } from './clinicalAudit.js';

// The newborn at birth and on the ward, bilirubin, and the NICU or SNCU admission and register (Clinical Requirements
// Group B, items 12 and 13 – DRAFT, clinical/newbornCare.js): /api/newborn-care.
//  - GET /?patientId=: a baby's birth record, examinations, bilirubin readings (with hours of age) and admissions;
//  - POST /birth, /exam, /bilirubin, /nicu: add one (doctors, RMOs, nurses who may write in her record);
//  - POST /nicu/:id/outcome: how the admission ended; POST /:kind/:id/cancel: entered in error, with a reason;
//  - GET /register?month=: the NICU / SNCU admission and outcome register (NEO-L-05) – doctors, RMOs, nurses.
// The free text here is written after birth, on a baby's own record: the words-about-sex check of the mother's record
// does not apply (as on the delivery note). The audit log gets ids – never the findings.

export const newbornCareRouter = Router();
const ROLES = ['doctor', 'rmo', 'nurse'];
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const conflict = (m) => new HttpError(409, m, 'CONFLICT');
const invalid = (fields, message = 'Please check the highlighted fields.') => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields });
const time = (label) => z.iso.datetime(`${label}: please enter a valid date and time`).transform((v) => new Date(v));
const text = (label, max) => z.string().trim().max(max, `${label} is too long`).default('');
const num = (label, min, max) => z.preprocess((v) => (v === '' || v === undefined ? null : v), z.union([z.null(), z.coerce.number(`${label} must be a number`).min(min, `${label} looks too low – please check`).max(max, `${label} looks too high – please check`)])).default(null);
const DAY = 24 * 60 * 60 * 1000;

newbornCareRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...ROLES)) throw forbidden('Newborn care records are for doctors, RMOs and nurses.');
  next();
});
const mayView = (req, p) => patientAccess(req, p).view.has('pregnancy');
const mayWrite = (req, p) => {
  const a = patientAccess(req, p);
  return a.editClinical || a.recordVitals;
};
async function babyFor(req, id, write = false) {
  const baby = await findPatientById(req.tenantId, id);
  if (baby.careType !== 'newborn') throw invalid({ patientId: "These records belong on a baby's record." });
  if (!mayView(req, baby)) throw forbidden("You can't see this baby's medical details.");
  if (write && !mayWrite(req, baby)) throw forbidden("You may not write in this baby's record.");
  return baby;
}
const ids = (baby, extra = {}) => ({ patientId: String(baby._id), mrn: baby.mrn, ...extra });
const cancelView = (c) => (c ? { reason: c.reason, byName: c.byName, at: c.at } : null);
const hoursOfAge = (baby, at) => (baby.newborn?.birthAt ? Math.round(((new Date(at) - new Date(baby.newborn.birthAt)) / 3600000) * 10) / 10 : null);
const nicuView = (n, baby) => ({
  id: String(n._id),
  serial: n.serial,
  unit: n.unit,
  source: n.source,
  admittedAt: n.admittedAt,
  ageHours: baby ? hoursOfAge(baby, n.admittedAt) : null,
  reasons: n.reasons,
  reasonNote: n.reasonNote,
  weightGrams: n.weightGrams,
  temperatureC: n.temperatureC,
  cold: coldAtAdmission(n.temperatureC),
  gestationWeeks: n.gestationWeeks,
  byName: n.byName,
  outcome: n.outcome ? { result: n.outcome.result, at: n.outcome.at, note: n.outcome.note, byName: n.outcome.byName } : null,
  stayDays: n.outcome ? Math.max(0, Math.round((new Date(n.outcome.at) - new Date(n.admittedAt)) / DAY)) : null,
  cancelled: cancelView(n.cancelled),
});
export const NEWBORN_RULES = { resuscitation: RESUSCITATION, cordClamping: CORD_CLAMPING, birthChecks: BIRTH_CHECKS, examItems: EXAM_ITEMS, dischargeReady: DISCHARGE_READY, biliMethods: BILI_METHODS, units: NICU_UNITS, sources: NICU_SOURCES, reasons: NICU_REASONS, outcomes: NICU_OUTCOMES, source: NEWBORN_CARE_SOURCE };

newbornCareRouter.get('/', async (req, res) => {
  const { patientId } = parse(z.object({ patientId: objectId }).strict(), req.query);
  const baby = await babyFor(req, patientId);
  const [births, exams, bili, nicu] = await Promise.all([
    NewbornBirthCare.find({ tenantId: req.tenantId, patientId: baby._id }).sort({ createdAt: -1 }).lean(),
    NewbornExam.find({ tenantId: req.tenantId, patientId: baby._id }).sort({ examinedAt: -1 }).lean(),
    BilirubinReading.find({ tenantId: req.tenantId, patientId: baby._id }).sort({ at: 1 }).lean(),
    NicuAdmission.find({ tenantId: req.tenantId, patientId: baby._id }).sort({ admittedAt: -1 }).lean(),
  ]);
  await audit(req, 'NEWBORN_CARE_VIEWED', { details: ids(baby) });
  res.json({
    birthAt: baby.newborn?.birthAt ?? null,
    birth: births.map((b) => ({ id: String(b._id), criedAtBirth: b.criedAtBirth, resuscitation: b.resuscitation, cordClamping: b.cordClamping, checks: b.checks, temperatureC: b.temperatureC, note: b.note, byName: b.byName, at: b.createdAt, cancelled: cancelView(b.cancelled) })),
    exams: exams.map((e) => ({ id: String(e._id), examinedAt: e.examinedAt, weightGrams: e.weightGrams, findings: e.findings, notes: e.notes, ready: e.ready, summary: e.summary, byName: e.byName, cancelled: cancelView(e.cancelled) })),
    bilirubin: bili.map((r) => ({ id: String(r._id), at: r.at, hours: hoursOfAge(baby, r.at), mgdl: r.mgdl, method: r.method, note: r.note, byName: r.byName, cancelled: cancelView(r.cancelled) })),
    nicu: nicu.map((n) => nicuView(n, baby)),
    access: { write: mayWrite(req, baby), outcome: hasRole(req.membership, 'doctor', 'rmo') && patientAccess(req, baby).editClinical },
    rules: NEWBORN_RULES,
  });
});

const answers = (items, allowed) => z.object(Object.fromEntries(items.map((i) => [i.key, z.enum(['', ...allowed]).default('')]))).strict().default({});
newbornCareRouter.post('/birth', async (req, res) => {
  const b = parse(
    z.object({ patientId: objectId, criedAtBirth: z.enum(['yes', 'no'], 'Did the baby cry at birth?'), resuscitation: z.enum(Object.keys(RESUSCITATION), 'Choose the resuscitation'), cordClamping: z.enum(Object.keys(CORD_CLAMPING), 'Choose the cord clamping'), checks: answers(BIRTH_CHECKS, ['yes', 'no', 'na']), temperatureC: num('Temperature', 30, 42), note: text('Note', 1000) }).strict(),
    req.body,
  );
  const baby = await babyFor(req, b.patientId, true);
  const bad = BIRTH_CHECKS.find((c) => !b.checks[c.key] || (b.checks[c.key] === 'na' && !c.na));
  if (bad) throw invalid({ [`checks.${bad.key}`]: b.checks[bad.key] ? 'Answer yes or no' : 'Answer this' });
  if (Object.values(b.checks).includes('no') && !b.note) throw invalid({ note: 'Write why a step was not done' });
  const doc = await NewbornBirthCare.create({ ...b, tenantId: req.tenantId, patientId: baby._id, by: req.user._id, byName: req.user.name }).catch((e) => {
    if (e?.code === 11000) throw conflict('The record at birth is already written. Mark it entered in error to write it again.');
    throw e;
  });
  await audit(req, 'NEWBORN_CARE_ADDED', { details: ids(baby, { kind: 'birth', id: String(doc._id) }) });
  res.status(201).json({ id: String(doc._id) });
});

newbornCareRouter.post('/exam', async (req, res) => {
  const b = parse(
    z
      .object({
        patientId: objectId,
        examinedAt: time('Examined'),
        weightGrams: num('Weight', 300, 7000),
        findings: answers(EXAM_ITEMS, ['normal', 'abnormal']),
        notes: z.object(Object.fromEntries(EXAM_ITEMS.map((i) => [i.key, text('Note', 300)]))).strict().default({}),
        ready: answers(DISCHARGE_READY, ['yes', 'no']),
        summary: text('Summary', 1000),
      })
      .strict(),
    req.body,
  );
  const baby = await babyFor(req, b.patientId, true);
  if (b.examinedAt.getTime() > (req.now ?? new Date()).getTime() + 5 * 60 * 1000) throw invalid({ examinedAt: "This can't be in the future." });
  const missing = {};
  for (const i of EXAM_ITEMS) {
    if (!b.findings[i.key]) missing[`findings.${i.key}`] = 'Choose normal or not normal';
    else if (b.findings[i.key] === 'abnormal' && !b.notes[i.key]) missing[`notes.${i.key}`] = 'Write what was found';
  }
  if (Object.keys(missing).length) throw invalid(missing, 'Examine every part (and note what is not normal) before saving.');
  const doc = await NewbornExam.create({ ...b, tenantId: req.tenantId, patientId: baby._id, by: req.user._id, byName: req.user.name });
  await audit(req, 'NEWBORN_CARE_ADDED', { details: ids(baby, { kind: 'exam', id: String(doc._id) }) });
  res.status(201).json({ id: String(doc._id) });
});

newbornCareRouter.post('/bilirubin', async (req, res) => {
  const b = parse(z.object({ patientId: objectId, at: time('Time'), mgdl: z.coerce.number('Enter the bilirubin in mg/dL').min(0).max(40, 'This looks too high – please check'), method: z.enum(Object.keys(BILI_METHODS)), note: text('Note', 300) }).strict(), req.body);
  const baby = await babyFor(req, b.patientId, true);
  if (b.at.getTime() > (req.now ?? new Date()).getTime() + 5 * 60 * 1000) throw invalid({ at: "This can't be in the future." });
  if (baby.newborn?.birthAt && b.at < new Date(baby.newborn.birthAt)) throw invalid({ at: 'This is before the baby was born.' });
  const doc = await BilirubinReading.create({ ...b, tenantId: req.tenantId, patientId: baby._id, by: req.user._id, byName: req.user.name });
  await audit(req, 'NEWBORN_CARE_ADDED', { details: ids(baby, { kind: 'bilirubin', id: String(doc._id) }) });
  res.status(201).json({ id: String(doc._id), hours: hoursOfAge(baby, doc.at) });
});

newbornCareRouter.post('/nicu', async (req, res) => {
  const b = parse(
    z
      .object({
        clientRequestId: z.uuid('Please reload the page and try again'),
        patientId: objectId,
        unit: z.enum(Object.keys(NICU_UNITS), 'Choose NICU or SNCU'),
        source: z.enum(Object.keys(NICU_SOURCES), 'Choose inborn or outborn'),
        admittedAt: time('Admitted'),
        reasons: z.array(z.enum(Object.keys(NICU_REASONS))).min(1, 'Choose why the baby is admitted'),
        reasonNote: text('Other reason', 500),
        weightGrams: num('Weight', 300, 7000),
        temperatureC: num('Temperature', 30, 42),
        gestationWeeks: num('Weeks of pregnancy', 22, 44),
      })
      .strict(),
    req.body,
  );
  const baby = await babyFor(req, b.patientId, true);
  const same = await NicuAdmission.findOne({ tenantId: req.tenantId, clientRequestId: b.clientRequestId });
  if (same) return res.json({ admission: nicuView(same, baby) });
  if (b.reasons.includes('other') && !b.reasonNote) throw invalid({ reasonNote: 'Write the other reason' });
  if (b.admittedAt.getTime() > (req.now ?? new Date()).getTime() + 5 * 60 * 1000) throw invalid({ admittedAt: "This can't be in the future." });
  if (await NicuAdmission.findOne({ tenantId: req.tenantId, patientId: baby._id, outcome: null, cancelled: null })) throw conflict('The baby is already admitted: record how that admission ended first.');
  const n = await NicuAdmission.create({ ...b, reasons: [...new Set(b.reasons)], tenantId: req.tenantId, patientId: baby._id, serial: await nextNumber(req.tenantId, 'nicu'), by: req.user._id, byName: req.user.name });
  await audit(req, 'NICU_ADMITTED', { details: ids(baby, { admissionId: String(n._id), serial: n.serial }) });
  res.status(201).json({ admission: nicuView(n, baby) });
});

newbornCareRouter.post('/nicu/:id/outcome', async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const b = parse(z.object({ result: z.enum(Object.keys(NICU_OUTCOMES), 'Choose how the admission ended'), at: time('Time'), note: text('Note', 500) }).strict(), req.body);
  const n = await NicuAdmission.findOne({ _id: id, tenantId: req.tenantId });
  if (!n) throw new HttpError(404, 'This admission was not found.', 'NOT_FOUND');
  const baby = await babyFor(req, n.patientId);
  if (!(hasRole(req.membership, 'doctor', 'rmo') && patientAccess(req, baby).editClinical)) throw forbidden('How an admission ended is recorded by a doctor or an RMO.');
  if (n.outcome || n.cancelled) throw conflict('This admission is already closed.');
  if (b.at < n.admittedAt) throw invalid({ at: 'This is before the admission.' });
  if (b.at.getTime() > (req.now ?? new Date()).getTime() + 5 * 60 * 1000) throw invalid({ at: "This can't be in the future." });
  n.outcome = { ...b, by: req.user._id, byName: req.user.name };
  await n.save();
  await audit(req, 'NICU_OUTCOME_RECORDED', { details: ids(baby, { admissionId: String(n._id), result: b.result }) });
  res.json({ admission: nicuView(n, baby) });
});

const MODELS = { birth: NewbornBirthCare, exam: NewbornExam, bilirubin: BilirubinReading, nicu: NicuAdmission };
newbornCareRouter.post('/:kind/:id/cancel', async (req, res) => {
  const { kind, id } = parse(z.object({ kind: z.enum(Object.keys(MODELS)), id: objectId }), req.params);
  const { reason } = parse(z.object({ reason: z.string().trim().min(5, 'Please say why (at least 5 characters).').max(300) }).strict(), req.body);
  const doc = await MODELS[kind].findOne({ _id: id, tenantId: req.tenantId });
  if (!doc) throw new HttpError(404, 'This record was not found.', 'NOT_FOUND');
  const baby = await babyFor(req, doc.patientId, true);
  if (doc.cancelled) throw conflict('Already marked as entered in error.');
  doc.cancelled = { reason, by: req.user._id, byName: req.user.name, at: req.now ?? new Date() };
  if (kind === 'birth') doc.live = false;
  await doc.save();
  await audit(req, 'NEWBORN_CARE_CANCELLED', { details: ids(baby, { kind, id: String(doc._id) }) });
  res.json({ cancelled: true });
});

// The NICU / SNCU admission and outcome register of a month (NEO-L-05)
newbornCareRouter.get('/register', async (req, res) => {
  const { month } = parse(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month (YYYY-MM)') }).strict(), req.query);
  const { start, end } = monthRange(month);
  const list = await NicuAdmission.find({ tenantId: req.tenantId, admittedAt: { $gte: start, $lt: end } }).sort({ serial: 1 }).lean();
  const babies = await Patient.find({ tenantId: req.tenantId, _id: { $in: list.map((n) => n.patientId) } });
  const byId = new Map(babies.map((b) => [String(b._id), b]));
  const shown = list.filter((n) => byId.has(String(n.patientId)) && mayView(req, byId.get(String(n.patientId))));
  const live = shown.filter((n) => !n.cancelled);
  const outcomes = Object.fromEntries(Object.keys(NICU_OUTCOMES).map((k) => [k, live.filter((n) => n.outcome?.result === k).length]));
  await audit(req, 'NICU_REGISTER_VIEWED', { details: { month, count: shown.length } });
  res.json({
    month,
    rows: shown.map((n) => ({ ...nicuView(n, byId.get(String(n.patientId))), baby: { id: String(n.patientId), fullName: byId.get(String(n.patientId)).fullName, mrn: byId.get(String(n.patientId)).mrn } })),
    totals: { admissions: live.length, inborn: live.filter((n) => n.source === 'inborn').length, outborn: live.filter((n) => n.source === 'outborn').length, cold: live.filter((n) => coldAtAdmission(n.temperatureC)).length, stillAdmitted: live.filter((n) => !n.outcome).length, outcomes },
    rules: NEWBORN_RULES,
  });
});
