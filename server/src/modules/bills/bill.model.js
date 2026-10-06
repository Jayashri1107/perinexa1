// A patient's bill: lines from the price list (or written in, or from a pharmacy sale), a discount, and the money
// paid and refunded against it. Amounts in rupees, rounded to paise (core/money.js).
import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';
import { PAYMENT_MODE_KEYS, PRICE_GROUP_KEYS } from '../../config/index.js';

const { ObjectId } = mongoose.Schema.Types;

const lineSchema = new mongoose.Schema({
  priceItemId: { type: ObjectId, ref: 'PriceItem', default: null },
  code: { type: String, default: '' },
  name: { type: String, required: true, trim: true, maxlength: 150 },
  group: { type: String, enum: PRICE_GROUP_KEYS, required: true },
  qty: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  amount: { type: Number, required: true, min: 0 },
  source: { type: String, enum: ['manual', 'pharmacy'], default: 'manual' },
  sourceRef: { type: String, default: '' }, // e.g. the pharmacy invoice number
  addedBy: { type: ObjectId, ref: 'User', default: null },
  addedAt: { type: Date, default: Date.now },
});

const billSchema = new mongoose.Schema(
  {
    billNumber: { type: String, required: true, immutable: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true, immutable: true },
    patient: { patientNumber: String, name: String }, // as at the time of the bill
    lines: { type: [lineSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    discount: {
      mode: { type: String, enum: ['amount', 'percent'], default: 'amount' },
      value: { type: Number, default: 0 },
      amount: { type: Number, default: 0 },
      reason: { type: String, default: '' },
    },
    total: { type: Number, default: 0 },
    paid: { type: Number, default: 0 },
    refunded: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    status: { type: String, enum: ['open', 'paid', 'cancelled'], default: 'open' },
    cancelReason: { type: String, default: '' },
    createdBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);
billSchema.plugin(hospitalScoped);
billSchema.index({ hospitalId: 1, billNumber: 1 }, { unique: true });
billSchema.index({ hospitalId: 1, createdAt: -1 });
billSchema.index({ hospitalId: 1, status: 1, balance: 1, createdAt: 1 });
billSchema.index({ hospitalId: 1, patientId: 1, createdAt: -1 });

export const Bill = mongoose.model('Bill', billSchema, 'bills');

// One payment or refund, with its own receipt number.
const paymentSchema = new mongoose.Schema(
  {
    receiptNumber: { type: String, required: true, immutable: true },
    billId: { type: ObjectId, ref: 'Bill', required: true },
    billNumber: { type: String, required: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    kind: { type: String, enum: ['payment', 'refund'], required: true },
    mode: { type: String, enum: PAYMENT_MODE_KEYS, required: true },
    reference: { type: String, trim: true, maxlength: 100, default: '' },
    amount: { type: Number, required: true, min: 0.01 },
    reason: { type: String, trim: true, maxlength: 200, default: '' },
    byUserId: { type: ObjectId, ref: 'User', required: true },
    byName: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
paymentSchema.plugin(hospitalScoped);
paymentSchema.index({ hospitalId: 1, receiptNumber: 1 }, { unique: true });
paymentSchema.index({ hospitalId: 1, billId: 1, createdAt: 1 });
paymentSchema.index({ hospitalId: 1, createdAt: -1 });

export const Payment = mongoose.model('Payment', paymentSchema, 'payments');
