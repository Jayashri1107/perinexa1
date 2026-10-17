import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// Every change to the lab's stock (Lab version 2): received, used by a test (orderId), adjusted after a count, written
// off (expired, broken), with who and when. qty is signed: + in, - out. costPaise: the value moved.
const moveSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'LabItem', required: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'LabBatch', default: null },
    kind: { type: String, enum: ['received', 'used', 'adjusted', 'written_off'], required: true },
    qty: { type: Number, required: true },
    costPaise: { type: Number, default: 0 },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'LabOrder', default: null },
    testKey: { type: String, default: null },
    reason: { type: String, trim: true, maxlength: 200, default: '' },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: String,
    at: { type: Date, required: true },
  },
  { timestamps: false },
);
moveSchema.plugin(tenantScoped);
moveSchema.index({ tenantId: 1, itemId: 1, at: -1 });
moveSchema.index({ tenantId: 1, kind: 1, at: -1 });

export const LabStockMove = mongoose.model('LabStockMove', moveSchema);
