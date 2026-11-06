import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// One set of MEOWS observations on a stay (Clinical Requirements Group B, item 8 – DRAFT rules, clinical/meows.js).
// The time of the observations is what was typed (at); when it was typed is createdAt (PX-X-04). The bands and the
// level are worked out by the server when it is saved and kept as they were, with the rules' source. A trigger needs
// the name of the doctor who was told. Never changed or deleted: one written by mistake is marked "entered in error".

const { ObjectId } = mongoose.Schema.Types;
const BANDS = ['red', 'yellow', 'normal', null];
const entrySchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    admissionId: { type: ObjectId, ref: 'Admission', required: true },
    at: { type: Date, required: true },
    values: {
      rr: { type: Number, default: null },
      spo2: { type: Number, default: null },
      tempC: { type: Number, default: null },
      sbp: { type: Number, default: null },
      dbp: { type: Number, default: null },
      hr: { type: Number, default: null },
      avpu: { type: String, enum: ['A', 'V', 'P', 'U', null], default: null },
    },
    bands: Object.fromEntries(['rr', 'spo2', 'tempC', 'sbp', 'dbp', 'hr', 'avpu'].map((k) => [k, { type: String, enum: BANDS, default: null }])),
    level: { type: String, enum: ['trigger', 'watch', 'normal'], required: true },
    escalatedTo: { type: String, maxlength: 150, default: '' },
    note: { type: String, maxlength: 1000, default: '' },
    source: { type: String, required: true },
    by: { type: ObjectId, ref: 'User', required: true },
    byName: { type: String, required: true },
    cancelled: { type: new mongoose.Schema({ reason: String, by: ObjectId, byName: String, at: Date }, { _id: false }), default: null },
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true },
);
entrySchema.plugin(tenantScoped);
entrySchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });
entrySchema.index({ tenantId: 1, admissionId: 1, at: -1 });

export const MeowsEntry = mongoose.model('MeowsEntry', entrySchema);
