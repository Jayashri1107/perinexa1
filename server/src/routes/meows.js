import { Router } from 'express';
import { z } from 'zod';
import {
  AVPU,
  CHOICE_ROWS,
  CONTEXTS,
  E2_NO_IMPROVEMENT_MINUTES,
  FREQUENCIES,
  FUNDUS,
  LOCHIA,
  MEOWS_FORM,
  MEOWS_PARAMETERS,
  MEOWS_SOURCE,
  ORDERABLE_FREQUENCIES,
  WOUND,
  meowsResult,
  nextDue,
  toCelsius,
} from '../clinical/meows.js';
import { Admission } from '../models/Admission.js';
import { ClinicalDocument } from '../models/ClinicalDocument.js';
import { ClinicalScore } from '../models/ClinicalScore.js';
import { MEOWS_TASKS, MeowsChartHeader, MeowsEntry, PATHWAYS } from '../models/MeowsEntry.js';
import { hasRole } from '../models/Membership.js';
import { notify } from '../notifications/notify.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { isLateEntry } from '../utils/lateEntry.js';
import { patientAccess } from '../utils/patientAccess.js';
import { findPatientById } from '../utils/patientLookup.js';
import { safeText } from '../utils/pcpndt.js';
import { objectId, parse } from '../utils/validate.js';

// The MEOWS chart of a stay (Clinical Requirements Group B, item 8 – OBG-F-05 v1.0, clinical/meows.js): /api/meows.
//  - GET /?patientId=&admissionId=: the chart's header, the stay's observations (newest first) with their escalation
//    tasks and the late-entry badge, when the next set is due and whether it is overdue (E4), and what the header can
//    copy from the signed delivery note (blood loss) and the VTE score (LMWH);
//  - PUT /chart: the header – the context and the ordered frequency are the doctor's order (doctors and RMOs);
//  - POST /: a set of observations – the server works out the bands, counts, level and escalation (E1–E3), creates
//    the E1 / E2 tasks and tells the RMOs and her consultant through the notification bell (no SMS, no outside service);
//    a TRIGGER needs the action taken (or whom you told);
//  - POST /:id/tasks/:key: an escalation task done (the resident came, the consultant came, the anaesthetist was told);
//  - POST /:id/follow-up: the pathway chosen (E2), the first antibiotic's time, the antihypertensive's time – once each;
//  - POST /:id/cancel: written by mistake – marked "entered in error" with a reason, never changed or deleted.
// Who: those who may see her medical details read it; nurses, her doctor and RMOs write it (as the nursing chart).
// Not on a baby's record (MEOWS is for the mother). The audit log gets ids, the level and rule ids – never readings.

export const meowsRouter = Router();
const ROLES = ['doctor', 'rmo', 'nurse'];
const MIN = 60_000;
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const conflict = (m) => new HttpError(409, m, 'CONFLICT');
const invalid = (fields) => Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });

meowsRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...ROLES)) throw forbidden('The MEOWS chart is for doctors, RMOs and nurses.');
  next();
});

const mayView = (req, p) => patientAccess(req, p).view.has('pregnancy');
const mayWrite = (req, p) => {
  const a = patientAccess(req, p);
  return a.editClinical || a.recordVitals;
};
// The header's frequency is a doctor's order: doctors and RMOs who may write her clinical record
const mayOrder = (req, p) => hasRole(req.membership, 'doctor', 'rmo') && patientAccess(req, p).editClinical;

async function load(req, patientId, admissionId) {
  const patient = await findPatientById(req.tenantId, patientId);
  if (!mayView(req, patient)) throw forbidden("You can't see this patient's medical details.");
  if (patient.careType === 'newborn') throw invalid({ patientId: 'The MEOWS chart is for the mother, not a baby.' });
  const admission = await Admission.findOne({ _id: admissionId, tenantId: req.tenantId, patientId: patient._id });
  if (!admission) throw new HttpError(404, 'This stay was not found.', 'NOT_FOUND');
  return { patient, admission };
}
const ids = (patient, admission, extra = {}) => ({ patientId: String(patient._id), mrn: patient.mrn, admissionId: String(admission._id), ...extra });
const stamp = (s) => (s ? { at: s.at, byName: s.byName } : null);
const view = (e) => ({
  id: String(e._id),
  at: e.at,
  values: e.values,
  bands: e.bands,
  reds: e.reds ?? null,
  ambers: e.ambers ?? null,
  level: e.level,
  shockIndex: e.shockIndex ?? null,
  hypertensiveEmergency: Boolean(e.hypertensiveEmergency),
  escalation: e.escalation ?? [],
  e2Reason: e.e2Reason ?? null,
  tasks: (e.tasks ?? []).map((t) => ({ key: t.key, rule: t.rule, label: MEOWS_TASKS[t.key].label, dueAt: t.dueAt, doneAt: t.doneAt, byName: t.byName })),
  actionTaken: e.actionTaken ?? '',
  doctorInformedAt: e.doctorInformedAt ?? null,
  escalatedTo: e.escalatedTo ?? '',
  note: e.note ?? '',
  pathway: e.pathway ? { key: e.pathway.key, label: PATHWAYS[e.pathway.key].label, code: PATHWAYS[e.pathway.key].code, at: e.pathway.at, byName: e.pathway.byName } : null,
  antibioticAt: stamp(e.antibioticAt),
  antihypertensiveAt: stamp(e.antihypertensiveAt),
  source: e.source,
  byName: e.byName,
  enteredAt: e.createdAt,
  lateEntry: isLateEntry(e.at, e.createdAt),
  cancelled: e.cancelled ? { reason: e.cancelled.reason, byName: e.cancelled.byName, at: e.cancelled.at } : null,
});
const headerView = (h) =>
  h && {
    context: h.context,
    contextDetail: h.contextDetail,
    diagnosis: h.diagnosis,
    frequencyMinutes: h.frequencyMinutes,
    bloodLossMl: h.bloodLossMl,
    bloodLossFrom: h.bloodLossFrom,
    lmwhPrescribed: h.lmwhPrescribed,
    startedAt: h.startedAt,
    byName: h.byName,
    updatedAt: h.updatedAt,
  };

/** What the header can copy: the signed delivery note of this stay (blood loss, time of birth) and the latest VTE score. */
async function copied(req, patient, admission) {
  const note = await ClinicalDocument.findOne({ tenantId: req.tenantId, admissionId: admission._id, kind: 'delivery', status: 'signed' }, { content: 1 }).sort({ createdAt: -1 }).lean();
  const vte = await ClinicalScore.findOne({ tenantId: req.tenantId, patientId: patient._id, kind: 'vte', cancelled: null }, { antenatalLmwh: 1, band: 1 }).sort({ on: -1 }).lean();
  const loss = note?.content?.bloodLossMl;
  return {
    bloodLossMl: loss == null || loss === '' || !Number.isFinite(Number(loss)) ? null : Number(loss),
    deliveredAt: note?.content?.deliveredAt ?? null,
    lmwh: vte ? Boolean(vte.antenatalLmwh) || vte.band === 'high' : null,
  };
}

/** The first set of the run of triggers that ends with `latest` (sets newest first, none cancelled). PURE. */
function triggerRunStart(sets) {
  let start = null;
  for (const s of sets) {
    if (s.level !== 'trigger') break;
    start = s;
  }
  return start;
}

/** When the next set is due, whether it is overdue (E4), and whether E1 has been open 60 min without improvement. */
export function chartStatus(header, entries, admission, now) {
  const live = entries.filter((e) => !e.cancelled);
  const latest = live[0] ?? null;
  const due = nextDue({ frequency: header?.frequencyMinutes ?? null, last: latest && { at: latest.at, level: latest.level }, since: header?.startedAt ?? admission.admittedAt }, now);
  const run = triggerRunStart(live);
  const e2Due = Boolean(latest && run && !latest.escalation?.includes('E2') && new Date(now) - new Date(run.at) >= E2_NO_IMPROVEMENT_MINUTES * MIN);
  return { dueAt: due.dueAt, overdue: admission.status === 'admitted' && due.overdue, e2Due, frequencyOrdered: Boolean(header?.frequencyMinutes) };
}

meowsRouter.get('/', async (req, res) => {
  const q = parse(z.object({ patientId: objectId, admissionId: objectId }).strict(), req.query);
  const { patient, admission } = await load(req, q.patientId, q.admissionId);
  const entries = await MeowsEntry.find({ tenantId: req.tenantId, admissionId: admission._id }).sort({ at: -1, _id: -1 }).limit(500).lean();
  const header = await MeowsChartHeader.findOne({ tenantId: req.tenantId, admissionId: admission._id }).lean();
  await audit(req, 'MEOWS_VIEWED', { details: ids(patient, admission) });
  const latest = entries.find((e) => !e.cancelled) ?? null;
  const now = req.now ?? new Date();
  const open = admission.status === 'admitted';
  res.json({
    header: headerView(header),
    copied: await copied(req, patient, admission),
    status: chartStatus(header, entries, admission, now),
    entries: entries.map(view),
    latest: latest ? view(latest) : null,
    access: { write: mayWrite(req, patient) && open, order: mayOrder(req, patient) && open },
    rules: { parameters: MEOWS_PARAMETERS, rows: CHOICE_ROWS, avpu: AVPU, lochia: LOCHIA, fundus: FUNDUS, wound: WOUND, contexts: CONTEXTS, frequencies: ORDERABLE_FREQUENCIES, pathways: PATHWAYS, form: MEOWS_FORM, source: MEOWS_SOURCE },
  });
});

const blankToNull = (v) => (v === '' || v === undefined ? null : v);
const reading = (label, min, max) =>
  z.preprocess(blankToNull, z.union([z.null(), z.coerce.number(`${label} must be a number`).min(min, `${label} looks too low – please check`).max(max, `${label} looks too high – please check`)])).default(null);
const whole = (label, min, max) =>
  z.preprocess(blankToNull, z.union([z.null(), z.coerce.number(`${label} must be a number`).int(`${label} must be a whole number`).min(min, `${label} looks too low – please check`).max(max, `${label} looks too high – please check`)])).default(null);
const choice = (values) => z.preprocess(blankToNull, z.union([z.null(), z.enum(values)])).default(null);
const yesNo = z.preprocess((v) => (v === '' || v === undefined ? null : v === 'yes' ? true : v === 'no' ? false : v), z.union([z.null(), z.boolean()])).default(null);
const optionalTime = z.preprocess(blankToNull, z.union([z.null(), z.iso.datetime('Please enter a valid date and time').transform((v) => new Date(v))])).default(null);
const P = Object.fromEntries(MEOWS_PARAMETERS.map((p) => [p.key, p]));
const body = z
  .object({
    clientRequestId: z.uuid('Please reload the page and try again'),
    patientId: objectId,
    admissionId: objectId,
    at: z.iso.datetime('Please enter a valid date and time').transform((v) => new Date(v)),
    rr: whole('Respiratory rate', P.rr.min, P.rr.max),
    spo2: whole('SpO2', P.spo2.min, P.spo2.max),
    temp: reading('Temperature', 33, 108),
    tempUnit: z.enum(['C', 'F']).default('C'),
    sbp: whole('Systolic BP', P.sbp.min, P.sbp.max),
    dbp: whole('Diastolic BP', P.dbp.min, P.dbp.max),
    hr: whole('Pulse', P.hr.min, P.hr.max),
    avpu: z.enum(['', 'A', 'V', 'P', 'U']).default(''),
    urine4h: whole('Urine in 4 h', P.urine4h.min, P.urine4h.max),
    confusion: yesNo,
    pain: whole('Pain score', 0, 10),
    lochia: choice(Object.keys(LOCHIA)),
    fundus: choice(Object.keys(FUNDUS)),
    wound: choice(Object.keys(WOUND)),
    nurseConcern: yesNo,
    actionTaken: safeText('Action taken', 1000).default(''),
    doctorInformedAt: optionalTime,
    escalatedTo: safeText('Told whom', 150).default(''),
    note: safeText('Note', 1000).default(''),
  })
  .strict();

const where = (admission) => [admission.ward, admission.bed && `bed ${admission.bed}`].filter(Boolean).join(' ');

meowsRouter.post('/', async (req, res) => {
  const b = parse(body, req.body);
  const { patient, admission } = await load(req, b.patientId, b.admissionId);
  if (!mayWrite(req, patient)) throw forbidden('Only nurses, her doctor and RMOs write the MEOWS chart.');
  const same = await MeowsEntry.findOne({ tenantId: req.tenantId, clientRequestId: b.clientRequestId });
  if (same) return res.status(200).json({ entry: view(same) });
  if (admission.status !== 'admitted') throw conflict('She has been discharged: the MEOWS chart is closed.');
  const now = req.now ?? new Date();
  if (b.at.getTime() > now.getTime() + 5 * MIN) throw invalid({ at: "The clinical time can't be in the future." });
  if (b.at < admission.admittedAt) throw invalid({ at: 'The clinical time is before she was admitted – please check it.' });
  if (b.doctorInformedAt && b.doctorInformedAt.getTime() > now.getTime() + 5 * MIN) throw invalid({ doctorInformedAt: "The time can't be in the future." });
  const tempC = b.temp == null ? null : b.tempUnit === 'F' ? toCelsius(b.temp) : b.temp;
  if (tempC != null && (tempC < P.tempC.min || tempC > P.tempC.max)) throw invalid({ temp: 'The temperature looks wrong – please check the number and °C / °F.' });
  if ((b.sbp == null) !== (b.dbp == null)) throw invalid({ sbp: 'Enter both blood pressure numbers' });
  const values = {
    rr: b.rr,
    spo2: b.spo2,
    tempC,
    sbp: b.sbp,
    dbp: b.dbp,
    hr: b.hr,
    avpu: b.avpu || null,
    urine4h: b.urine4h,
    confusion: b.confusion,
    pain: b.pain,
    lochia: b.lochia,
    fundus: b.fundus,
    wound: b.wound,
    nurseConcern: b.nurseConcern,
  };
  const r = meowsResult(values);
  if (Object.values(values).every((v) => v == null)) throw invalid({ rr: 'Enter at least one observation' });
  if (r.level === 'trigger' && !b.actionTaken && !b.escalatedTo) throw invalid({ actionTaken: 'This is a trigger: tell the doctor now, and write the action taken' });

  // E2 without two reds: E1 open for 60 min (every set since then a trigger) and this one still a trigger
  const escalation = [...r.escalation];
  let e2Reason = escalation.includes('E2') ? 'two_red' : null;
  if (r.level === 'trigger' && !e2Reason) {
    const before = await MeowsEntry.find({ tenantId: req.tenantId, admissionId: admission._id, cancelled: null, at: { $lte: b.at } }, { at: 1, level: 1 }).sort({ at: -1, _id: -1 }).limit(100).lean();
    const run = triggerRunStart(before);
    if (run && b.at - run.at >= E2_NO_IMPROVEMENT_MINUTES * MIN) {
      escalation.splice(1, 0, 'E2');
      e2Reason = 'no_improvement';
    }
  }
  // The tasks: one of each kind open at a time on a stay (a repeat set while the resident is on the way adds none)
  const openTasks = await MeowsEntry.find({ tenantId: req.tenantId, admissionId: admission._id, cancelled: null, tasks: { $elemMatch: { doneAt: null } } }, { tasks: 1 }).lean();
  const open = new Set(openTasks.flatMap((e) => e.tasks.filter((t) => !t.doneAt).map((t) => t.key)));
  const wanted = [...(escalation.includes('E1') ? ['resident_review'] : []), ...(escalation.includes('E2') ? ['consultant_bedside', 'anaesthetist_informed'] : [])];
  const tasks = wanted.filter((k) => !open.has(k)).map((key) => ({ key, rule: MEOWS_TASKS[key].rule, dueAt: new Date(b.at.getTime() + MEOWS_TASKS[key].minutes * MIN) }));

  const entry = await MeowsEntry.create({
    tenantId: req.tenantId,
    patientId: patient._id,
    admissionId: admission._id,
    at: b.at,
    values,
    bands: r.bands,
    reds: r.reds,
    ambers: r.ambers,
    level: r.level,
    shockIndex: r.shockIndex,
    hypertensiveEmergency: r.hypertensiveEmergency,
    escalation,
    e2Reason,
    tasks,
    actionTaken: b.actionTaken,
    doctorInformedAt: b.doctorInformedAt,
    escalatedTo: b.escalatedTo,
    note: b.note,
    source: MEOWS_SOURCE,
    by: req.user._id,
    byName: req.user.name,
    clientRequestId: b.clientRequestId,
  });
  await audit(req, 'MEOWS_RECORDED', { details: ids(patient, admission, { entryId: String(entry._id), level: entry.level, escalation: escalation.join(',') }) });

  // The bell: E1 to the RMOs (resident) and her consultant; E2 to both again. A short text, never the readings.
  const link = `/patients/${patient._id}/stays/${admission._id}`;
  const place = where(admission);
  const name = `${patient.fullName}${place ? `, ${place}` : ''}`;
  const consultant = patient.assignedDoctor ? [patient.assignedDoctor] : [];
  if (escalation.includes('E2')) {
    await notify(req, { userIds: consultant, roles: ['rmo'] }, { kind: 'meows', text: `MEOWS E2: ${name} – consultant to the bedside; inform the anaesthetist.`, link });
  } else if (escalation.includes('E1')) {
    await notify(req, { userIds: consultant, roles: ['rmo'] }, { kind: 'meows', text: `MEOWS E1: ${name} – resident to the bedside within 30 min; consultant informed.`, link });
  }
  res.status(201).json({ entry: view(entry) });
});

async function loadEntry(req, id) {
  const e = await MeowsEntry.findOne({ _id: id, tenantId: req.tenantId });
  if (!e) throw new HttpError(404, 'This entry was not found.', 'NOT_FOUND');
  const { patient, admission } = await load(req, e.patientId, e.admissionId);
  if (!mayWrite(req, patient)) throw forbidden('Only nurses, her doctor and RMOs write the MEOWS chart.');
  if (e.cancelled) throw conflict('This entry was marked as entered in error.');
  return { e, patient, admission };
}
const checkTime = (t, e, now, field) => {
  if (t.getTime() > now.getTime() + 5 * MIN) throw invalid({ [field]: "The time can't be in the future." });
  if (t < e.at) throw invalid({ [field]: 'The time is before the observations – please check it.' });
};

meowsRouter.put('/chart', async (req, res) => {
  const b = parse(
    z
      .object({
        patientId: objectId,
        admissionId: objectId,
        context: z.enum(Object.keys(CONTEXTS), 'Choose the context'),
        contextDetail: safeText('Detail', 150).default(''),
        diagnosis: safeText('Diagnosis or procedure', 300).default(''),
        frequencyMinutes: z.coerce.number().refine((n) => FREQUENCIES.includes(n), 'Choose how often'),
        bloodLossMl: whole('Blood loss', 0, 10000),
        lmwhPrescribed: z.boolean().default(false),
      })
      .strict(),
    req.body,
  );
  const { patient, admission } = await load(req, b.patientId, b.admissionId);
  if (!mayOrder(req, patient)) throw forbidden('The chart header (how often to observe) is a doctor’s order: doctors and RMOs.');
  if (admission.status !== 'admitted') throw conflict('She has been discharged: the MEOWS chart is closed.');
  const fromNote = (await copied(req, patient, admission)).bloodLossMl;
  const bloodLossFrom = b.bloodLossMl == null ? null : fromNote != null && b.bloodLossMl === fromNote ? 'delivery_note' : 'typed';
  const now = req.now ?? new Date();
  const set = { context: b.context, contextDetail: b.contextDetail, diagnosis: b.diagnosis, frequencyMinutes: b.frequencyMinutes, bloodLossMl: b.bloodLossMl, bloodLossFrom, lmwhPrescribed: b.lmwhPrescribed, by: req.user._id, byName: req.user.name };
  const h = await MeowsChartHeader.findOneAndUpdate(
    { tenantId: req.tenantId, admissionId: admission._id },
    { $set: set, $setOnInsert: { tenantId: req.tenantId, patientId: patient._id, admissionId: admission._id, startedAt: now } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
  await audit(req, 'MEOWS_HEADER_SAVED', { details: ids(patient, admission, { context: h.context, frequencyMinutes: h.frequencyMinutes }) });
  res.json({ header: headerView(h) });
});

meowsRouter.post('/:id/tasks/:key', async (req, res) => {
  const { id, key } = parse(z.object({ id: objectId, key: z.enum(Object.keys(MEOWS_TASKS)) }), req.params);
  const { at } = parse(z.object({ at: optionalTime }).strict(), req.body ?? {});
  const { e, patient, admission } = await loadEntry(req, id);
  const task = e.tasks.find((t) => t.key === key);
  if (!task) throw new HttpError(404, 'This task is not on these observations.', 'NOT_FOUND');
  if (task.doneAt) throw conflict('Already marked as done.');
  const now = req.now ?? new Date();
  const when = at ?? now;
  checkTime(when, e, now, 'at');
  Object.assign(task, { doneAt: when, by: req.user._id, byName: req.user.name });
  await e.save();
  await audit(req, 'MEOWS_TASK_DONE', { details: ids(patient, admission, { entryId: String(e._id), task: key }) });
  res.json({ entry: view(e) });
});

meowsRouter.post('/:id/follow-up', async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const b = parse(z.object({ pathway: choice(Object.keys(PATHWAYS)), antibioticAt: optionalTime, antihypertensiveAt: optionalTime }).strict(), req.body);
  const { e, patient, admission } = await loadEntry(req, id);
  const now = req.now ?? new Date();
  const by = { by: req.user._id, byName: req.user.name };
  if (b.pathway) {
    if (e.level !== 'trigger') throw invalid({ pathway: 'A pathway is chosen on a trigger.' });
    if (e.pathway) throw conflict('The pathway was already chosen.');
    e.pathway = { key: b.pathway, at: now, ...by };
  }
  if (b.antibioticAt) {
    if (e.pathway?.key !== 'sepsis') throw invalid({ antibioticAt: 'Choose the sepsis pathway first.' });
    if (e.antibioticAt) throw conflict('The antibiotic time was already recorded.');
    checkTime(b.antibioticAt, e, now, 'antibioticAt');
    e.antibioticAt = { at: b.antibioticAt, ...by, recordedAt: now };
  }
  if (b.antihypertensiveAt) {
    if (!e.hypertensiveEmergency) throw invalid({ antihypertensiveAt: 'Only for a hypertensive emergency.' });
    if (e.antihypertensiveAt) throw conflict('The antihypertensive time was already recorded.');
    checkTime(b.antihypertensiveAt, e, now, 'antihypertensiveAt');
    e.antihypertensiveAt = { at: b.antihypertensiveAt, ...by, recordedAt: now };
  }
  if (!b.pathway && !b.antibioticAt && !b.antihypertensiveAt) throw invalid({ pathway: 'Nothing to record.' });
  await e.save();
  await audit(req, 'MEOWS_FOLLOW_UP_SAVED', { details: ids(patient, admission, { entryId: String(e._id), ...(b.pathway ? { pathway: b.pathway } : {}), antibiotic: Boolean(b.antibioticAt), antihypertensive: Boolean(b.antihypertensiveAt) }) });
  res.json({ entry: view(e) });
});

meowsRouter.post('/:id/cancel', async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const { reason } = parse(z.object({ reason: safeText('Reason', 300).refine((t) => t.trim().length >= 5, 'Please say why (at least 5 characters).') }).strict(), req.body);
  const e = await MeowsEntry.findOne({ _id: id, tenantId: req.tenantId });
  if (!e) throw new HttpError(404, 'This entry was not found.', 'NOT_FOUND');
  const { patient, admission } = await load(req, e.patientId, e.admissionId);
  if (!mayWrite(req, patient)) throw forbidden('Only nurses, her doctor and RMOs write the MEOWS chart.');
  if (e.cancelled) throw conflict('Already marked as entered in error.');
  e.cancelled = { reason, by: req.user._id, byName: req.user.name, at: req.now ?? new Date() };
  await e.save();
  await audit(req, 'MEOWS_CANCELLED', { details: ids(patient, admission, { entryId: String(e._id) }) });
  res.json({ entry: view(e) });
});
