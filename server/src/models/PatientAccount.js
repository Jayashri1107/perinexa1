import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A patient's own sign-in for the patient portal (owner, 16 Oct 2026 – docs/PATIENT_ACCOUNTS_PLAN.md): she signs up
// on the hospital's portal (name, age, mobile, email, password) and waits for reception. Reception checks who she is
// and approves it – linking it to her patient record (found, or registered then) – or rejects it with a reason. Only an
// approved account signs in, with email and password or with mobile and an OTP; it then opens her record's portal.
// Never deleted: a rejected or withdrawn account is kept with who did it and why.
// The password is kept only as a bcrypt hash, the OTP only as a keyed hash, for 10 minutes.

const { ObjectId } = mongoose.Schema.Types;
const stamp = new mongoose.Schema({ by: ObjectId, byName: String, at: Date, reason: { type: String, default: '' } }, { _id: false });

export const ACCOUNT_STATUSES = ['pending', 'approved', 'rejected'];

const accountSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 150 },
    ageYears: { type: Number, min: 0, max: 120, default: null },
    mobile: { type: String, required: true }, // 10 digits (Indian mobile)
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true },
    status: { type: String, enum: ACCOUNT_STATUSES, default: 'pending' },
    patientId: { type: ObjectId, ref: 'Patient', default: null }, // set on approval
    reviewed: { type: stamp, default: null }, // approved or rejected: by whom, when (and why, when rejected)
    // Wrong passwords or OTPs in a row: 5 lock the account for 30 minutes
    failedAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    otp: { type: new mongoose.Schema({ hash: String, expiresAt: Date, tries: { type: Number, default: 0 } }, { _id: false }), default: null },
    lastSignInAt: { type: Date, default: null },
  },
  { timestamps: true },
);
accountSchema.plugin(tenantScoped);
// One live account per email and per mobile in a hospital (a rejected one does not block signing up again)
accountSchema.index({ tenantId: 1, email: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['pending', 'approved'] } } });
accountSchema.index({ tenantId: 1, mobile: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['pending', 'approved'] } } });
accountSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
accountSchema.index({ tenantId: 1, patientId: 1 });

// Never the password or OTP hashes in an answer
accountSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.otp;
    return ret;
  },
});

export const PatientAccount = mongoose.model('PatientAccount', accountSchema);
