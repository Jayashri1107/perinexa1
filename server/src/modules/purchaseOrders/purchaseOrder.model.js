// A purchase order to a supplier (PO-000001 …, as in Perinexa): what the pharmacy asks a supplier for. An order moves no
// stock – stock comes in only when a purchase (the supplier's invoice) is recorded against it.
//   draft ──send──▶ sent ──receive──▶ part received ──receive──▶ received
//     │              │                      └──close (nothing more will come; it stays "part received")
//     └──cancel──────┴──▶ cancelled (only while nothing has been received)
import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';

const { ObjectId } = mongoose.Schema.Types;
const stamp = (extra = {}) => ({
  type: new mongoose.Schema({ by: { type: ObjectId, ref: 'User' }, byName: String, at: Date, ...extra }, { _id: false }),
  default: null,
});

export const ORDER_STATUSES = ['draft', 'sent', 'part_received', 'received', 'cancelled'];

const lineSchema = new mongoose.Schema(
  {
    medicineId: { type: ObjectId, ref: 'Medicine', required: true },
    medicineName: { type: String, required: true },
    qty: { type: Number, required: true, min: 1 },
    gstRate: { type: Number, default: 0, min: 0 }, // the medicine's rate when ordered: the invoice form starts from it
    receivedQty: { type: Number, default: 0, min: 0 }, // paid and free units of the purchases recorded against it
  },
  { _id: false },
);

const purchaseOrderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, immutable: true },
    supplierId: { type: ObjectId, ref: 'Supplier', required: true },
    supplierName: { type: String, required: true },
    status: { type: String, enum: ORDER_STATUSES, default: 'draft' },
    lines: { type: [lineSchema], default: [] },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    created: { type: new mongoose.Schema({ by: { type: ObjectId, ref: 'User' }, byName: String, at: Date }, { _id: false }), required: true },
    sent: stamp(),
    cancelled: stamp({ reason: String }),
    closed: stamp({ reason: String }),
  },
  { timestamps: true, optimisticConcurrency: true },
);
purchaseOrderSchema.plugin(hospitalScoped);
purchaseOrderSchema.index({ hospitalId: 1, orderNumber: 1 }, { unique: true });
purchaseOrderSchema.index({ hospitalId: 1, status: 1, createdAt: -1 });
purchaseOrderSchema.index({ hospitalId: 1, supplierId: 1, status: 1 });

export const PurchaseOrder = mongoose.model('PurchaseOrder', purchaseOrderSchema, 'purchase_orders');
