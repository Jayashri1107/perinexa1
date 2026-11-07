import { Router } from 'express';
import { z } from 'zod';
import { ASA, COMORBIDITIES, FASTING, FITNESS, MALLAMPATI, NAUSEA, PAC_SOURCE, PAIN_SOURCE, PLANNED_ANAESTHESIA, POSS, fastingHours, pacMissing, painBand, sedationBand } from '../clinical/anaesthesia.js';
import { Admission } from '../models/Admission.js';
import { PacAssessment, PainEntry } from '../models/AnaesthesiaRecords.js';
import { hasRole } from '../models/Membership.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { findPatientById } from '../utils/patientLookup.js';
import { safeText } from '../utils/pcpndt.js';
import { objectId, parse } from '../utils/validate.js';

// The pre-anaesthesia check-up and the pain chart (Clinical Requirements Group B, items 9 and 10 – DRAFT,
// clinical/anaesthesia.js): /api/anaesthesia.
//  - GET /pac?patientId=: her check-ups, newest first; POST /pac: a doctor or RMO writes and signs one in one go;
//  - GET /pain?patientId=&admissionId=: the stay's pain chart; POST /pain: a score (nurses, her doctor, RMOs); POST /pain/
//    :id/cancel and /pac/:id/cancel: entered in error with a reason.
// Those who may see her medical details read them. A sedation score of 3 or 4 needs whom you told. The audit log gets
// ids, the fitness and the band – never the details.

export const anaesthesiaRouter = Router();
const ROLES = ['doctor', 'rmo', 'nurse'];
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const conflict = (m) => new HttpError(409, m, 'CONFLICT');
const invalid = (fields, message = 'Please check the highlighted fields.') => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields });
const time = (label) => z.iso.datetime(`${label}: please enter a valid date and time`).transform((v) => new Date(v));
const optTime = (label) => z.union([time(label), z.null()]).default(null);

anaesthesiaRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...ROLES)) throw forbidden('Anaesthesia records are for doctors, RMOs and nurses.');
  next();
});
const mayView = (req, p) => patientAccess(req, p).view.has('pregnancy');
const mayChart = (req, p) => {
  const a = patientAccess(req, p);
  return a.editClinical || a.recordVitals;
};
const mayPac = (req, p) => hasRole(req.membership, 'doctor', 'rmo') && patientAccess(req, p).editClinical;
async function patientFor(req, id) {
  const patient = await findPatientById(req.tenantId, id);
  if (!mayView(req, patient)) throw forbidden("You can't see this patient's medical details.");
  return patient;
}
const ids = (patient, extra = {}) => ({ patientId: String(patient._id), mrn: patient.mrn, ...extra });
const cancelView = (c) => (c ? { reason: c.reason, byName: c.byName, at: c.at } : null);
const reasonBody = z.object({ reason: safeText('Reason', 300).refine((t) => t.trim().length >= 5, 'Please say why (at least 5 characters).') }).strict();

// ---------- Pre-anaesthesia check-up ----------
const pacView = (p) => ({
  id: String(p._id),
  assessedAt: p.assessedAt,
  procedure: p.procedure,
  asa: p.asa,
  emergency: p.emergency,
  weightKg: p.weightKg,
  airwayMallampati: p.airwayMallampati,
  mouthOpeningOk: p.mouthOpeningOk,
  neckMovementOk: p.neckMovementOk,
  comorbidities: p.comorbidities,
  comorbidityNote: p.comorbidityNote,
  medicines: p.medicines,
  allergies: p.allergies,
  previousAnaesthesia: p.previousAnaesthesia,
  lastSolidAt: p.lastSolidAt,
  lastClearAt: p.lastClearAt,
  fasting: fastingHours(p.assessedAt, p.lastSolidAt, p.lastClearAt),
  investigations: p.investigations,
  plannedAnaesthesia: p.plannedAnaesthesia,
  risksExplained: p.risksExplained,
  fitness: p.fitness,
  fitnessNote: p.fitnessNote,
  byName: p.byName,
  role: p.role,
  cancelled: cancelView(p.cancelled),
});
export const PAC_RULES = { asa: ASA, mallampati: MALLAMPATI, comorbidities: COMORBIDITIES, planned: PLANNED_ANAESTHESIA, fitness: FITNESS, fasting: FASTING, source: PAC_SOURCE };

/** Her latest check-up still in use (not entered in error), or null – for the theatre case page. */
export async function latestPac(tenantId, patientId) {
  const p = await PacAssessment.findOne({ tenantId, patientId, cancelled: null }).sort({ assessedAt: -1 }).lean();
  return p ? { id: String(p._id), assessedAt: p.assessedAt, asa: p.asa, emergency: p.emergency, fitness: p.fitness, fitnessNote: p.fitnessNote, plannedAnaesthesia: p.plannedAnaesthesia, byName: p.byName } : null;
}

anaesthesiaRouter.get('/pac', async (req, res) => {
  const { patientId } = parse(z.object({ patientId: objectId }).strict(), req.query);
  const patient = await patientFor(req, patientId);
  const list = await PacAssessment.find({ tenantId: req.tenantId, patientId: patient._id }).sort({ assessedAt: -1 }).lean();
  await audit(req, 'PAC_VIEWED', { details: ids(patient) });
  res.json({ assessments: list.map(pacView), access: { write: mayPac(req, patient) && patient.careType !== 'newborn' }, rules: PAC_RULES });
});

const pacBody = z
  .object({
    clientRequestId: z.uuid('Please reload the page and try again'),
    patientId: objectId,
    assessedAt: time('Assessed'),
    procedure: safeText('Operation', 300).default(''),
    asa: z.enum(['', ...Object.keys(ASA)]).default(''),
    emergency: z.boolean().default(false),
    weightKg: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.union([z.null(), z.coerce.number('Weight must be a number').min(20, 'Weight looks too low').max(250, 'Weight looks too high')])).default(null),
    airwayMallampati: z.enum(['', ...Object.keys(MALLAMPATI)]).default(''),
    mouthOpeningOk: z.boolean().default(true),
    neckMovementOk: z.boolean().default(true),
    comorbidities: z.array(z.enum(Object.keys(COMORBIDITIES))).default([]),
    comorbidityNote: safeText('Other condition', 500).default(''),
    medicines: safeText('Medicines', 1000).default(''),
    allergies: safeText('Allergies', 500).default(''),
    previousAnaesthesia: safeText('Previous anaesthesia', 500).default(''),
    lastSolidAt: optTime('Last solid food'),
    lastClearAt: optTime('Last clear fluid'),
    investigations: safeText('Investigations', 1000).default(''),
    plannedAnaesthesia: z.enum(['', ...Object.keys(PLANNED_ANAESTHESIA)]).default(''),
    risksExplained: z.boolean().default(false),
    fitness: z.enum(['', ...Object.keys(FITNESS)]).default(''),
    fitnessNote: safeText('Conditions', 1000).default(''),
  })
  .strict();
anaesthesiaRouter.post('/pac', async (req, res) => {
  const b = parse(pacBody, req.body);
  const patient = await patientFor(req, b.patientId);
  if (!mayPac(req, patient)) throw forbidden('A pre-anaesthesia check-up is written by a doctor (the anaesthetist) or an RMO who may write in her record.');
  if (patient.careType === 'newborn') throw invalid({ patientId: 'This check-up form is for adults.' });
  const same = await PacAssessment.findOne({ tenantId: req.tenantId, clientRequestId: b.clientRequestId });
  if (same) return res.json({ assessment: pacView(same) });
  const now = req.now ?? new Date();
  if (b.assessedAt.getTime() > now.getTime() + 5 * 60 * 1000) throw invalid({ assessedAt: "This can't be in the future." });
  for (const f of ['lastSolidAt', 'lastClearAt']) if (b[f] && b[f] > b.assessedAt) throw invalid({ [f]: 'This is after the check-up – please check it.' });
  const missing = pacMissing(b);
  if (Object.keys(missing).length) throw invalid(missing, 'Fill in the highlighted parts before signing the check-up.');
  const p = await PacAssessment.create({ ...b, comorbidities: [...new Set(b.comorbidities)], tenantId: req.tenantId, patientId: patient._id, by: req.user._id, byName: req.user.name, role: hasRole(req.membership, 'doctor') ? 'Doctor' : 'RMO', source: PAC_SOURCE });
  await audit(req, 'PAC_RECORDED', { details: ids(patient, { pacId: String(p._id), fitness: p.fitness }) });
  res.status(201).json({ assessment: pacView(p) });
});

anaesthesiaRouter.post('/pac/:id/cancel', async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const { reason } = parse(reasonBody, req.body);
  const p = await PacAssessment.findOne({ _id: id, tenantId: req.tenantId });
  if (!p) throw new HttpError(404, 'This check-up was not found.', 'NOT_FOUND');
  const patient = await patientFor(req, p.patientId);
  if (!mayPac(req, patient)) throw forbidden('Only a doctor or an RMO may change this record.');
  if (p.cancelled) throw conflict('Already marked as entered in error.');
  p.cancelled = { reason, by: req.user._id, byName: req.user.name, at: req.now ?? new Date() };
  await p.save();
  await audit(req, 'PAC_CANCELLED', { details: ids(patient, { pacId: String(p._id) }) });
  res.json({ assessment: pacView(p) });
});

// ---------- Pain chart ----------
const painView = (e) => ({ id: String(e._id), at: e.at, score: e.score, pain: painBand(e.score), poss: e.poss, sedation: e.poss ? sedationBand(Number(e.poss)) : null, nausea: e.nausea, action: e.action, escalatedTo: e.escalatedTo, byName: e.byName, cancelled: cancelView(e.cancelled) });
async function stayFor(req, patient, admissionId) {
  const a = await Admission.findOne({ _id: admissionId, tenantId: req.tenantId, patientId: patient._id });
  if (!a) throw new HttpError(404, 'This stay was not found.', 'NOT_FOUND');
  return a;
}
anaesthesiaRouter.get('/pain', async (req, res) => {
  const q = parse(z.object({ patientId: objectId, admissionId: objectId }).strict(), req.query);
  const patient = await patientFor(req, q.patientId);
  const admission = await stayFor(req, patient, q.admissionId);
  const entries = await PainEntry.find({ tenantId: req.tenantId, admissionId: admission._id }).sort({ at: -1, _id: -1 }).limit(500).lean();
  await audit(req, 'PAIN_CHART_VIEWED', { details: ids(patient, { admissionId: String(admission._id) }) });
  res.json({ entries: entries.map(painView), access: { write: mayChart(req, patient) && admission.status === 'admitted' }, rules: { poss: POSS, nausea: NAUSEA, source: PAIN_SOURCE } });
});
const painBody = z
  .object({
    clientRequestId: z.uuid('Please reload the page and try again'),
    patientId: objectId,
    admissionId: objectId,
    at: time('Time'),
    score: z.coerce.number('Choose the pain score').int().min(0, 'From 0').max(10, 'Up to 10'),
    poss: z.enum(['', ...Object.keys(POSS)]).default(''),
    nausea: z.enum(['', ...Object.keys(NAUSEA)]).default(''),
    action: safeText('What was done', 300).default(''),
    escalatedTo: safeText('Told whom', 150).default(''),
  })
  .strict();
anaesthesiaRouter.post('/pain', async (req, res) => {
  const b = parse(painBody, req.body);
  const patient = await patientFor(req, b.patientId);
  if (!mayChart(req, patient)) throw forbidden('Only nurses, her doctor and RMOs write the pain chart.');
  const admission = await stayFor(req, patient, b.admissionId);
  const same = await PainEntry.findOne({ tenantId: req.tenantId, clientRequestId: b.clientRequestId });
  if (same) return res.json({ entry: painView(same) });
  if (admission.status !== 'admitted') throw conflict('She has been discharged: the pain chart is closed.');
  const now = req.now ?? new Date();
  if (b.at.getTime() > now.getTime() + 5 * 60 * 1000) throw invalid({ at: "The time can't be in the future." });
  if (b.at < admission.admittedAt) throw invalid({ at: 'The time is before she was admitted – please check it.' });
  if (Number(b.poss) >= 3 && !b.escalatedTo) throw invalid({ escalatedTo: 'Too sedated: hold opioids, tell the anaesthetist now, and write whom you told' });
  if (b.score >= 7 && !b.action) throw invalid({ action: 'Severe pain: write what was done' });
  const e = await PainEntry.create({ ...b, tenantId: req.tenantId, patientId: patient._id, admissionId: admission._id, by: req.user._id, byName: req.user.name });
  await audit(req, 'PAIN_RECORDED', { details: ids(patient, { admissionId: String(admission._id), entryId: String(e._id), band: painBand(e.score).band }) });
  res.status(201).json({ entry: painView(e) });
});
anaesthesiaRouter.post('/pain/:id/cancel', async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const { reason } = parse(reasonBody, req.body);
  const e = await PainEntry.findOne({ _id: id, tenantId: req.tenantId });
  if (!e) throw new HttpError(404, 'This entry was not found.', 'NOT_FOUND');
  const patient = await patientFor(req, e.patientId);
  if (!mayChart(req, patient)) throw forbidden('Only nurses, her doctor and RMOs write the pain chart.');
  if (e.cancelled) throw conflict('Already marked as entered in error.');
  e.cancelled = { reason, by: req.user._id, byName: req.user.name, at: req.now ?? new Date() };
  await e.save();
  await audit(req, 'PAIN_CANCELLED', { details: ids(patient, { entryId: String(e._id) }) });
  res.json({ entry: painView(e) });
});
