import { Router } from 'express';
import { z } from 'zod';
import { Admission } from '../models/Admission.js';
import { nextNumber } from '../models/Counter.js';
import { hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { SPECIMEN_KINDS, Specimen } from '../models/Specimen.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { findPatientById } from '../utils/patientLookup.js';
import { safeText } from '../utils/pcpndt.js';
import { fileEntry, fileUploadSchema, findFile, sendFile, storeFile } from '../utils/storedFiles.js';
import { objectId, parse } from '../utils/validate.js';

// Specimens and histopathology (Clinical Requirements Group A, item 3 – PX-OT-04; register OBG-L-05): /api/specimens.
//  - log a specimen when it is sent; enter the report (and attach its file) when it comes back; a doctor or RMO
//    reviews it and records that she was told; a mistake is cancelled with a reason (never deleted);
//  - the overdue list: sent more than OVERDUE_DAYS days ago with no report.
// Who: doctors, RMOs and nurses who may see her medical details (utils/patientAccess.js) – a sensitive record's
// specimens only for those who see that record in full. Reviewing: doctors and RMOs. Every action is audited (ids).

export const specimensRouter = Router();
export const OVERDUE_DAYS = 21; // the owner's specification (PX-OT-04)
const DAY_MS = 24 * 60 * 60 * 1000;
const ROLES = ['doctor', 'rmo', 'nurse'];
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const notFound = () => new HttpError(404, 'This specimen was not found.', 'NOT_FOUND');
const conflict = (m) => new HttpError(409, m, 'CONFLICT');
const invalid = (fields) => Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });
const time = (label) => z.iso.datetime(`${label}: please enter a valid date and time`).transform((v) => new Date(v));

specimensRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...ROLES)) throw forbidden('Specimens are for doctors, RMOs and nurses.');
  next();
});

const mayView = (req, patient) => patientAccess(req, patient).view.has('pregnancy');
const mayWrite = (req, patient) => {
  const a = patientAccess(req, patient);
  return a.editClinical || a.recordVitals;
};
const mayReview = (req, patient) => hasRole(req.membership, 'doctor', 'rmo') && patientAccess(req, patient).editClinical;

/** Days since it was sent, and whether it is overdue (sent, no report, more than 21 days). PURE. */
export function overdue(s, now = new Date()) {
  const days = Math.floor((now.getTime() - new Date(s.sentAt).getTime()) / DAY_MS);
  return { days, overdue: s.status === 'sent' && days > OVERDUE_DAYS };
}

const view = (s, patient, now) => ({
  id: String(s._id),
  serial: s.serial,
  patientId: String(s.patientId),
  patient: patient ? { fullName: patient.fullName, mrn: patient.mrn } : null,
  admissionId: s.admissionId ? String(s.admissionId) : null,
  kind: s.kind,
  specimen: s.specimen,
  procedure: s.procedure,
  collectedAt: s.collectedAt,
  sentAt: s.sentAt,
  lab: s.lab,
  labReference: s.labReference,
  status: s.status,
  ...overdue(s, now),
  report: s.report ? { receivedAt: s.report.receivedAt, summary: s.report.summary, file: s.report.file?.fileId ? { ...s.report.file, fileId: String(s.report.file.fileId) } : null, byName: s.report.byName, at: s.report.at } : null,
  review: s.review ? { note: s.review.note, informedAt: s.review.informedAt, byName: s.review.byName, at: s.review.at } : null,
  cancelled: s.cancelled ? { reason: s.cancelled.reason, byName: s.cancelled.byName, at: s.cancelled.at } : null,
  createdByName: s.createdByName,
  createdAt: s.createdAt,
});

async function loadOne(req) {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const s = await Specimen.findOne({ _id: id, tenantId: req.tenantId });
  if (!s) throw notFound();
  const patient = await findPatientById(req.tenantId, s.patientId);
  if (!mayView(req, patient)) throw notFound();
  return { s, patient };
}

// The list: open (sent, no report yet), overdue, reported (to review), or all; or one patient's
const listQuery = z.object({ show: z.enum(['open', 'overdue', 'reported', 'all']).default('open'), patientId: objectId.optional() }).strict();
specimensRouter.get('/', async (req, res) => {
  const q = parse(listQuery, req.query);
  const now = req.now ?? new Date();
  const filter = { tenantId: req.tenantId };
  if (q.patientId) filter.patientId = q.patientId;
  if (q.show === 'open') filter.status = 'sent';
  if (q.show === 'overdue') Object.assign(filter, { status: 'sent', sentAt: { $lt: new Date(now.getTime() - OVERDUE_DAYS * DAY_MS) } });
  if (q.show === 'reported') filter.status = 'reported';
  const items = await Specimen.find(filter).sort({ sentAt: 1, _id: 1 }).limit(500).lean();
  const patients = await Patient.find({ tenantId: req.tenantId, _id: { $in: [...new Set(items.map((s) => String(s.patientId)))] } });
  const byId = new Map(patients.map((p) => [String(p._id), p]));
  const shown = items.filter((s) => byId.has(String(s.patientId)) && mayView(req, byId.get(String(s.patientId))));
  await audit(req, 'SPECIMENS_VIEWED', { details: { show: q.show, count: shown.length, ...(q.patientId ? { patientId: q.patientId } : {}) } });
  res.json({ specimens: shown.map((s) => view(s, byId.get(String(s.patientId)), now)), overdueDays: OVERDUE_DAYS });
});

const createBody = z
  .object({
    clientRequestId: z.uuid('Please reload the page and try again'),
    patientId: objectId,
    admissionId: objectId.nullable().default(null),
    kind: z.enum(SPECIMEN_KINDS, 'Choose the kind of examination'),
    specimen: safeText('Specimen', 300).refine((v) => v.length > 0, 'Write what was sent'),
    procedure: safeText('Procedure', 300).default(''),
    collectedAt: time('Collected'),
    sentAt: time('Sent'),
    lab: safeText('Laboratory', 200).default(''),
    labReference: safeText('Laboratory reference', 100).default(''),
  })
  .strict();
specimensRouter.post('/', async (req, res) => {
  const body = parse(createBody, req.body);
  const same = await Specimen.findOne({ tenantId: req.tenantId, clientRequestId: body.clientRequestId });
  const patient = await findPatientById(req.tenantId, body.patientId);
  if (!mayWrite(req, patient)) throw forbidden('You can log specimens only for patients whose medical record you may write in.');
  if (same) return res.status(200).json({ specimen: view(same, patient, req.now ?? new Date()) });
  const now = req.now ?? new Date();
  if (body.admissionId && !(await Admission.findOne({ _id: body.admissionId, tenantId: req.tenantId, patientId: patient._id }))) throw invalid({ admissionId: 'This stay was not found.' });
  if (body.sentAt < body.collectedAt) throw invalid({ sentAt: 'It can only be sent after it was collected.' });
  if (body.collectedAt.getTime() > now.getTime() + 5 * 60 * 1000 || body.sentAt.getTime() > now.getTime() + 5 * 60 * 1000) throw invalid({ sentAt: "This can't be in the future." });
  const s = await Specimen.create({
    ...body,
    tenantId: req.tenantId,
    serial: await nextNumber(req.tenantId, 'specimen'),
    createdBy: req.user._id,
    createdByName: req.user.name,
  });
  await audit(req, 'SPECIMEN_LOGGED', { details: { patientId: String(patient._id), mrn: patient.mrn, specimenId: String(s._id), serial: s.serial } });
  res.status(201).json({ specimen: view(s, patient, now) });
});

specimensRouter.get('/:id', async (req, res) => {
  const { s, patient } = await loadOne(req);
  await audit(req, 'SPECIMEN_VIEWED', { details: { patientId: String(patient._id), mrn: patient.mrn, specimenId: String(s._id) } });
  res.json({ specimen: view(s, patient, req.now ?? new Date()), access: { write: mayWrite(req, patient), review: mayReview(req, patient) } });
});

// The report came back: when, what it says, and (optionally) its file
const reportBody = z.object({ receivedAt: time('Report received'), summary: safeText('Report', 4000).refine((v) => v.length > 0, 'Write what the report says'), file: fileUploadSchema.nullable().default(null) }).strict();
specimensRouter.post('/:id/report', async (req, res) => {
  const { s, patient } = await loadOne(req);
  if (!mayWrite(req, patient)) throw forbidden('You can enter reports only for patients whose medical record you may write in.');
  const body = parse(reportBody, req.body);
  if (s.status !== 'sent') throw conflict(s.status === 'cancelled' ? 'This specimen was cancelled.' : `The report was already entered by ${s.report?.byName}.`);
  if (body.receivedAt < s.sentAt) throw invalid({ receivedAt: 'The report can only come back after the specimen was sent.' });
  const at = req.now ?? new Date();
  const stored = body.file ? await storeFile(req, { patientId: patient._id, kind: 'specimen_report', ownerId: s._id, body: body.file }) : null;
  const r = await Specimen.updateOne(
    { _id: s._id, tenantId: req.tenantId, status: 'sent' },
    { $set: { status: 'reported', report: { receivedAt: body.receivedAt, summary: body.summary, file: stored ? fileEntry(stored, {}) : null, by: req.user._id, byName: req.user.name, at } } },
  );
  if (!r.matchedCount) throw conflict('Someone entered the report at the same moment. Reload to see it.');
  await audit(req, 'SPECIMEN_REPORTED', { details: { patientId: String(patient._id), mrn: patient.mrn, specimenId: String(s._id), file: Boolean(stored) } });
  res.json({ specimen: view(await Specimen.findOne({ _id: s._id, tenantId: req.tenantId }), patient, at) });
});

// The report's file (opened through apiFile in the website, so the hospital header is sent)
specimensRouter.get('/:id/file', async (req, res) => {
  const { s, patient } = await loadOne(req);
  if (!s.report?.file?.fileId) throw new HttpError(404, 'This report has no file.', 'NOT_FOUND');
  const file = await findFile(req, { kind: 'specimen_report', ownerId: s._id, fileId: s.report.file.fileId });
  await audit(req, 'SPECIMEN_REPORT_OPENED', { details: { patientId: String(patient._id), mrn: patient.mrn, specimenId: String(s._id) } });
  sendFile(res, file);
});

// Reviewed by a doctor or RMO, and whether she was told
const reviewBody = z.object({ note: safeText('Note', 2000).default(''), informedAt: z.union([time('Told her'), z.null()]).default(null) }).strict();
specimensRouter.post('/:id/review', async (req, res) => {
  const { s, patient } = await loadOne(req);
  if (!mayReview(req, patient)) throw forbidden('A report is reviewed by her doctor or an RMO.');
  const body = parse(reviewBody, req.body);
  if (s.status !== 'reported') throw conflict(s.status === 'reviewed' ? `Already reviewed by ${s.review?.byName}.` : 'Enter the report first.');
  const at = req.now ?? new Date();
  await Specimen.updateOne({ _id: s._id, tenantId: req.tenantId, status: 'reported' }, { $set: { status: 'reviewed', review: { ...body, by: req.user._id, byName: req.user.name, at } } });
  await audit(req, 'SPECIMEN_REVIEWED', { details: { patientId: String(patient._id), mrn: patient.mrn, specimenId: String(s._id), informed: Boolean(body.informedAt) } });
  res.json({ specimen: view(await Specimen.findOne({ _id: s._id, tenantId: req.tenantId }), patient, at) });
});

// Logged by mistake: cancelled with a reason, never deleted
specimensRouter.post('/:id/cancel', async (req, res) => {
  const { s, patient } = await loadOne(req);
  if (!mayWrite(req, patient)) throw forbidden('You can cancel specimens only for patients whose medical record you may write in.');
  const { reason } = parse(z.object({ reason: safeText('Reason', 500).refine((v) => v.length > 0, 'Write why it is cancelled') }).strict(), req.body);
  if (s.status !== 'sent') throw conflict('Only a specimen still waiting for its report can be cancelled.');
  const at = req.now ?? new Date();
  await Specimen.updateOne({ _id: s._id, tenantId: req.tenantId, status: 'sent' }, { $set: { status: 'cancelled', cancelled: { reason, by: req.user._id, byName: req.user.name, at } } });
  await audit(req, 'SPECIMEN_CANCELLED', { details: { patientId: String(patient._id), mrn: patient.mrn, specimenId: String(s._id) } });
  res.json({ specimen: view(await Specimen.findOne({ _id: s._id, tenantId: req.tenantId }), patient, at) });
});
