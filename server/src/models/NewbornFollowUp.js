import mongoose from 'mongoose';
import { HIGH_RISK_REASONS } from '../clinical/newbornSchedule.js';
import { tenantScoped } from '../utils/tenantScope.js';

// A baby's screening log and high-risk follow-up (Clinical Requirements Group A, item 4). One per baby's record.
// The due dates are never stored: they are worked out from the birth (her record), the gestation at birth and the
// birth weight (clinical/newbornSchedule.js). What is stored is what was done: a screen done (its result) or not
// needed (why), a clinic visit attended – each with who, and when it was typed (PX-X-04).

export const SCREEN_RESULTS = ['pass', 'refer', 'normal', 'abnormal', 'no_rop', 'rop_found'];
const { ObjectId } = mongoose.Schema.Types;
const recordSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['screen', 'visit'], required: true },
    key: { type: String, required: true, maxlength: 20 },
    status: { type: String, enum: ['done', 'not_needed', 'attended'], required: true },
    on: { type: Date, required: true }, // the day it was done or attended (typed)
    result: { type: String, enum: ['', ...SCREEN_RESULTS], default: '' },
    note: { type: String, maxlength: 1000, default: '' },
    by: { type: ObjectId, ref: 'User' },
    byName: String,
    at: Date, // when it was typed
  },
  { _id: false },
);
const followUpSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    gestationWeeks: { type: Number, min: 22, max: 44, default: null },
    gestationDays: { type: Number, min: 0, max: 6, default: 0 },
    highRisk: { type: Boolean, default: false },
    highRiskReasons: { type: [{ type: String, enum: HIGH_RISK_REASONS }], default: [] },
    records: { type: [recordSchema], default: [] },
    updatedByName: { type: String, default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);
followUpSchema.plugin(tenantScoped);
followUpSchema.index({ tenantId: 1, patientId: 1 }, { unique: true });

export const NewbornFollowUp = mongoose.model('NewbornFollowUp', followUpSchema);
