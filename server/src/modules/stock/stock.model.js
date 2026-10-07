// Stock: each batch received (with its expiry, cost and MRP) and every movement in or out. The H1, Schedule X and
// narcotic registers are read from the movements.
import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';
import { SCHEDULE_KEYS } from '../../config/index.js';

const { ObjectId } = mongoose.Schema.Types;

const batchSchema = new mongoose.Schema(
  {
    medicineId: { type: ObjectId, ref: 'Medicine', required: true },
    batch: { type: String, required: true, trim: true, maxlength: 40 },
    expiry: { type: Date, required: true },
    qty: { type: Number, required: true, min: 0 }, // units on hand
    purchasePrice: { type: Number, required: true, min: 0 }, // per unit
    mrp: { type: Number, required: true, min: 0 }, // per unit, GST included
    gstRate: { type: Number, required: true, min: 0 },
    supplierId: { type: ObjectId, ref: 'Supplier', default: null },
    purchaseId: { type: ObjectId, ref: 'Purchase', default: null },
  },
  { timestamps: true },
);
batchSchema.plugin(hospitalScoped);
batchSchema.index({ hospitalId: 1, medicineId: 1, expiry: 1 });
batchSchema.index({ hospitalId: 1, expiry: 1, qty: 1 });

export const StockBatch = mongoose.model('StockBatch', batchSchema, 'stock_batches');

const movementSchema = new mongoose.Schema(
  {
    medicineId: { type: ObjectId, ref: 'Medicine', required: true },
    medicineName: { type: String, required: true },
    schedule: { type: String, enum: SCHEDULE_KEYS, required: true },
    batchId: { type: ObjectId, ref: 'StockBatch', required: true },
    batch: { type: String, required: true },
    // supplier_return(_cancelled): stock sent back to a supplier (or that return undone); ward_issue / ward_return: to and from
    // a patient in hospital
    kind: { type: String, enum: ['purchase', 'sale', 'return', 'writeoff', 'count', 'supplier_return', 'supplier_return_cancelled', 'ward_issue', 'ward_return'], required: true },
    qty: { type: Number, required: true }, // + in, − out
    ref: { type: String, default: '' }, // purchase or sale invoice number
    party: { type: String, default: '' }, // supplier, or patient / customer
    doctorName: { type: String, default: '' },
    reason: { type: String, default: '' },
    byUserId: { type: ObjectId, ref: 'User', required: true },
    byName: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
movementSchema.plugin(hospitalScoped);
movementSchema.index({ hospitalId: 1, schedule: 1, createdAt: -1 });
movementSchema.index({ hospitalId: 1, medicineId: 1, createdAt: -1 });

export const StockMovement = mongoose.model('StockMovement', movementSchema, 'stock_movements');

export async function recordMovement(req, { medicine, batch, kind, qty, ref = '', party = '', doctorName = '', reason = '' }) {
  return StockMovement.create({
    hospitalId: req.hospitalId,
    medicineId: medicine._id,
    medicineName: `${medicine.name}${medicine.strength ? ` ${medicine.strength}` : ''}`,
    schedule: medicine.schedule,
    batchId: batch._id,
    batch: batch.batch,
    kind,
    qty,
    ref,
    party,
    doctorName,
    reason,
    byUserId: req.user._id,
    byName: req.user.name,
  });
}
