import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A file a person attached to a patient's record (Version 2): a lab report, or the scanned copy of a signed
// consent form – a PDF or a photo, at most 5 MB, kept in the database (utils/storedFiles.js checks it). Never
// changed or deleted; read only through the route of what it belongs to (audited).
// Referrals (docs/REFERRALS_PLAN.md): the referring doctor's note or reports attached to a referral, and the PDFs of
// the consultant note and the discharge card released to the referral desk (routes/referrals.js).
// Register scans (removed 2 Oct 2026) stay stored; never saved or read again.

// scan_image (24 Oct 2026): a picture from the ultrasound machine attached to a scan (routes/imaging.js)
// expense_bill (28 Oct 2026): the bill or voucher of an expense paid from the counter (routes/billing.js) – no patient
export const FILE_KINDS = ['lab_report', 'signed_consent', 'referral_attachment', 'referral_release', 'scan_image', 'expense_bill'];
// A referral can arrive before she is registered: its files may have no patient (the referral says whose they are
// once it is linked to her record). An expense's bill never has one. Every other file belongs to a patient from the start.
export const NO_PATIENT_KINDS = ['referral_attachment', 'referral_release', 'expense_bill'];
export const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const { ObjectId } = mongoose.Schema.Types;
const fileSchema = new mongoose.Schema(
  {
    patientId: {
      type: ObjectId,
      ref: 'Patient',
      default: null,
      required: [function () { return !NO_PATIENT_KINDS.includes(this.kind); }, 'A file belongs to a patient.'],
    },
    kind: { type: String, enum: FILE_KINDS, required: true },
    ownerId: { type: ObjectId, required: true }, // the lab order, the printed consent form or the referral
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
