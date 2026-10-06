// Running numbers per hospital (patient numbers, bills, receipts, invoices): P-000001, B-000001 …
// One atomic $inc per number, so two people saving at the same moment never get the same number.
import mongoose from './mongoose.js';

const counterSchema = new mongoose.Schema(
  {
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
    name: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false },
);
counterSchema.index({ hospitalId: 1, name: 1 }, { unique: true });

export const Counter = mongoose.model('Counter', counterSchema, 'counters');

export async function nextNumber(hospitalId, name, prefix, digits) {
  const { seq } = await Counter.findOneAndUpdate({ hospitalId, name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  return `${prefix}${String(seq).padStart(digits, '0')}`;
}
