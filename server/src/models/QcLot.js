import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// Quality control (Lab version 2 – docs/LAB_V2_PLAN.md): a control material's lot for one value of one test, at one
// level (1 normal, 2 abnormal, 3 high), with the target mean and SD from the lot's insert. Runs are QcRun. Never deleted.
const lotSchema = new mongoose.Schema(
  {
    testKey: { type: String, required: true },
    fieldKey: { type: String, required: true },
    level: { type: Number, enum: [1, 2, 3], required: true },
    material: { type: String, trim: true, maxlength: 120, default: '' },
    lotNo: { type: String, trim: true, maxlength: 60, required: true },
    expiresOn: { type: Date, default: null },
    mean: { type: Number, required: true },
    sd: { type: Number, required: true, min: 0.000001 },
    active: { type: Boolean, default: true },
    createdByName: { type: String, default: '' },
  },
  { timestamps: true },
);
lotSchema.plugin(tenantScoped);
lotSchema.index({ tenantId: 1, testKey: 1, fieldKey: 1, active: 1 });

export const QcLot = mongoose.model('QcLot', lotSchema);
