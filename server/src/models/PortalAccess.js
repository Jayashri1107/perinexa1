import mongoose from 'mongoose';

// Access to the patient portal (Version 2): a code staff hand to the patient, kept only as a keyed hash (the code
// itself is shown once, when it is made). With the last 4 digits of her mobile number it opens her portal page
// until it expires (90 days) or is withdrawn; 5 wrong tries lock it for 30 minutes. One active code per patient.
//
// NOT tenant-scoped by the plugin: at sign-in the portal knows only the code, so it is found by its hash
// (unique across hospitals); every other query names the hospital (tenantId) as usual.

const { ObjectId } = mongoose.Schema.Types;
const accessSchema = new mongoose.Schema(
  {
    tenantId: { type: ObjectId, ref: 'Tenant', required: true, immutable: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    codeHash: { type: String, required: true },
    // 'code': a code staff made (above). 'account': a sign-in with her own approved account (email and password, or
    // mobile and OTP – 16 Oct 2026, models/PatientAccount.js) – no code exists; codeHash is then a random value that
    // no code can match, and the access lasts one day.
    method: { type: String, enum: ['code', 'account'], default: 'code' },
    accountId: { type: ObjectId, ref: 'PatientAccount', default: null },
    expiresAt: { type: Date, required: true },
    revoked: { type: new mongoose.Schema({ by: ObjectId, byName: String, at: Date }, { _id: false }), default: null },
    createdBy: { type: ObjectId, ref: 'User', default: null }, // null: she signed in with her own account
    createdByName: { type: String, required: true },
    lastUsedAt: { type: Date, default: null },
    failedAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true },
);
accessSchema.index({ codeHash: 1 }, { unique: true });
accessSchema.index({ tenantId: 1, patientId: 1, createdAt: -1 });

export const PortalAccess = mongoose.model('PortalAccess', accessSchema);
