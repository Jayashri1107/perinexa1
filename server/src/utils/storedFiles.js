import { z } from 'zod';
import { FILE_TYPES, NO_PATIENT_KINDS, StoredFile } from '../models/StoredFile.js';
import { HttpError } from './httpError.js';
import { safeText } from './pcpndt.js';

// Files attached to a record (lab reports, scanned consent forms, a referral's files): sent as base64 in JSON (the
// body limit for these paths is in app.js), at most 5 MB, and only a PDF or a photo – checked from the file's first
// bytes, not only from what the browser says. Served back inline with the stored type.

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const fileUploadSchema = z
  .object({
    fileName: z.string().trim().min(1).max(200),
    mediaType: z.enum(FILE_TYPES, 'Only PDF, JPEG, PNG or WebP files.'),
    data: z.string().min(8).max(7_000_000, 'The file is too large (at most 5 MB).'),
    reason: safeText('Reason', 500).default(''),
  })
  .strict();

const MAGIC = {
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

export const cleanFileName = (name) => name.replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'file';
const invalid = (message) => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields: { file: message } });

/**
 * Checks the upload and stores it. Returns the stored file (without reading its data back).
 * patientId: null only for a referral's files (a referral can arrive before she is registered – NO_PATIENT_KINDS).
 * types: the file types this place takes (a released note or discharge card: PDF only); any PDF or photo by default.
 */
export async function storeFile(req, { patientId = null, kind, ownerId, body, types = FILE_TYPES }) {
  if (!patientId && !NO_PATIENT_KINDS.includes(kind)) throw new Error(`A stored file of kind ${kind} needs a patient`);
  if (!types.includes(body.mediaType)) throw invalid(types.length === 1 && types[0] === 'application/pdf' ? 'Only a PDF file.' : 'Only PDF, JPEG, PNG or WebP files.');
  const data = Buffer.from(body.data, 'base64');
  if (data.length > MAX_FILE_BYTES) throw invalid('The file is too large (at most 5 MB).');
  if (!MAGIC[body.mediaType](data)) throw invalid('This file is not a readable PDF or photo.');
  return StoredFile.create({ tenantId: req.tenantId, patientId, kind, ownerId, fileName: cleanFileName(body.fileName), mediaType: body.mediaType, size: data.length, data, by: req.user._id, byName: req.user.name });
}

/** The stored file of this kind and owner (404 otherwise). */
export async function findFile(req, { kind, ownerId, fileId }) {
  const file = await StoredFile.findOne({ _id: fileId, tenantId: req.tenantId, kind, ownerId });
  if (!file) throw new HttpError(404, 'This file was not found.', 'NOT_FOUND');
  return file;
}

export function sendFile(res, file) {
  res.set('Content-Type', file.mediaType);
  res.set('Content-Disposition', `inline; filename="${cleanFileName(file.fileName)}"`);
  res.send(file.data);
}

/** How a stored file is listed on its record. */
export const fileEntry = (file, stamp) => ({ fileId: file._id, fileName: file.fileName, mediaType: file.mediaType, size: file.size, ...stamp });
