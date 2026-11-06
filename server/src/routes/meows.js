import { Router } from 'express';
import { z } from 'zod';
import { AVPU, MEOWS_PARAMETERS, MEOWS_SOURCE, meowsResult, toCelsius } from '../clinical/meows.js';
import { Admission } from '../models/Admission.js';
import { MeowsEntry } from '../models/MeowsEntry.js';
import { hasRole } from '../models/Membership.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { findPatientById } from '../utils/patientLookup.js';
import { safeText } from '../utils/pcpndt.js';
import { objectId, parse } from '../utils/validate.js';

// The MEOWS chart of a stay (Clinical Requirements Group B, item 8 – DRAFT rules, clinical/meows.js): /api/meows.
//  - GET /?patientId=&admissionId=: the stay's observations, newest first, with the latest level;
//  - POST /: a set of observations – the server works out each band and the level; a TRIGGER needs whom you told;
//  - POST /:id/cancel: written by mistake – marked "entered in error" with a reason, never changed or deleted.
// Who: those who may see her medical details read it; nurses, her doctor and RMOs write it (as the nursing chart).
// Not on a baby's record (MEOWS is for the mother). The audit log gets ids and the level – never the readings.

export const meowsRouter = Router();
const ROLES = ['doctor', 'rmo', 'nurse'];
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

async function load(req, patientId, admissionId) {
  const patient = await findPatientById(req.tenantId, patientId);
  if (!mayView(req, patient)) throw forbidden("You can't see this patient's medical details.");
  if (patient.careType === 'newborn') throw invalid({ patientId: 'The MEOWS chart is for the mother, not a baby.' });
  const admission = await Admission.findOne({ _id: admissionId, tenantId: req.tenantId, patientId: patient._id });
  if (!admission) throw new HttpError(404, 'This stay was not found.', 'NOT_FOUND');
  return { patient, admission };
}
const ids = (patient, admission, extra = {}) => ({ patientId: String(patient._id), mrn: patient.mrn, admissionId: String(admission._id), ...extra });
const view = (e) => ({
  id: String(e._id),
  at: e.at,
  values: e.values,
  bands: e.bands,
  level: e.level,
  escalatedTo: e.escalatedTo,
  note: e.note,
  byName: e.byName,
  enteredAt: e.createdAt,
  cancelled: e.cancelled ? { reason: e.cancelled.reason, byName: e.cancelled.byName, at: e.cancelled.at } : null,
});

meowsRouter.get('/', async (req, res) => {
  const q = parse(z.object({ patientId: objectId, admissionId: objectId }).strict(), req.query);
  const { patient, admission } = await load(req, q.patientId, q.admissionId);
  const entries = await MeowsEntry.find({ tenantId: req.tenantId, admissionId: admission._id }).sort({ at: -1, _id: -1 }).limit(500).lean();
  await audit(req, 'MEOWS_VIEWED', { details: ids(patient, admission) });
  const latest = entries.find((e) => !e.cancelled) ?? null;
  res.json({
    entries: entries.map(view),
    latest: latest ? view(latest) : null,
    access: { write: mayWrite(req, patient) && admission.status === 'admitted' },
    rules: { parameters: MEOWS_PARAMETERS, avpu: AVPU, source: MEOWS_SOURCE },
  });
});

const reading = (label, min, max) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), z.union([z.null(), z.coerce.number(`${label} must be a number`).min(min, `${label} looks too low – please check`).max(max, `${label} looks too high – please check`)])).default(null);
const body = z
  .object({
    clientRequestId: z.uuid('Please reload the page and try again'),
    patientId: objectId,
    admissionId: objectId,
    at: z.iso.datetime('Please enter a valid date and time').transform((v) => new Date(v)),
    rr: reading('Respiratory rate', 0, 80),
    spo2: reading('SpO2', 50, 100),
    temp: reading('Temperature', 30, 110),
    tempUnit: z.enum(['C', 'F']).default('C'),
    sbp: reading('Systolic BP', 40, 260),
    dbp: reading('Diastolic BP', 20, 160),
    hr: reading('Heart rate', 20, 250),
    avpu: z.enum(['', 'A', 'V', 'P', 'U']).default(''),
    escalatedTo: safeText('Told whom', 150).default(''),
    note: safeText('Note', 1000).default(''),
  })
  .strict();

meowsRouter.post('/', async (req, res) => {
  const b = parse(body, req.body);
  const { patient, admission } = await load(req, b.patientId, b.admissionId);
  if (!mayWrite(req, patient)) throw forbidden('Only nurses, her doctor and RMOs write the MEOWS chart.');
  const same = await MeowsEntry.findOne({ tenantId: req.tenantId, clientRequestId: b.clientRequestId });
  if (same) return res.status(200).json({ entry: view(same) });
  if (admission.status !== 'admitted') throw conflict('She has been discharged: the MEOWS chart is closed.');
  const now = req.now ?? new Date();
  if (b.at.getTime() > now.getTime() + 5 * 60 * 1000) throw invalid({ at: "The time can't be in the future." });
  if (b.at < admission.admittedAt) throw invalid({ at: 'The time is before she was admitted – please check it.' });
  const tempC = b.temp == null ? null : b.tempUnit === 'F' ? toCelsius(b.temp) : b.temp;
  if (tempC != null && (tempC < 30 || tempC > 43)) throw invalid({ temp: 'The temperature looks wrong – please check the number and °C / °F.' });
  if ((b.sbp == null) !== (b.dbp == null)) throw invalid({ sbp: 'Enter both blood pressure numbers' });
  const values = { rr: b.rr, spo2: b.spo2, tempC, sbp: b.sbp, dbp: b.dbp, hr: b.hr, avpu: b.avpu || null };
  const r = meowsResult(values);
  if (r.missing.length === 7) throw invalid({ rr: 'Enter at least one observation' });
  if (r.level === 'trigger' && !b.escalatedTo) throw invalid({ escalatedTo: 'This is a trigger: tell the doctor now, and write whom you told' });
  const entry = await MeowsEntry.create({
    tenantId: req.tenantId,
    patientId: patient._id,
    admissionId: admission._id,
    at: b.at,
    values,
    bands: r.bands,
    level: r.level,
    escalatedTo: b.escalatedTo,
    note: b.note,
    source: MEOWS_SOURCE,
    by: req.user._id,
    byName: req.user.name,
    clientRequestId: b.clientRequestId,
  });
  await audit(req, 'MEOWS_RECORDED', { details: ids(patient, admission, { entryId: String(entry._id), level: entry.level }) });
  res.status(201).json({ entry: view(entry) });
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
