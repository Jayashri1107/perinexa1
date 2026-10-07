// Stock returned to a supplier (SR-000001 …, as in Perinexa), each with a printable debit note. A return is never
// deleted: one entered by mistake is cancelled with a reason and its units go back on their batches.
import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';
import { SUPPLIER_RETURN_REASON_KEYS } from '../../config/index.js';

const { ObjectId } = mongoose.Schema.Types;

const lineSchema = new mongoose.Schema(
  {
    batchId: { type: ObjectId, ref: 'StockBatch', required: true },
    medicineId: { type: ObjectId, ref: 'Medicine', required: true },
    medicineName: { type: String, required: true },
    schedule: { type: String, required: true },
    batch: { type: String, required: true },
    expiry: { type: Date, required: true },
    qty: { type: Number, required: true, min: 1 },
    rate: { type: Number, required: true, min: 0 }, // purchase price per unit (before GST)
    gstRate: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 }, // qty × rate
    gst: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const supplierReturnSchema = new mongoose.Schema(
  {
    returnNumber: { type: String, required: true, immutable: true },
    supplierId: { type: ObjectId, ref: 'Supplier', required: true },
    supplierName: { type: String, required: true },
    supplierGstin: { type: String, default: '' },
    reason: { type: String, enum: SUPPLIER_RETURN_REASON_KEYS, required: true },
    note: { type: String, trim: true, maxlength: 300, default: '' },
    witness: { type: String, trim: true, maxlength: 100, default: '' }, // Schedule X and narcotic medicines
    lines: { type: [lineSchema], default: [] },
    amount: { type: Number, required: true, min: 0 },
    gst: { type: Number, required: true, min: 0 },
    interState: { type: Boolean, default: false }, // IGST instead of CGST + SGST
    total: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['returned', 'cancelled'], default: 'returned' },
    created: { type: new mongoose.Schema({ by: { type: ObjectId, ref: 'User' }, byName: String, at: Date }, { _id: false }), required: true },
    cancelled: {
      type: new mongoose.Schema({ by: { type: ObjectId, ref: 'User' }, byName: String, at: Date, reason: String, witness: String }, { _id: false }),
      default: null,
    },
  },
  { timestamps: true },
);
supplierReturnSchema.plugin(hospitalScoped);
supplierReturnSchema.index({ hospitalId: 1, returnNumber: 1 }, { unique: true });
supplierReturnSchema.index({ hospitalId: 1, createdAt: -1 });

export const SupplierReturn = mongoose.model('SupplierReturn', supplierReturnSchema, 'supplier_returns');
