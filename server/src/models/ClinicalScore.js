import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A score recorded for a patient (Clinical Requirements Group A, item 5): the EPDS (the ten answers' scores from the
// hospital's paper form – never the questions) or the VTE risk score (the factors ticked). The total, the band and
// the advice are worked out by the server (clinical/scores.js) and kept as they were on the day, with the rules'
// source. Never changed or deleted: one recorded by mistake is marked "entered in error" with a reason.

export const SCORE_KINDS = ['epds', 'vte'];
const { ObjectId } = mongoose.Schema.Types;
const scoreSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    kind: { type: String, enum: SCORE_KINDS, required: true },
    on: { type: Date, required: true }, // when it was done (typed)
    phase: { type: String, enum: ['antenatal', 'postnatal'], required: true },
    epdsScores: { type: [Number], default: undefined }, // ten numbers 0–3
    vteFactors: { type: [String], default: undefined },
    antenatalLmwh: { type: Boolean, default: undefined },
    total: { type: Number, required: true },
    band: { type: String, required: true },
    selfHarm: { type: Boolean, default: undefined },
    advice: { type: [String], default: [] },
    source: { type: String, required: true },
    note: { type: String, maxlength: 1000, default: '' },
    byName: { type: String, required: true },
    by: { type: ObjectId, ref: 'User', required: true },
    cancelled: { type: new mongoose.Schema({ reason: String, by: ObjectId, byName: String, at: Date }, { _id: false }), default: null },
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true },
);
scoreSchema.plugin(tenantScoped);
scoreSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });
scoreSchema.index({ tenantId: 1, patientId: 1, kind: 1, on: -1 });

export const ClinicalScore = mongoose.model('ClinicalScore', scoreSchema);
