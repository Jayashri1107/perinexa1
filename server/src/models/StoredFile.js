import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A file a person attached to a patient's record (Version 2): a lab report, or the scanned copy of a signed
// consent form – a PDF or a photo, at most 5 MB, kept in the database (utils/storedFiles.js checks it). Never
// changed or deleted; read only through the route of what it belongs to (audited).
// Register scans (removed 2 Oct 2026) stay stored; never saved or read again.

export const FILE_KINDS = ['lab_report', 'signed_consent'];
export const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const { ObjectId } = mongoose.Schema.Types;
const fileSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    kind: { type: String, enum: FILE_KINDS, required: true },
    ownerId: { type: ObjectId, required: true }, // the lab order or the printed consent form
    fileName: { type: String, required: true, maxlength: 200 },
    mediaType: { type: String, enum: FILE_TYPES, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
    by: { type: ObjectId, ref: 'User', required: true },
    byName: { type: String, required: true },
  },
  { timestamps: true },
);
fileSchema.plugin(tenantScoped);
fileSchema.index({ tenantId: 1, kind: 1, ownerId: 1 });

export const StoredFile = mongoose.model('StoredFile', fileSchema);
