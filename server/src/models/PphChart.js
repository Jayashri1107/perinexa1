import mongoose from 'mongoose';
import { LOSS_METHODS, PPH_CAUSES, PPH_OUTCOMES, PPH_STEPS } from '../clinical/pph.js';
import { tenantScoped } from '../utils/tenantScope.js';

// One PPH episode on a stay (Clinical Requirements Group B, item 15 – DRAFT, clinical/pph.js): when the bleeding was
// recognised, the cause, each amount of blood lost, each step taken (with time; a medicine with the dose and route
// typed by whoever gave it), observations, and how it ended. Each line keeps who typed it and when (PX-X-04). Lines are
// never changed or deleted – one typed by mistake is marked "entered in error"; the chart itself likewise.

const { ObjectId } = mongoose.Schema.Types;
const stamp = { by: { type: ObjectId, ref: 'User' }, byName: String, enteredAt: Date };
const cancel = { type: new mongoose.Schema({ reason: String, by: ObjectId, byName: String, at: Date }, { _id: false }), default: null };
const chartSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    admissionId: { type: ObjectId, ref: 'Admission', required: true },
    recognisedAt: { type: Date, required: true },
    causes: { type: [{ type: String, enum: Object.keys(PPH_CAUSES) }], default: [] },
    losses: { type: [new mongoose.Schema({ at: Date, ml: Number, method: { type: String, enum: Object.keys(LOSS_METHODS) }, cancelled: cancel, ...stamp })], default: [] },
    steps: {
      type: [new mongoose.Schema({ key: { type: String, enum: PPH_STEPS.map((s) => s.key) }, at: Date, dose: String, route: String, note: String, cancelled: cancel, ...stamp })],
      default: [],
    },
    observations: { type: [new mongoose.Schema({ at: Date, hr: Number, sbp: Number, dbp: Number, spo2: Number, cancelled: cancel, ...stamp })], default: [] },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    outcome: { type: new mongoose.Schema({ result: { type: String, enum: Object.keys(PPH_OUTCOMES) }, at: Date, note: String, ...stamp }, { _id: false }), default: null },
    source: { type: String, required: true },
    createdByName: { type: String, required: true },
    cancelled: cancel,
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true },
);
chartSchema.plugin(tenantScoped);
chartSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });
chartSchema.index({ tenantId: 1, admissionId: 1, recognisedAt: -1 });

export const PphChart = mongoose.model('PphChart', chartSchema);
