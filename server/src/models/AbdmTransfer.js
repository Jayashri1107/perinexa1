import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// One request for data under a consent (ABDM milestone M2), and what was done with it: refused (the consent was
// withdrawn, expired, unknown, or the dates were outside it), or which records were sent – by reference and with
// counts only, never their content. Kept as a record of what left the hospital; never deleted.

const transferSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, maxlength: 100 },
    consentId: { type: String, required: true, maxlength: 100 },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', default: null },
    from: { type: Date, default: null }, // the dates asked for
    to: { type: Date, default: null },
    status: { type: String, enum: ['working', 'refused', 'sent', 'nothing_to_send', 'failed'], required: true },
    // why it was refused: unknown_consent | consent_revoked | consent_expired | consent_denied | dates_outside_consent | push_address
    refusal: { type: String, default: '' },
    careContexts: {
      type: [
        new mongoose.Schema(
          {
            reference: String,
            delivered: Boolean,
            documents: { type: Number, default: 0 },
            reason: { type: String, default: '' }, // why it was not sent (shareRules reasons, not_linked, outside_dates …)
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    documents: { type: Number, default: 0 },
    error: { type: String, default: '', maxlength: 300 }, // plain words when sending failed
    pushedAt: { type: Date, default: null },
    notifiedAt: { type: Date, default: null },
    practice: { type: Boolean, default: false },
  },
  { timestamps: true },
);
transferSchema.plugin(tenantScoped);
transferSchema.index({ tenantId: 1, transactionId: 1 }, { unique: true });
transferSchema.index({ tenantId: 1, consentId: 1, createdAt: -1 });

export const AbdmTransfer = mongoose.model('AbdmTransfer', transferSchema);
