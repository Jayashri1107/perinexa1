import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// Her ABHA app looking for her records here (ABDM milestone M2, "discovery"), and linking them: ABDM asks which
// records the hospital has for her ABHA; the hospital offers those that may be shared; she picks some; the hospital
// sends an OTP to the mobile number on her record and links them once she confirms it in her app. Short-lived: a
// search is continued within 30 minutes; only the OTP's hash is kept (never the OTP), for 10 minutes and 5 tries, and
// cleared when it is used up; the whole request is deleted by MongoDB a day after its last change.

const linkRequestSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, maxlength: 100 },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
    abhaAddress: { type: String, default: '' },
    offered: { type: [String], default: [] }, // the references offered to her app
    chosen: { type: [String], default: [] }, // those she chose to link
    linkRef: { type: String, default: '' },
    otpHash: { type: String, default: '' },
    otpUntil: { type: Date, default: null },
    tries: { type: Number, default: 0 },
    status: { type: String, enum: ['offered', 'otp_sent', 'linked', 'failed'], default: 'offered' },
    practice: { type: Boolean, default: false },
  },
  { timestamps: true },
);
linkRequestSchema.plugin(tenantScoped);
linkRequestSchema.index({ tenantId: 1, transactionId: 1 }, { unique: true });
linkRequestSchema.index({ tenantId: 1, linkRef: 1 });
linkRequestSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 24 * 3600 }); // gone a day after its last change

export const AbdmLinkRequest = mongoose.model('AbdmLinkRequest', linkRequestSchema);
