import { Router } from 'express';
import { z } from 'zod';
import { LOSS_METHODS, PPH_CAUSES, PPH_OUTCOMES, PPH_SOURCE, PPH_STEPS, lossBand, shockIndex, totalLoss } from '../clinical/pph.js';
import { Admission } from '../models/Admission.js';
import { hasRole } from '../models/Membership.js';
import { PphChart } from '../models/PphChart.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { findPatientById } from '../utils/patientLookup.js';
import { safeText } from '../utils/pcpndt.js';
import { objectId, parse } from '../utils/validate.js';

// The PPH chart (Clinical Requirements Group B, item 15 – DRAFT, clinical/pph.js): /api/pph.
//  - GET /?patientId=&admissionId=: the stay's PPH charts, newest first, with the blood loss so far and its band;
//  - POST /: start a chart (when the bleeding was recognised, the cause if known);
//  - POST /:id/lines: add an amount of blood lost, a step taken, or a set of observations (shock index worked out);
//  - POST /:id/causes: set the cause (the four Ts) as it becomes clear;
//  - POST /:id/lines/:lineId/cancel, POST /:id/cancel: entered in error, with a reason (never changed or deleted);
//  - POST /:id/close: how it ended (doctors and RMOs).
// Nurses, her doctor and RMOs write it (as the nursing chart); those who may see her medical details read it. Not on a
// baby's record. The audit log gets ids and what kind of line – never amounts, doses or readings.

export const pphRouter = Router();
const ROLES = ['doctor', 'rmo', 'nurse'];
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const conflict = (m) => new HttpError(409, m, 'CONFLICT');
const notFound = () => new HttpError(404, 'This PPH chart was not found.', 'NOT_FOUND');
const invalid = (fields) => Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });
const time = (label) => z.iso.datetime(`${label}: please enter a valid date and time`).transform((v) => new Date(v));
const num = (label, min, max) => z.preprocess((v) => (v === '' || v === undefined ? null : v), z.union([z.null(), z.coerce.number(`${label} must be a number`).min(min, `${label} looks too low – please check`).max(max, `${label} looks too high – please check`)])).default(null);

pphRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...ROLES)) throw forbidden('The PPH chart is for doctors, RMOs and nurses.');
  next();
});

const mayView = (req, p) => patientAccess(req, p).view.has('pregnancy');
const mayWrite = (req, p) => {
  const a = patientAccess(req, p);
  return a.editClinical || a.recordVitals;
};
const mayClose = (req, p) => hasRole(req.membership, 'doctor', 'rmo') && patientAccess(req, p).editClinical;
const stamp = (req) => ({ by: req.user._id, byName: req.user.name, enteredAt: req.now ?? new Date() });
const cancelView = (c) => (c ? { reason: c.reason, byName: c.byName, at: c.at } : null);

async function load(req, patientId, admissionId) {
  const patient = await findPatientById(req.tenantId, patientId);
  if (!mayView(req, patient)) throw forbidden("You can't see this patient's medical details.");
  if (patient.careType === 'newborn') throw invalid({ patientId: 'The PPH chart is for the mother, not a baby.' });
  const admission = await Admission.findOne({ _id: admissionId, tenantId: req.tenantId, patientId: patient._id });
  if (!admission) throw new HttpError(404, 'This stay was not found.', 'NOT_FOUND');
  return { patient, admission };
}
async function loadChart(req) {
  const { id } = parse(z.object({ id: objectId }).passthrough(), req.params);
  const chart = await PphChart.findOne({ _id: id, tenantId: req.tenantId });
  if (!chart) throw notFound();
  const { patient, admission } = await load(req, chart.patientId, chart.admissionId);
  return { chart, patient, admission };
}
const ids = (patient, admission, extra = {}) => ({ patientId: String(patient._id), mrn: patient.mrn, admissionId: String(admission._id), ...extra });

function view(c) {
  const total = totalLoss(c.losses);
  const obs = c.observations.filter((o) => !o.cancelled);
  const latest = obs.slice().sort((a, b) => new Date(b.at) - new Date(a.at))[0];
  return {
    id: String(c._id),
    recognisedAt: c.recognisedAt,
    causes: c.causes,
    status: c.status,
    totalLossMl: total,
    loss: lossBand(total),
    shock: latest ? shockIndex(latest.hr, latest.sbp) : null,
    losses: c.losses.map((l) => ({ id: String(l._id), at: l.at, ml: l.ml, method: l.method, byName: l.byName, enteredAt: l.enteredAt, cancelled: cancelView(l.cancelled) })),
    steps: c.steps.map((s) => ({ id: String(s._id), key: s.key, at: s.at, dose: s.dose, route: s.route, note: s.note, byName: s.byName, enteredAt: s.enteredAt, cancelled: cancelView(s.cancelled) })),
    observations: c.observations.map((o) => ({ id: String(o._id), at: o.at, hr: o.hr, sbp: o.sbp, dbp: o.dbp, spo2: o.spo2, shock: shockIndex(o.hr, o.sbp), byName: o.byName, enteredAt: o.enteredAt, cancelled: cancelView(o.cancelled) })),
    outcome: c.outcome ? { result: c.outcome.result, at: c.outcome.at, note: c.outcome.note, byName: c.outcome.byName } : null,
    createdByName: c.createdByName,
    cancelled: cancelView(c.cancelled),
  };
}
async function answer(req, res, chart, patient, status = 200) {
  res.status(status).json({ chart: view(chart), access: { write: mayWrite(req, patient) && chart.status === 'open' && !chart.cancelled, close: mayClose(req, patient) && chart.status === 'open' && !chart.cancelled } });
}

pphRouter.get('/', async (req, res) => {
  const q = parse(z.object({ patientId: objectId, admissionId: objectId }).strict(), req.query);
  const { patient, admission } = await load(req, q.patientId, q.admissionId);
  const charts = await PphChart.find({ tenantId: req.tenantId, admissionId: admission._id }).sort({ recognisedAt: -1, _id: -1 });
  await audit(req, 'PPH_CHART_VIEWED', { details: ids(patient, admission, { count: charts.length }) });
  res.json({
    charts: charts.map(view),
    access: { start: mayWrite(req, patient) && admission.status === 'admitted', write: mayWrite(req, patient), close: mayClose(req, patient) },
    rules: { causes: PPH_CAUSES, steps: PPH_STEPS, outcomes: PPH_OUTCOMES, lossMethods: LOSS_METHODS, source: PPH_SOURCE },
  });
});

const notFuture = (req, at, admission, field) => {
  const now = req.now ?? new Date();
  if (at.getTime() > now.getTime() + 5 * 60 * 1000) throw invalid({ [field]: "The time can't be in the future." });
  if (at < admission.admittedAt) throw invalid({ [field]: 'The time is before she was admitted – please check it.' });
};

pphRouter.post('/', async (req, res) => {
  const b = parse(z.object({ clientRequestId: z.uuid('Please reload the page and try again'), patientId: objectId, admissionId: objectId, recognisedAt: time('Recognised'), causes: z.array(z.enum(Object.keys(PPH_CAUSES))).default([]) }).strict(), req.body);
  const { patient, admission } = await load(req, b.patientId, b.admissionId);
  if (!mayWrite(req, patient)) throw forbidden('Only nurses, her doctor and RMOs write the PPH chart.');
  const same = await PphChart.findOne({ tenantId: req.tenantId, clientRequestId: b.clientRequestId });
  if (same) return answer(req, res, same, patient);
  if (admission.status !== 'admitted') throw conflict('She has been discharged: no new PPH chart can be started on this stay.');
  notFuture(req, b.recognisedAt, admission, 'recognisedAt');
  const chart = await PphChart.create({ tenantId: req.tenantId, patientId: patient._id, admissionId: admission._id, recognisedAt: b.recognisedAt, causes: [...new Set(b.causes)], source: PPH_SOURCE, createdByName: req.user.name, clientRequestId: b.clientRequestId });
  await audit(req, 'PPH_CHART_STARTED', { details: ids(patient, admission, { chartId: String(chart._id) }) });
  return answer(req, res, chart, patient, 201);
});

const lineBody = z.discriminatedUnion('type', [
  z.object({ type: z.literal('loss'), at: time('Time'), ml: z.coerce.number('Enter the amount in mL').int('Whole mL').min(1, 'Enter the amount in mL').max(10000, 'This looks too high – please check'), method: z.enum(Object.keys(LOSS_METHODS)) }).strict(),
  z.object({ type: z.literal('step'), at: time('Time'), key: z.enum(PPH_STEPS.map((s) => s.key)), dose: safeText('Dose', 60).default(''), route: safeText('Route', 40).default(''), note: safeText('Note', 300).default('') }).strict(),
  z.object({ type: z.literal('obs'), at: time('Time'), hr: num('Pulse', 20, 250), sbp: num('Systolic BP', 30, 260), dbp: num('Diastolic BP', 10, 160), spo2: num('SpO2', 50, 100) }).strict(),
]);
pphRouter.post('/:id/lines', async (req, res) => {
  const { chart, patient, admission } = await loadChart(req);
  if (!mayWrite(req, patient)) throw forbidden('Only nurses, her doctor and RMOs write the PPH chart.');
  if (chart.status !== 'open' || chart.cancelled) throw conflict('This PPH chart is closed.');
  const b = parse(lineBody, req.body);
  notFuture(req, b.at, admission, 'at');
  if (b.at < chart.recognisedAt) throw invalid({ at: 'This is before the bleeding was recognised – please check the time.' });
  const { type, ...line } = b;
  if (type === 'step') {
    const step = PPH_STEPS.find((s) => s.key === b.key);
    if (step.medicine && !b.dose) throw invalid({ dose: 'Write the dose given' });
    if (b.key === 'other' && !b.note) throw invalid({ note: 'Write what was done' });
    chart.steps.push({ ...line, ...stamp(req) });
  }
  if (type === 'loss') chart.losses.push({ ...line, ...stamp(req) });
  if (type === 'obs') {
    if ([b.hr, b.sbp, b.dbp, b.spo2].every((v) => v == null)) throw invalid({ hr: 'Enter at least one reading' });
    if ((b.sbp == null) !== (b.dbp == null)) throw invalid({ sbp: 'Enter both blood pressure numbers' });
    chart.observations.push({ ...line, ...stamp(req) });
  }
  await chart.save();
  await audit(req, 'PPH_CHART_LINE_ADDED', { details: ids(patient, admission, { chartId: String(chart._id), line: type, ...(type === 'step' ? { step: b.key } : {}) }) });
  return answer(req, res, chart, patient, 201);
});

pphRouter.post('/:id/causes', async (req, res) => {
  const { chart, patient, admission } = await loadChart(req);
  if (!mayWrite(req, patient)) throw forbidden('Only nurses, her doctor and RMOs write the PPH chart.');
  if (chart.status !== 'open' || chart.cancelled) throw conflict('This PPH chart is closed.');
  const { causes } = parse(z.object({ causes: z.array(z.enum(Object.keys(PPH_CAUSES))) }).strict(), req.body);
  chart.causes = [...new Set(causes)];
  await chart.save();
  await audit(req, 'PPH_CHART_LINE_ADDED', { details: ids(patient, admission, { chartId: String(chart._id), line: 'causes' }) });
  return answer(req, res, chart, patient);
});

const reasonBody = z.object({ reason: safeText('Reason', 300).refine((t) => t.trim().length >= 5, 'Please say why (at least 5 characters).') }).strict();
pphRouter.post('/:id/lines/:lineId/cancel', async (req, res) => {
  const { chart, patient, admission } = await loadChart(req);
  if (!mayWrite(req, patient)) throw forbidden('Only nurses, her doctor and RMOs write the PPH chart.');
  const { lineId } = parse(z.object({ id: objectId, lineId: objectId }), req.params);
  const { reason } = parse(reasonBody, req.body);
  const line = chart.losses.id(lineId) ?? chart.steps.id(lineId) ?? chart.observations.id(lineId);
  if (!line) throw new HttpError(404, 'This line was not found.', 'NOT_FOUND');
  if (line.cancelled) throw conflict('Already marked as entered in error.');
  line.cancelled = { reason, by: req.user._id, byName: req.user.name, at: req.now ?? new Date() };
  await chart.save();
  await audit(req, 'PPH_CHART_LINE_CANCELLED', { details: ids(patient, admission, { chartId: String(chart._id) }) });
  return answer(req, res, chart, patient);
});

pphRouter.post('/:id/close', async (req, res) => {
  const { chart, patient, admission } = await loadChart(req);
  if (!mayClose(req, patient)) throw forbidden('A PPH chart is closed by her doctor or an RMO.');
  if (chart.status !== 'open' || chart.cancelled) throw conflict('This PPH chart is already closed.');
  const b = parse(z.object({ result: z.enum(Object.keys(PPH_OUTCOMES), 'Choose how it ended'), at: time('Time'), note: safeText('Note', 1000).default('') }).strict(), req.body);
  notFuture(req, b.at, admission, 'at');
  if (b.result === 'other' && !b.note) throw invalid({ note: 'Write how it ended' });
  chart.outcome = { ...b, ...stamp(req) };
  chart.status = 'closed';
  await chart.save();
  await audit(req, 'PPH_CHART_CLOSED', { details: ids(patient, admission, { chartId: String(chart._id), result: b.result }) });
  return answer(req, res, chart, patient);
});

pphRouter.post('/:id/cancel', async (req, res) => {
  const { chart, patient, admission } = await loadChart(req);
  if (!mayWrite(req, patient)) throw forbidden('Only nurses, her doctor and RMOs write the PPH chart.');
  const { reason } = parse(reasonBody, req.body);
  if (chart.cancelled) throw conflict('Already marked as entered in error.');
  chart.cancelled = { reason, by: req.user._id, byName: req.user.name, at: req.now ?? new Date() };
  await chart.save();
  await audit(req, 'PPH_CHART_CANCELLED', { details: ids(patient, admission, { chartId: String(chart._id) }) });
  return answer(req, res, chart, patient);
});
