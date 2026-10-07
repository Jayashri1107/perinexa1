// A scanned or uploaded paper on a patient's record (a discharge card, an earlier record, a lab or sonography report,
// a prescription …). The file itself is kept inside the database – never in a public folder – and is sent only through
// GET /hospital/patient-documents/:id/file after the access check. Never deleted: one uploaded by mistake (the wrong
// patient, the wrong page) is marked "entered in error" with a reason and its file is no longer sent.
import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';
import { config } from '../../config/index.js';

const { ObjectId } = mongoose.Schema.Types;
export const DOCUMENT_KIND_KEYS = config.documents.kinds.map((k) => k.key);
export const FILE_TYPES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

const medicalDocumentSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    admissionId: { type: ObjectId, ref: 'Admission', default: null }, // the stay it belongs to, when known
    kind: { type: String, enum: DOCUMENT_KIND_KEYS, required: true },
    title: { type: String, trim: true, maxlength: 120, default: '' },
    documentDate: { type: Date, default: null }, // the date on the paper, if given
    mimeType: { type: String, enum: Object.keys(FILE_TYPES), required: true },
    size: { type: Number, required: true },
    file: { type: Buffer, required: true, select: false }, // loaded only when the file is opened
    uploadedBy: { type: ObjectId, ref: 'User', required: true },
    uploadedByName: { type: String, required: true },
    cancelled: {
      type: new mongoose.Schema({ reason: { type: String, required: true, maxlength: 300 }, by: ObjectId, byName: String, at: Date }, { _id: false }),
      default: null,
    },
  },
  { timestamps: true },
);
medicalDocumentSchema.plugin(hospitalScoped);
medicalDocumentSchema.index({ hospitalId: 1, patientId: 1, createdAt: -1 });

export const MedicalDocument = mongoose.model('MedicalDocument', medicalDocumentSchema, 'medical_documents');
