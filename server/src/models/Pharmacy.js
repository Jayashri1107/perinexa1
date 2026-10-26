import mongoose from 'mongoose';
import { COUNTER_MODES, DEFAULT_GST_RATE, FORMS, GST_RATES, OLD_GST_RATES, ORDER_STATUSES, SCHEDULES, SUPPLIER_RETURN_REASONS } from '../pharmacy/pharmacyRules.js';
import { tenantScoped } from '../utils/tenantScope.js';

// Pharmacy and medicine stock (docs/PHARMACY_PLAN.md). All hospital-scoped. Amounts are whole paise; quantities are
// units of sale (tablets, bottles, vials …). Nothing is deleted: medicines and suppliers are stopped, purchases and
// invoices cancelled or returned, and every change of stock is a StockMove (the registers are read from these).

const { ObjectId } = mongoose.Schema.Types;
const stamp = { by: { type: ObjectId, ref: 'User' }, byName: String, at: Date };
const stampSchema = new mongoose.Schema(stamp, { _id: false });
const reasonStamp = new mongoose.Schema({ ...stamp, reason: String }, { _id: false });
// A cancellation that may need a witness (a return of Schedule X or narcotic stock that is put back)
const witnessedStamp = new mongoose.Schema({ ...stamp, reason: String, witness: { type: String, default: '' } }, { _id: false });
const text = (max) => ({ type: String, trim: true, maxlength: max, default: '' });

// ---------- A medicine on the stock list ----------
const medicineSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 }, // brand, as on the pack
    generic: text(160),
    form: { type: String, enum: FORMS, default: 'tablet' },
    strength: text(60),
    unit: { type: String, trim: true, maxlength: 30, default: 'tablet' }, // the unit of sale
    hsn: text(12),
    gstRate: { type: Number, enum: [...GST_RATES, ...OLD_GST_RATES], default: DEFAULT_GST_RATE }, // new choices: GST_RATES only (routes)
    schedule: { type: String, enum: SCHEDULES, default: '' },
    reorderLevel: { type: Number, min: 0, default: 0 },
    // The barcodes printed on its packs (typed or scanned), without spaces and in capitals. Found by exact match.
    barcodes: { type: [String], default: [] },
    active: { type: Boolean, default: true },
    updatedByName: { type: String, default: '' },
  },
  { timestamps: true },
);
medicineSchema.plugin(tenantScoped);
medicineSchema.index({ tenantId: 1, name: 1 });
// A barcode belongs to only one medicine in a hospital (medicines without barcodes are left out of this index).
medicineSchema.index({ tenantId: 1, barcodes: 1 }, { unique: true, partialFilterExpression: { barcodes: { $type: 'string' } } });
export const Medicine = mongoose.model('Medicine', medicineSchema);

// ---------- A supplier ----------
const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    gstin: text(20),
    drugLicence: text(80),
    phone: text(30),
    address: text(300),
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
supplierSchema.plugin(tenantScoped);
supplierSchema.index({ tenantId: 1, name: 1 });
export const Supplier = mongoose.model('Supplier', supplierSchema);

// ---------- A purchase (one supplier invoice) ----------
const purchaseLineSchema = new mongoose.Schema({
  medicineId: { type: ObjectId, ref: 'Medicine', required: true },
  name: { type: String, required: true },
  batch: { type: String, required: true, trim: true, maxlength: 40 },
  expiry: { type: Date, required: true }, // the last day of the expiry month (midnight UTC)
  qty: { type: Number, required: true, min: 0 },
  freeQty: { type: Number, min: 0, default: 0 },
  ratePaise: { type: Number, required: true, min: 0 }, // purchase price per unit
  mrpPaise: { type: Number, required: true, min: 1 }, // MRP per unit
  batchId: { type: ObjectId, ref: 'StockBatch', default: null },
  // The medicine's HSN code and GST rate on the day of the purchase (kept from 4 Oct 2026, for a debit note when
  // stock goes back to the supplier). Not recorded on older purchases: the medicine's present ones are used.
  hsn: { type: String, default: '' },
  gstRate: { type: Number, default: null },
  // The line as written on the supplier's bill (GRN, 26 Oct 2026): a pack of `conv` units, its quantity, free
  // quantity, MRP and rate per pack, the discount, and the sums (server/src/pharmacy/grn.js). Not on older purchases.
  pack: {
    type: new mongoose.Schema({ conv: Number, qty: Number, freeQty: Number, ratePaise: Number, mrpPaise: Number, discPercent: Number, totalPaise: Number, discPaise: Number, taxablePaise: Number, gstPaise: Number }, { _id: false }),
    default: null,
  },
});
// The bill's own details and sums (GRN, 26 Oct 2026). Not on older purchases.
const grnSchema = new mongoose.Schema(
  {
    gateEntryNo: { type: String, default: '' },
    taxType: { type: String, enum: ['cgst_sgst', 'igst'], default: 'cgst_sgst' },
    payment: { type: String, enum: ['credit', 'cash'], default: 'credit' },
    receivedBy: { type: String, default: '' },
    remark: { type: String, default: '' },
    schemeDiscPaise: Number,
    discPercent: Number,
    crnAdjPaise: Number,
    otherChargesPaise: Number,
    surchargePaise: Number,
    freightPaise: Number,
    totalPaise: Number,
    itemDiscPaise: Number,
    discPaise: Number,
    lessPaise: Number,
    addPaise: Number,
    gstPaise: Number,
    cgstPaise: Number,
    sgstPaise: Number,
    igstPaise: Number,
    roundingPaise: Number,
    netPaise: Number,
  },
  { _id: false },
);
const purchaseSchema = new mongoose.Schema(
  {
    number: { type: String, required: true }, // PU-000001
    supplierId: { type: ObjectId, ref: 'Supplier', required: true },
    invoiceNo: { type: String, required: true, trim: true, maxlength: 60 },
    invoiceDate: { type: Date, required: true },
    lines: { type: [purchaseLineSchema], default: [] },
    totalPaise: { type: Number, default: 0 }, // purchase value (rate × quantity)
    // The purchase order this delivery was received against (PO-000001), if any.
    orderId: { type: ObjectId, ref: 'PurchaseOrder', default: null },
    grn: { type: grnSchema, default: null },
    status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
    cancelled: { type: reasonStamp, default: null },
    created: { type: stampSchema, required: true },
  },
  { timestamps: true },
);
purchaseSchema.plugin(tenantScoped);
purchaseSchema.index({ tenantId: 1, number: 1 }, { unique: true });
purchaseSchema.index({ tenantId: 1, invoiceDate: -1 });
purchaseSchema.index({ tenantId: 1, orderId: 1 }, { partialFilterExpression: { orderId: { $type: 'objectId' } } });
export const Purchase = mongoose.model('Purchase', purchaseSchema);

// ---------- A purchase order to a supplier (what the pharmacy asks for; no stock moves until it is received) ----------
const orderLineSchema = new mongoose.Schema({
  medicineId: { type: ObjectId, ref: 'Medicine', required: true },
  name: { type: String, required: true }, // as on the stock list when it was ordered
  qty: { type: Number, required: true, min: 1 }, // units of sale
  receivedQty: { type: Number, default: 0, min: 0 }, // units that came in on purchases received against this order
});
const orderSchema = new mongoose.Schema(
  {
    number: { type: String, required: true }, // PO-000001
    supplierId: { type: ObjectId, ref: 'Supplier', required: true },
    lines: { type: [orderLineSchema], default: [] },
    note: text(300), // a line to the supplier, printed on the order
    status: { type: String, enum: ORDER_STATUSES, default: 'draft' },
    sent: { type: stampSchema, default: null },
    cancelled: { type: reasonStamp, default: null },
    closed: { type: reasonStamp, default: null }, // part received, and nothing more will come
    created: { type: stampSchema, required: true },
  },
  { timestamps: true },
);
orderSchema.plugin(tenantScoped);
orderSchema.index({ tenantId: 1, number: 1 }, { unique: true });
orderSchema.index({ tenantId: 1, status: 1, 'created.at': -1 });
export const PurchaseOrder = mongoose.model('PurchaseOrder', orderSchema);

// ---------- Stock returned to a supplier, with its debit note (SR-000001) ----------
const supplierReturnLineSchema = new mongoose.Schema({
  medicineId: { type: ObjectId, ref: 'Medicine', required: true },
  name: { type: String, required: true },
  generic: { type: String, default: '' },
  hsn: { type: String, default: '' },
  gstRate: { type: Number, required: true },
  schedule: { type: String, default: '' },
  batchId: { type: ObjectId, ref: 'StockBatch', required: true },
  batch: { type: String, required: true },
  expiry: { type: Date, required: true },
  qty: { type: Number, required: true, min: 1 },
  ratePaise: { type: Number, required: true }, // per unit, as on the purchase (before GST)
  taxablePaise: { type: Number, required: true },
  gstPaise: { type: Number, required: true },
  cgstPaise: { type: Number, required: true },
  sgstPaise: { type: Number, required: true },
  igstPaise: { type: Number, required: true },
  amountPaise: { type: Number, required: true },
  purchaseId: { type: ObjectId, ref: 'Purchase', default: null },
  purchaseNumber: { type: String, default: '' },
  invoiceNo: { type: String, default: '' }, // the supplier's invoice it came on
  invoiceDate: { type: Date, default: null },
});
const supplierReturnSchema = new mongoose.Schema(
  {
    number: { type: String, required: true }, // SR-000001 (also the debit note's number)
    supplierId: { type: ObjectId, ref: 'Supplier', required: true },
    reason: { type: String, enum: SUPPLIER_RETURN_REASONS, required: true },
    note: text(200),
    witness: text(150), // Schedule X and narcotic medicines
    interState: { type: Boolean, default: false }, // the supplier is in another state: IGST instead of CGST + SGST
    lines: { type: [supplierReturnLineSchema], default: [] },
    // A return entered by mistake is cancelled, never deleted: its units go back on their batches (5 Oct 2026).
    // Returns made before that have no status: they count as active.
    status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
    cancelled: { type: witnessedStamp, default: null },
    created: { type: stampSchema, required: true },
  },
  { timestamps: true },
);
supplierReturnSchema.plugin(tenantScoped);
supplierReturnSchema.index({ tenantId: 1, number: 1 }, { unique: true });
supplierReturnSchema.index({ tenantId: 1, 'created.at': -1 });
supplierReturnSchema.index({ tenantId: 1, supplierId: 1, 'created.at': -1 });
export const SupplierReturn = mongoose.model('SupplierReturn', supplierReturnSchema);

// ---------- A batch in stock ----------
const batchSchema = new mongoose.Schema(
  {
    medicineId: { type: ObjectId, ref: 'Medicine', required: true },
    batch: { type: String, required: true },
    expiry: { type: Date, required: true },
    mrpPaise: { type: Number, required: true },
    costPaise: { type: Number, required: true }, // purchase price per unit
    qtyIn: { type: Number, required: true, min: 0 },
    qtyLeft: { type: Number, required: true, min: 0 },
    purchaseId: { type: ObjectId, ref: 'Purchase', default: null },
    supplierId: { type: ObjectId, ref: 'Supplier', default: null },
  },
  { timestamps: true },
);
batchSchema.plugin(tenantScoped);
batchSchema.index({ tenantId: 1, medicineId: 1, expiry: 1 });
batchSchema.index({ tenantId: 1, expiry: 1, qtyLeft: 1 });
export const StockBatch = mongoose.model('StockBatch', batchSchema);

// ---------- Every change of stock (the registers are read from these) ----------
// 'supplier_return': stock sent back to the supplier it was bought from (4 Oct 2026).
// 'supplier_return_cancelled': such a return was entered by mistake and cancelled – the units are back (5 Oct 2026).
export const MOVE_KINDS = ['purchase', 'purchase_cancelled', 'sale', 'issue', 'return', 'writeoff', 'count', 'supplier_return', 'supplier_return_cancelled'];
const moveSchema = new mongoose.Schema({
  medicineId: { type: ObjectId, ref: 'Medicine', required: true },
  batchId: { type: ObjectId, ref: 'StockBatch', required: true },
  kind: { type: String, enum: MOVE_KINDS, required: true },
  qty: { type: Number, required: true }, // + in, − out
  balanceAfter: { type: Number, required: true }, // of the medicine (all batches), for the registers
  ref: { type: new mongoose.Schema({ kind: { type: String, enum: ['purchase', 'invoice', 'supplier_return'] }, id: ObjectId, number: String }, { _id: false }), default: null },
  patientId: { type: ObjectId, ref: 'Patient', default: null },
  customer: text(150), // a walk-in's name
  doctorName: text(150),
  doctorReg: text(60),
  supplierName: text(150),
  reason: text(200),
  witness: text(150), // stock counts, and returns to a supplier (and their cancelling) of Schedule X and narcotic medicines
  ...stamp,
});
moveSchema.plugin(tenantScoped);
moveSchema.index({ tenantId: 1, medicineId: 1, at: 1, _id: 1 });
moveSchema.index({ tenantId: 1, at: 1 });
export const StockMove = mongoose.model('StockMove', moveSchema);

// ---------- A pharmacy invoice: a counter sale, or an issue to an admitted patient ----------
const invoiceLineSchema = new mongoose.Schema({
  medicineId: { type: ObjectId, ref: 'Medicine', required: true },
  name: { type: String, required: true },
  generic: { type: String, default: '' },
  hsn: { type: String, default: '' },
  gstRate: { type: Number, required: true },
  schedule: { type: String, default: '' },
  batchId: { type: ObjectId, ref: 'StockBatch', required: true },
  batch: { type: String, required: true },
  expiry: { type: Date, required: true },
  qty: { type: Number, required: true, min: 1 },
  mrpPaise: { type: Number, required: true },
  amountPaise: { type: Number, required: true },
  taxablePaise: { type: Number, required: true },
  gstPaise: { type: Number, required: true },
  cgstPaise: { type: Number, required: true },
  sgstPaise: { type: Number, required: true },
  returnedQty: { type: Number, default: 0 },
});
const returnLineSchema = new mongoose.Schema(
  { lineId: ObjectId, qty: Number, amountPaise: Number, taxablePaise: Number, gstPaise: Number, cgstPaise: Number, sgstPaise: Number },
  { _id: false },
);
const invoiceSchema = new mongoose.Schema(
  {
    number: { type: String, required: true }, // PH-000001
    kind: { type: String, enum: ['sale', 'issue'], required: true },
    patientId: { type: ObjectId, ref: 'Patient', default: null },
    customer: { type: new mongoose.Schema({ name: String, phone: String }, { _id: false }), default: null }, // a walk-in
    // A walk-in sale to a business that gave its GSTIN (4 Oct 2026): printed on the tax invoice and used for the
    // e-invoice file. Never a patient. Not recorded on other invoices.
    buyer: {
      type: new mongoose.Schema({ name: String, gstin: String, address: String, place: String, pin: String, state: String, stateCode: String }, { _id: false }),
      default: null,
    },
    doctor: { type: new mongoose.Schema({ name: String, reg: String }, { _id: false }), default: null },
    visitId: { type: ObjectId, ref: 'Visit', default: null }, // the Perinexa prescription it was sold from
    rxSeen: { type: Boolean, default: false }, // an outside prescription was seen
    admissionId: { type: ObjectId, ref: 'Admission', default: null },
    lines: { type: [invoiceLineSchema], default: [] },
    discountPercent: { type: Number, min: 0, max: 100, default: 0 },
    discountReason: { type: String, default: '' },
    billId: { type: ObjectId, ref: 'Bill', default: null }, // the patient's hospital bill it went on
    // A walk-in pays at the counter: payments and refunds on the invoice itself.
    payments: {
      type: [new mongoose.Schema({ kind: { type: String, enum: ['payment', 'refund'] }, mode: { type: String, enum: COUNTER_MODES }, amountPaise: Number, reference: String, ...stamp })],
      default: [],
    },
    // Returns: each a GST credit note (CN-000001)
    returns: { type: [new mongoose.Schema({ number: String, lines: [returnLineSchema], reason: String, ...stamp })], default: [] },
    created: { type: stampSchema, required: true },
  },
  { timestamps: true },
);
invoiceSchema.plugin(tenantScoped);
invoiceSchema.index({ tenantId: 1, number: 1 }, { unique: true });
invoiceSchema.index({ tenantId: 1, 'created.at': -1 });
invoiceSchema.index({ tenantId: 1, patientId: 1, 'created.at': -1 });
export const PharmacyInvoice = mongoose.model('PharmacyInvoice', invoiceSchema);
