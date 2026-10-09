// A service a nurse gave a patient (owner, 9 Oct 2026): an injection, a dressing, an IV drip, an NST … chosen from the
// hospital's price list, with the price as it was then. Recorded → sent to the front desk ("sent") → added to her
// bill by reception or billing ("billed", with the bill number). One recorded by mistake is cancelled, with the reason,
// while it is still waiting; once on a bill, the bill's line is removed there instead. Never deleted.
import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';

const { ObjectId } = mongoose.Schema.Types;
const stampSchema = new mongoose.Schema({ by: ObjectId, byName: String, at: Date, reason: String, billId: ObjectId, billNumber: String }, { _id: false });

const itemSchema = new mongoose.Schema(
  {
    priceItemId: { type: ObjectId, ref: 'PriceItem', required: true },
    code: { type: String, default: '' },
    name: { type: String, required: true },
    group: { type: String, required: true },
    qty: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const nursingServiceSchema = new mongoose.Schema(
  {
    serviceNumber: { type: String, required: true, immutable: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    admissionId: { type: ObjectId, ref: 'Admission', default: null }, // her stay, when she is in hospital
    items: { type: [itemSchema], required: true },
    amount: { type: Number, required: true, min: 0 },
    givenAt: { type: Date, required: true },
    note: { type: String, trim: true, maxlength: 300, default: '' },
    status: { type: String, enum: ['sent', 'billed', 'cancelled'], default: 'sent' },
    given: { type: stampSchema, required: true },
    billed: { type: stampSchema, default: null },
    cancelled: { type: stampSchema, default: null },
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true },
);
nursingServiceSchema.plugin(hospitalScoped);
nursingServiceSchema.index({ hospitalId: 1, status: 1, givenAt: 1 });
nursingServiceSchema.index({ hospitalId: 1, patientId: 1, givenAt: -1 });
nursingServiceSchema.index({ hospitalId: 1, admissionId: 1, givenAt: -1 });
nursingServiceSchema.index({ hospitalId: 1, serviceNumber: 1 }, { unique: true });
nursingServiceSchema.index({ hospitalId: 1, clientRequestId: 1 }, { unique: true });

export const NursingService = mongoose.model('NursingService', nursingServiceSchema, 'nursing_services');
