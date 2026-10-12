import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// Per-hospital number sequences (e.g. patient record numbers P-000001, P-000002, …).
const counterSchema = new mongoose.Schema({
  name: { type: String, required: true },
  seq: { type: Number, default: 0 },
});
counterSchema.plugin(tenantScoped);
counterSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export const Counter = mongoose.model('Counter', counterSchema);

export async function nextNumber(tenantId, name) {
  const counter = await Counter.findOneAndUpdate(
    { tenantId, name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  return counter.seq;
}
