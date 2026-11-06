import mongoose from 'mongoose';
import { INCIDENT_KINDS, INCIDENT_STATUSES, SEVERITIES } from '../incidents/incidentKinds.js';
import { tenantScoped } from '../utils/tenantScope.js';

// An incident report (Clinical Requirements Group A, item 6 – PX-X-10): reported by any member of staff (or by
// Perinexa itself, e.g. a category 1 caesarean over 30 minutes), reviewed by the quality lead, its actions recorded
// and done, then closed. Kept OUT of the patient's record and of the copy of her record: an incident may name a
// patient (patientId) so the lead can look into it, but nothing of it is shown on her record. Never deleted.

const { ObjectId } = mongoose.Schema.Types;
const stamp = { by: { type: ObjectId, ref: 'User', default: null }, byName: String, at: Date };
const actionSchema = new mongoose.Schema({
  text: { type: String, required: true, maxlength: 1000 },
  owner: { type: String, maxlength: 150, default: '' },
  dueOn: { type: Date, default: null },
  done: { type: new mongoose.Schema({ note: { type: String, maxlength: 1000 }, ...stamp }, { _id: false }), default: null },
  ...stamp,
});
const incidentSchema = new mongoose.Schema(
  {
    serial: { type: Number, required: true },
    occurredAt: { type: Date, required: true },
    place: { type: String, trim: true, maxlength: 150, default: '' },
    kind: { type: String, enum: Object.keys(INCIDENT_KINDS), required: true },
    severity: { type: String, enum: Object.keys(SEVERITIES), required: true },
    description: { type: String, required: true, maxlength: 4000 },
    immediateAction: { type: String, maxlength: 2000, default: '' },
    patientId: { type: ObjectId, ref: 'Patient', default: null },
    // Reported automatically: where from (e.g. the delivery note that showed it)
    automatic: { type: new mongoose.Schema({ source: String, documentId: ObjectId }, { _id: false }), default: null },
    reported: { type: new mongoose.Schema(stamp, { _id: false }), required: true },
    status: { type: String, enum: INCIDENT_STATUSES, default: 'reported' },
    review: { type: new mongoose.Schema({ findings: { type: String, maxlength: 4000 }, causes: { type: String, maxlength: 2000 }, severity: String, ...stamp }, { _id: false }), default: null },
    actions: { type: [actionSchema], default: [] },
    closure: { type: new mongoose.Schema({ summary: { type: String, maxlength: 2000 }, ...stamp }, { _id: false }), default: null },
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true },
);
incidentSchema.plugin(tenantScoped);
incidentSchema.index({ tenantId: 1, serial: 1 }, { unique: true });
incidentSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });
incidentSchema.index({ tenantId: 1, status: 1, occurredAt: -1 });
incidentSchema.index({ tenantId: 1, 'reported.by': 1, occurredAt: -1 });

export const Incident = mongoose.model('Incident', incidentSchema);
