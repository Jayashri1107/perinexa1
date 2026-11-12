import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// PH12 (docs/PHARMACY_BUILD_NOTE.md): the ward asks the pharmacy on screen. A request (WR-000001) for an admitted
// patient: lines of medicine and quantity, urgent or not, the doctor who ordered. Requested → issued / part issued /
// refused / cancelled. Issuing is an ordinary pharmacy issue (an invoice on her stay bill) with the request's id.
const { ObjectId } = mongoose.Schema.Types;
const stamp = { by: { type: ObjectId, ref: 'User' }, byName: String, at: Date };
const stampSchema = new mongoose.Schema(stamp, { _id: false });

export const WARD_REQUEST_STATUSES = ['requested', 'part_issued', 'issued', 'refused', 'cancelled'];

const lineSchema = new mongoose.Schema(
  {
    medicineId: { type: ObjectId, ref: 'Medicine', required: true },
    name: String, // as it was when asked
    qty: { type: Number, min: 1, max: 1000, required: true },
    issuedQty: { type: Number, default: 0 },
    refused: { type: new mongoose.Schema({ ...stamp, reason: String }, { _id: false }), default: null },
  },
  { _id: false },
);

const wardRequestSchema = new mongoose.Schema(
  {
    number: { type: String, required: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    admissionId: { type: ObjectId, ref: 'Admission', required: true },
    lines: { type: [lineSchema], default: [] },
    urgent: { type: Boolean, default: false },
    note: { type: String, maxlength: 300, default: '' },
    // The doctor (or RMO) who ordered it: the narcotic and Schedule X rule takes the registration number from here
    orderedBy: { type: new mongoose.Schema({ userId: ObjectId, name: String, reg: String }, { _id: false }), required: true },
    status: { type: String, enum: WARD_REQUEST_STATUSES, default: 'requested' },
    requested: { type: stampSchema, required: true },
    issues: { type: [new mongoose.Schema({ invoiceId: ObjectId, number: String, ...stamp }, { _id: false })], default: [] },
    cancelled: { type: new mongoose.Schema({ ...stamp, reason: String }, { _id: false }), default: null },
  },
  { timestamps: true },
);
wardRequestSchema.plugin(tenantScoped);
wardRequestSchema.index({ tenantId: 1, number: 1 }, { unique: true });
wardRequestSchema.index({ tenantId: 1, status: 1, urgent: -1, createdAt: 1 });
wardRequestSchema.index({ tenantId: 1, patientId: 1, createdAt: -1 });

export const WardRequest = mongoose.model('WardRequest', wardRequestSchema);

/** The request's status from its lines (PURE): every line issued in full or refused → issued (or refused if none). */
export function statusOfLines(lines) {
  const settled = (l) => l.refused || l.issuedQty >= l.qty;
  const anyIssued = lines.some((l) => l.issuedQty > 0);
  if (lines.every(settled)) return anyIssued ? 'issued' : 'refused';
  return anyIssued || lines.some((l) => l.refused) ? 'part_issued' : 'requested';
}
