import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// The lab's stock (Lab version 2 – docs/LAB_V2_PLAN.md): a reagent or consumable, its unit and reorder level, and what
// one test uses of it (perTest: { testKey, qty }) – taken from the earliest-expiring batch when the result is reported.
// Batches: LabBatch; every movement: LabStockMove. Never deleted.
const itemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    kind: { type: String, enum: ['reagent', 'consumable', 'control'], default: 'reagent' },
    unit: { type: String, trim: true, maxlength: 20, default: 'unit' }, // one quantity: mL, test, piece …
    reorderLevel: { type: Number, min: 0, default: 0 },
    perTest: { type: [new mongoose.Schema({ testKey: String, qty: { type: Number, min: 0 } }, { _id: false })], default: [] },
    active: { type: Boolean, default: true },
    updatedByName: { type: String, default: '' },
  },
  { timestamps: true },
);
itemSchema.plugin(tenantScoped);
itemSchema.index({ tenantId: 1, active: 1, name: 1 });
itemSchema.index({ tenantId: 1, 'perTest.testKey': 1 });

export const LabItem = mongoose.model('LabItem', itemSchema);
