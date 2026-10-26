import mongoose from 'mongoose';
import { PURPOSE_NOTE_MAX, VISIT_PURPOSES } from '../appointments/visitPurpose.js';
import { tenantScoped } from '../utils/tenantScope.js';

// A follow-up a patient was asked to come back for (26 Oct 2026): with which doctor, what for (a fixed purpose and a
// short note – never a medical detail: reception sees it), and from which day. Added by reception, doctors or RMOs.
// Open until she checks in (then it is "came", with the arrival's day) or it is cancelled. Who and when for each step.

const ObjectId = mongoose.Schema.Types.ObjectId;
const byWhom = { by: { type: ObjectId, ref: 'User', required: true }, byName: { type: String, required: true, maxlength: 150 }, at: { type: Date, required: true } };

const followUpSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    doctorId: { type: ObjectId, ref: 'User', required: true },
    purpose: { type: String, enum: VISIT_PURPOSES, required: true },
    note: { type: String, trim: true, maxlength: PURPOSE_NOTE_MAX, default: '' },
    from: { type: Date, default: null }, // the day from which she is expected (midnight UTC), or any day
    status: { type: String, enum: ['open', 'came', 'cancelled'], default: 'open' },
    created: { type: new mongoose.Schema(byWhom, { _id: false }), required: true },
    came: { type: new mongoose.Schema({ ...byWhom, on: { type: Date, required: true } }, { _id: false }), default: null },
    cancelled: { type: new mongoose.Schema(byWhom, { _id: false }), default: null },
  },
  { timestamps: false },
);
followUpSchema.plugin(tenantScoped);
followUpSchema.index({ tenantId: 1, status: 1, from: 1 });
followUpSchema.index({ tenantId: 1, patientId: 1, status: 1 });

export const FollowUp = mongoose.model('FollowUp', followUpSchema);
