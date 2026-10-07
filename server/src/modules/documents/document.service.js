// Scanned and uploaded papers on a patient's record (see medicalDocument.model.js and recordsAccess.js).
// The audit log gets ids, the kind of paper and the size only – never the title or the file.
import { config } from '../../config/index.js';
import { HttpError, fieldError, notFoundError } from '../../core/httpError.js';
import { Admission } from '../admissions/admission.model.js';
import { recordAudit } from '../audit/audit.service.js';
import { loadForRecords } from './recordsAccess.js';
import { FILE_TYPES, MedicalDocument } from './medicalDocument.model.js';

const MAX_BYTES = config.documents.maxMegabytes * 1024 * 1024;

// What the file really is, from its first bytes (the browser's word for it is not trusted).
function sniff(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

export const documentView = (d) => ({
  id: String(d._id),
  kind: d.kind,
  title: d.title,
  documentDate: d.documentDate,
  admissionId: d.admissionId ? String(d.admissionId) : null,
  fileType: FILE_TYPES[d.mimeType],
  size: d.size,
  uploadedByName: d.uploadedByName,
  uploadedAt: d.createdAt,
  cancelled: d.cancelled ? { reason: d.cancelled.reason, byName: d.cancelled.byName, at: d.cancelled.at } : null,
});

export async function listDocuments(req, patientId) {
  await loadForRecords(req, patientId);
  const docs = await MedicalDocument.find({ hospitalId: req.hospitalId, patientId }).sort({ createdAt: -1 }).limit(200).lean();
  return { items: docs.map(documentView) };
}

export async function uploadDocument(req, patientId, { kind, title, documentDate, admissionId }, file) {
  const { patient } = await loadForRecords(req, patientId);
  if (!Buffer.isBuffer(file) || file.length === 0) throw fieldError('file', 'Choose the file to upload.');
  if (file.length > MAX_BYTES) throw fieldError('file', `The file is larger than ${config.documents.maxMegabytes} MB. Scan it at a lower resolution.`);
  const mimeType = sniff(file);
  if (!mimeType) throw fieldError('file', 'Only PDF, JPG or PNG files can be uploaded.');
  if (admissionId && !(await Admission.exists({ hospitalId: req.hospitalId, _id: admissionId, patientId: patient._id }))) {
    throw fieldError('admissionId', 'That stay is not on this patient’s record.');
  }
  const doc = await MedicalDocument.create({
    hospitalId: req.hospitalId,
    patientId: patient._id,
    admissionId: admissionId ?? null,
    kind,
    title,
    documentDate: documentDate ?? null,
    mimeType,
    size: file.length,
    file,
    uploadedBy: req.user._id,
    uploadedByName: req.user.name,
  });
  await recordAudit(req, 'DOCUMENT_UPLOADED', { hospitalId: req.hospitalId, details: { patientId: String(patient._id), documentId: String(doc._id), kind, size: file.length } });
  return { document: documentView(doc.toObject()) };
}

async function loadDocument(req, documentId, withFile = false) {
  const query = MedicalDocument.findOne({ hospitalId: req.hospitalId, _id: documentId });
  const doc = await (withFile ? query.select('+file') : query);
  if (!doc) throw notFoundError('Document');
  await loadForRecords(req, doc.patientId); // the same check as for her record
  return doc;
}

export async function documentFile(req, documentId) {
  const doc = await loadDocument(req, documentId, true);
  if (doc.cancelled) throw new HttpError(410, 'This document was marked as entered in error.', 'CANCELLED');
  await recordAudit(req, 'DOCUMENT_VIEWED', { hospitalId: req.hospitalId, details: { patientId: String(doc.patientId), documentId: String(doc._id), kind: doc.kind } });
  return { mimeType: doc.mimeType, file: doc.file, fileName: `document-${String(doc._id).slice(-6)}.${FILE_TYPES[doc.mimeType]}` };
}

export async function cancelDocument(req, documentId, reason) {
  const doc = await loadDocument(req, documentId);
  if (!doc.cancelled) {
    doc.cancelled = { reason, by: req.user._id, byName: req.user.name, at: new Date() };
    await doc.save();
    await recordAudit(req, 'DOCUMENT_CANCELLED', { hospitalId: req.hospitalId, details: { patientId: String(doc.patientId), documentId: String(doc._id), kind: doc.kind } });
  }
  return { document: documentView(doc.toObject()) };
}
