import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// Nothing gets lost (doctor ideas #4, 16 Oct 2026): what a person typed on a visit and has not saved yet – the Visit
// details part and the Prescription part, each as the form held it – kept while they type, so a doctor called away or
// logged out after 30 minutes finds it again ("Restore"). Only its author ever reads it; it is removed when that part
// is saved or discarded, and after 7 days by itself. Never text that names a baby's sex (PCPNDT Act): such a draft is
// not kept. Not part of the record: nothing here is ever printed, shared or exported.
const { ObjectId, Mixed } = mongoose.Schema.Types;

const draftSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    visitId: { type: ObjectId, ref: 'Visit', required: true },
    details: { type: Mixed, default: null },
    rx: { type: Mixed, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, minimize: false },
);
draftSchema.plugin(tenantScoped);
draftSchema.index({ tenantId: 1, userId: 1, visitId: 1 }, { unique: true });
draftSchema.index({ tenantId: 1, userId: 1, updatedAt: -1 });
draftSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const VisitDraft = mongoose.model('VisitDraft', draftSchema);
