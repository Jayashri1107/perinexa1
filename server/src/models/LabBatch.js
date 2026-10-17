import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A batch of a lab stock item (Lab version 2): batch number, expiry, what is left, and the cost of one unit (paise) –
// for the cost per test. Never deleted (an empty batch stays with qty 0).
const batchSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'LabItem', required: true },
    batchNo: { type: String, trim: true, maxlength: 60, required: true },
    expiresOn: { type: Date, default: null },
    qty: { type: Number, min: 0, required: true },
    unitCostPaise: { type: Number, min: 0, default: 0 },
    supplier: { type: String, trim: true, maxlength: 120, default: '' },
    receivedAt: { type: Date, required: true },
  },
  { timestamps: true },
);
batchSchema.plugin(tenantScoped);
batchSchema.index({ tenantId: 1, itemId: 1, expiresOn: 1 });

export const LabBatch = mongoose.model('LabBatch', batchSchema);
