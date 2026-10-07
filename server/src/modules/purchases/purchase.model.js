// One supplier invoice: each line becomes a stock batch.
import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';

const { ObjectId } = mongoose.Schema.Types;

const lineSchema = new mongoose.Schema(
  {
    medicineId: { type: ObjectId, ref: 'Medicine', required: true },
    medicineName: { type: String, required: true },
    batchId: { type: ObjectId, ref: 'StockBatch', required: true },
    batch: { type: String, required: true },
    expiry: { type: Date, required: true },
    qty: { type: Number, required: true, min: 1 },
    freeQty: { type: Number, default: 0, min: 0 },
    purchasePrice: { type: Number, required: true, min: 0 },
    mrp: { type: Number, required: true, min: 0 },
    gstRate: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const purchaseSchema = new mongoose.Schema(
  {
    supplierId: { type: ObjectId, ref: 'Supplier', required: true },
    supplierName: { type: String, required: true },
    invoiceNumber: { type: String, required: true, trim: true, maxlength: 60 },
    invoiceDate: { type: Date, required: true },
    // the purchase order this invoice delivers, if any
    purchaseOrderId: { type: ObjectId, ref: 'PurchaseOrder', default: null },
    orderNumber: { type: String, default: '' },
    lines: { type: [lineSchema], default: [] },
    total: { type: Number, required: true, min: 0 },
    byUserId: { type: ObjectId, ref: 'User', required: true },
    byName: { type: String, default: '' },
  },
  { timestamps: true },
);
purchaseSchema.plugin(hospitalScoped);
purchaseSchema.index({ hospitalId: 1, supplierId: 1, invoiceNumber: 1 }, { unique: true });
purchaseSchema.index({ hospitalId: 1, invoiceDate: -1 });

export const Purchase = mongoose.model('Purchase', purchaseSchema, 'purchases');
