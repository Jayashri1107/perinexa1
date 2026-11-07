import { Router } from 'express';
import { z } from 'zod';
import { ALERT_KINDS, ALERT_KIND_KEYS, ALERT_SOURCE } from '../clinical/patientAlerts.js';
import { PatientAlert } from '../models/PatientAlert.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { findPatientById } from '../utils/patientLookup.js';
import { safeText } from '../utils/pcpndt.js';
import { objectId, parse } from '../utils/validate.js';

// Alerts that follow the patient (Clinical Requirements Group C – PX-X-13; DRAFT list, clinical/patientAlerts.js):
// /api/patient-alerts.
//  - GET /band?patientId=: the safety band for a screen outside her record (her stay, her operation): allergies,
//    blood group, EDD, anti-D, breastfeeding and the alerts in force;
//  - GET /?patientId=: every alert with the ended ones (her record's Overview);
//  - POST /: add an alert; POST /:id/end: it no longer applies – ended with a reason, never deleted.
// Who: those who may see her medical details see them; her doctor, RMOs and nurses (who may write her chart) add and
// end them. The audit log gets ids and the kind – never the note.

export const patientAlertsRouter = Router();
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const mayView = (access) => access.view.has('medical');
const mayWrite = (access) => access.editClinical === true || access.recordVitals === true;

export const alertView = (a) => ({
  id: String(a._id),
  kind: a.kind,
  label: ALERT_KINDS[a.kind]?.label ?? a.kind,
  note: a.note,
  byName: a.byName,
  at: a.createdAt,
  ended: a.ended ? { reason: a.ended.reason, byName: a.ended.byName, at: a.ended.at } : null,
});

/** The alerts in force on a patient (oldest first), for her record and the band. */
export async function activeAlerts(tenantId, patientId) {
  const list = await PatientAlert.find({ tenantId, patientId, ended: null }).sort({ createdAt: 1 }).lean();
  return list.map(alertView);
}

async function load(req, patientId) {
  const patient = await findPatientById(req.tenantId, patientId);
  const access = patientAccess(req, patient);
  if (!mayView(access)) throw forbidden("You can't see this patient's medical details.");
  return { patient, access };
}
const ids = (patient, extra = {}) => ({ patientId: String(patient._id), mrn: patient.mrn, ...extra });
const rules = { kinds: ALERT_KINDS, source: ALERT_SOURCE };

patientAlertsRouter.get('/band', async (req, res) => {
  const q = parse(z.object({ patientId: objectId }).strict(), req.query);
  const { patient, access } = await load(req, q.patientId);
  const p = patient.toObject();
  await audit(req, 'PATIENT_ALERTS_VIEWED', { details: ids(patient, { from: 'band' }) });
  res.json({
    patient: {
      id: String(patient._id),
      careType: p.careType,
      medical: { allergies: p.medical?.allergies ?? '', bloodGroup: p.medical?.bloodGroup ?? '' },
      ...(p.pregnancy?.effectiveEdd ? { pregnancy: { effectiveEdd: p.pregnancy.effectiveEdd } } : {}),
      ...(p.careType === 'abortion' && p.abortion ? { abortion: { lossType: p.abortion.lossType, antiD: p.abortion.antiD ?? null } } : {}),
      ...(p.careType === 'postnatal' ? { postnatal: { breastfeeding: p.postnatal?.breastfeeding ?? '' } } : {}),
    },
    alerts: await activeAlerts(req.tenantId, patient._id),
    access: { write: mayWrite(access) },
  });
});

patientAlertsRouter.get('/', async (req, res) => {
  const q = parse(z.object({ patientId: objectId }).strict(), req.query);
  const { patient, access } = await load(req, q.patientId);
  const list = await PatientAlert.find({ tenantId: req.tenantId, patientId: patient._id }).sort({ createdAt: -1 }).limit(200).lean();
  await audit(req, 'PATIENT_ALERTS_VIEWED', { details: ids(patient) });
  res.json({ alerts: list.map(alertView), access: { write: mayWrite(access) }, rules });
});

const addBody = z
  .object({
    patientId: objectId,
    kind: z.enum(ALERT_KIND_KEYS, 'Choose the kind of alert'),
    note: safeText('Note', 300).default(''),
  })
  .strict();

patientAlertsRouter.post('/', async (req, res) => {
  const b = parse(addBody, req.body);
  const { patient, access } = await load(req, b.patientId);
  if (!mayWrite(access)) throw forbidden('Only her doctor, RMOs and nurses add alerts.');
  const note = b.note.trim();
  if (['other', 'infection_precautions', 'needs_interpreter', 'implant_device'].includes(b.kind) && note.length < 3) {
    throw Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields: { note: ALERT_KINDS[b.kind].hint } });
  }
  const same = await PatientAlert.findOne({ tenantId: req.tenantId, patientId: patient._id, kind: b.kind, ended: null });
  if (same && b.kind !== 'other') throw new HttpError(409, `“${ALERT_KINDS[b.kind].label}” is already on her record. End it first to write it again.`, 'CONFLICT');
  const alert = await PatientAlert.create({ tenantId: req.tenantId, patientId: patient._id, kind: b.kind, note, by: req.user._id, byName: req.user.name });
  await audit(req, 'PATIENT_ALERT_ADDED', { details: ids(patient, { alertId: String(alert._id), kind: b.kind }) });
  res.status(201).json({ alert: alertView(alert) });
});

patientAlertsRouter.post('/:id/end', async (req, res) => {
  const { id } = parse(z.object({ id: objectId }).strict(), req.params);
  const b = parse(z.object({ reason: safeText('Reason', 200).refine((v) => v.trim().length >= 3, 'Write why it no longer applies') }).strict(), req.body);
  const alert = await PatientAlert.findOne({ _id: id, tenantId: req.tenantId });
  if (!alert) throw new HttpError(404, 'This alert was not found.', 'NOT_FOUND');
  const { patient, access } = await load(req, alert.patientId);
  if (!mayWrite(access)) throw forbidden('Only her doctor, RMOs and nurses end alerts.');
  if (alert.ended) throw new HttpError(409, 'This alert was already ended.', 'CONFLICT');
  alert.ended = { reason: b.reason.trim(), by: req.user._id, byName: req.user.name, at: req.now ?? new Date() };
  await alert.save();
  await audit(req, 'PATIENT_ALERT_ENDED', { details: ids(patient, { alertId: String(alert._id), kind: alert.kind }) });
  res.json({ alert: alertView(alert) });
});
