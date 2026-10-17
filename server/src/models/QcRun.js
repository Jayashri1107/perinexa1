import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// One quality-control reading of a lot (Lab version 2): the value, its z-score, the Westgard rules it broke, whether
// the run is accepted, and – for a rejected run – the corrective action. Never deleted.
const { ObjectId } = mongoose.Schema.Types;
const byFields = { by: { type: ObjectId, ref: 'User' }, byName: String, at: Date };
const runSchema = new mongoose.Schema(
  {
    lotId: { type: ObjectId, ref: 'QcLot', required: true },
    testKey: { type: String, required: true },
    fieldKey: { type: String, required: true },
    level: { type: Number, required: true },
    value: { type: Number, required: true },
    z: { type: Number, required: true },
    violations: { type: [String], default: [] }, // '1-2s' (warning), '1-3s', '2-2s', 'R-4s', '4-1s', '10x'
    status: { type: String, enum: ['accepted', 'warning', 'rejected'], required: true },
    run: { type: new mongoose.Schema(byFields, { _id: false }), required: true },
    action: { type: new mongoose.Schema({ ...byFields, text: String }, { _id: false }), default: null },
  },
  { timestamps: true },
);
runSchema.plugin(tenantScoped);
runSchema.index({ tenantId: 1, lotId: 1, 'run.at': -1 });
runSchema.index({ tenantId: 1, testKey: 1, 'run.at': -1 });

export const QcRun = mongoose.model('QcRun', runSchema);
