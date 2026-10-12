import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A consent artefact from ABDM (milestone M2): the patient agreed in her ABHA app that another hospital or app (the
// HIU) may receive some of her linked records – which ones, of which types, from which dates, and until when.
// ABDM sends it when she grants it, and again when she withdraws it or it expires. Every request for data is checked
// against it (status, expiry, dates, types, records). Withdrawn, expired or refused is final. It is bound to her
// record (patientId) only when its ABHA is hers. Kept as a record; never deleted.

const consentSchema = new mongoose.Schema(
  {
    consentId: { type: String, required: true, maxlength: 100 }, // ABDM's id of the artefact
    status: { type: String, enum: ['GRANTED', 'REVOKED', 'EXPIRED', 'DENIED'], required: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', default: null },
    abhaAddress: { type: String, default: '' }, // her ABHA address in the artefact
    hiTypes: { type: [String], default: [] },
    from: { type: Date, default: null }, // the records' dates she agreed to share
    to: { type: Date, default: null },
    expiresAt: { type: Date, default: null }, // dataEraseAt: after this nothing is sent
    purpose: { code: { type: String, default: '' }, text: { type: String, default: '', maxlength: 200 } },
    hiu: { id: { type: String, default: '' }, name: { type: String, default: '', maxlength: 200 } },
    careContexts: { type: [new mongoose.Schema({ patientReference: String, careContextReference: String }, { _id: false })], default: [] },
    // Every message about it; ignored: a "granted" that came after it was withdrawn, expired or refused (it stays so)
    history: { type: [new mongoose.Schema({ status: String, at: Date, ignored: { type: Boolean, default: undefined } }, { _id: false })], default: [] },
    practice: { type: Boolean, default: false },
  },
  { timestamps: true },
);
consentSchema.plugin(tenantScoped);
consentSchema.index({ tenantId: 1, consentId: 1 }, { unique: true });
consentSchema.index({ tenantId: 1, patientId: 1, createdAt: -1 });

export const AbdmConsent = mongoose.model('AbdmConsent', consentSchema);
