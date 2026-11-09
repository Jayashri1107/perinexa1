import mongoose from 'mongoose';
import { DOC_TYPES } from '../records/recordRules.js';
import { tenantScoped } from '../utils/tenantScope.js';

// A scanned or outside document attached to a patient's record (the medical records module, 9 Nov 2026): an old
// paper case sheet, a discharge summary or report from another hospital, a referral letter … – what it is, its
// title, the date on the paper, the stay it belongs to (optional) and the file itself (a StoredFile of kind
// patient_document). Never deleted: one on the wrong record is marked so, with a reason, and no longer opened by
// those who only read. Nothing from the paper is typed into the structured record by itself.

const { ObjectId } = mongoose.Schema.Types;
const byFields = { by: { type: ObjectId, ref: 'User' }, byName: String, at: Date };

const documentSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    docType: { type: String, enum: DOC_TYPES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    documentOn: { type: Date, default: null }, // the date on the paper (midnight UTC), when known
    admissionId: { type: ObjectId, ref: 'Admission', default: null }, // the stay it belongs to, when one is chosen
    note: { type: String, default: '', maxlength: 500 },
    file: {
      type: new mongoose.Schema({ fileId: { type: ObjectId, ref: 'StoredFile', required: true }, fileName: String, mediaType: String, size: Number }, { _id: false }),
      required: true,
    },
    uploaded: { type: new mongoose.Schema(byFields, { _id: false }), required: true },
    cancelled: { type: new mongoose.Schema({ ...byFields, reason: { type: String, required: true, maxlength: 300 } }, { _id: false }), default: null },
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true },
);
documentSchema.plugin(tenantScoped);
documentSchema.index({ tenantId: 1, patientId: 1, documentOn: -1 });
documentSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });

export const PatientDocument = mongoose.model('PatientDocument', documentSchema);
