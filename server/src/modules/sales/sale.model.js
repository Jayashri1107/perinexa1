// A counter sale with its GST tax invoice (PH-000001 …). Lines are per batch (one medicine may use two batches).
import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';
import { PAYMENT_MODE_KEYS } from '../../config/index.js';

const { ObjectId } = mongoose.Schema.Types;

const lineSchema = new mongoose.Schema({
  medicineId: { type: ObjectId, ref: 'Medicine', required: true },
  name: { type: String, required: true },
  schedule: { type: String, required: true },
  hsn: { type: String, default: '' },
  batchId: { type: ObjectId, ref: 'StockBatch', required: true },
  batch: { type: String, required: true },
  expiry: { type: Date, required: true },
  qty: { type: Number, required: true, min: 1 },
  returnedQty: { type: Number, default: 0, min: 0 },
  mrp: { type: Number, required: true, min: 0 }, // per unit, GST included
  gstRate: { type: Number, required: true, min: 0 },
  amount: { type: Number, required: true, min: 0 }, // mrp × qty
});

const saleSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, immutable: true },
    patientId: { type: ObjectId, ref: 'Patient', default: null },
    patient: { patientNumber: String, name: String },
    customerName: { type: String, trim: true, maxlength: 120, default: '' }, // a walk-in buyer
    doctorName: { type: String, trim: true, maxlength: 120, default: '' },
    lines: { type: [lineSchema], default: [] },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { amount: { type: Number, default: 0 }, reason: { type: String, default: '' } },
    total: { type: Number, required: true, min: 0 },
    taxable: { type: Number, required: true, min: 0 },
    gst: { type: Number, required: true, min: 0 },
    returnedAmount: { type: Number, default: 0 },
    // paid at the counter, or put on her hospital bill
    payment: {
      to: { type: String, enum: ['counter', 'bill'], required: true },
      mode: { type: String, enum: ['', ...PAYMENT_MODE_KEYS], default: '' },
      reference: { type: String, default: '' },
      billNumber: { type: String, default: '' },
    },
    status: { type: String, enum: ['completed', 'part_returned', 'returned'], default: 'completed' },
    byUserId: { type: ObjectId, ref: 'User', required: true },
    byName: { type: String, default: '' },
  },
  { timestamps: true, optimisticConcurrency: true },
);
saleSchema.plugin(hospitalScoped);
saleSchema.index({ hospitalId: 1, invoiceNumber: 1 }, { unique: true });
saleSchema.index({ hospitalId: 1, createdAt: -1 });
saleSchema.index({ hospitalId: 1, patientId: 1, createdAt: -1 });

export const Sale = mongoose.model('Sale', saleSchema, 'sales');
