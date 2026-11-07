import mongoose from 'mongoose';
import { ALERT_KIND_KEYS } from '../clinical/patientAlerts.js';
import { tenantScoped } from '../utils/tenantScope.js';

// An alert that follows the patient (Clinical Requirements Group C – PX-X-13; DRAFT list, clinical/patientAlerts.js).
// Never changed or deleted: one that no longer applies is ended, with who, when and why; the record keeps it.

const { ObjectId } = mongoose.Schema.Types;
const alertSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    kind: { type: String, enum: ALERT_KIND_KEYS, required: true },
    note: { type: String, maxlength: 300, default: '' },
    by: { type: ObjectId, ref: 'User', required: true },
    byName: { type: String, required: true },
    ended: { type: new mongoose.Schema({ reason: String, by: ObjectId, byName: String, at: Date }, { _id: false }), default: null },
  },
  { timestamps: true },
);
alertSchema.plugin(tenantScoped);
alertSchema.index({ tenantId: 1, patientId: 1, createdAt: -1 });

export const PatientAlert = mongoose.model('PatientAlert', alertSchema);
