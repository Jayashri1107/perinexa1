import mongoose from 'mongoose';
import { GROUPS, INSURANCE_FIELDS, PAYMENT_MODES } from '../billing/billingRules.js';
import { tenantScoped } from '../utils/tenantScope.js';

// A bill (billing, docs/BILLING_PLAN.md): one per patient per day for outpatients ('opd'), one per stay for inpatients
// ('ipd'). Lines are added automatically by the work done (visits, lab orders, bed days) or by reception from the price
// list; a line taken off stays, marked removed. Payments, deposits and refunds each have a receipt number. Amounts are
// whole paise. Nothing is deleted: a cancelled bill is kept with its reason. Totals are worked out (billing/money.js).

const { ObjectId } = mongoose.Schema.Types;
const stamp = { by: { type: ObjectId, ref: 'User' }, byName: String, at: Date };
const stampSchema = new mongoose.Schema(stamp, { _id: false });

const lineSchema = new mongoose.Schema({
  priceItemId: { type: ObjectId, ref: 'PriceItem', default: null },
  key: { type: String, default: null }, // the price item's key (e.g. lab:cbc, bed)
  name: { type: String, required: true, maxlength: 150 },
  group: { type: String, enum: GROUPS, required: true },
  qty: { type: Number, required: true, min: 1 },
  ratePaise: { type: Number, required: true, min: 0 },
  amountPaise: { type: Number, required: true, min: 0 },
  source: { type: String, enum: ['auto', 'manual'], required: true },
  // What added it automatically: a visit, a lab order (and which test), a stay's bed days, a scan or procedure done,
  // or an appointment whose consultation fee was taken in advance
  ref: { type: new mongoose.Schema({ kind: { type: String, enum: ['visit', 'lab', 'bed', 'pharmacy', 'work', 'appointment', 'registration', 'admission', 'nursing', 'round', 'scan'] }, id: ObjectId, test: String }, { _id: false }), default: null },
  doctorId: { type: ObjectId, ref: 'User', default: null }, // for the monthly report by doctor
  added: { type: stampSchema, required: true },
  removed: { type: new mongoose.Schema({ ...stamp, reason: String }, { _id: false }), default: null },
});

const paymentSchema = new mongoose.Schema({
  receipt: { type: String, required: true }, // R-000001
  kind: { type: String, enum: ['payment', 'deposit', 'refund'], required: true },
  mode: { type: String, enum: PAYMENT_MODES, required: true },
  amountPaise: { type: Number, required: true, min: 1 },
  reference: { type: String, trim: true, maxlength: 80, default: '' }, // UPI / card reference, or the claim number
  scheme: { type: String, trim: true, maxlength: 80, default: '' }, // insurance company or scheme
  ...stamp,
});

// Insurance or scheme details of the bill (billing extras, 4 Oct 2026): typed by reception or the hospital admin, all
// optional. The claim itself is made outside Perinexa. null = none recorded (also every bill made before this).
const insuranceSchema = new mongoose.Schema(
  { ...Object.fromEntries(Object.entries(INSURANCE_FIELDS).map(([key, max]) => [key, { type: String, trim: true, maxlength: max, default: '' }])), ...stamp },
  { _id: false },
);

const billSchema = new mongoose.Schema(
  {
    number: { type: String, required: true }, // B-000001
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    kind: { type: String, enum: ['opd', 'ipd'], required: true },
    on: { type: Date, required: true }, // the day (opd), or the day of admission (ipd)
    admissionId: { type: ObjectId, ref: 'Admission', default: null },
    lines: { type: [lineSchema], default: [] },
    discount: {
      type: new mongoose.Schema({ mode: { type: String, enum: ['amount', 'percent'] }, value: Number, paise: Number, reason: String, ...stamp }, { _id: false }),
      default: null,
    },
    payments: { type: [paymentSchema], default: [] },
    insurance: { type: insuranceSchema, default: null },
    status: { type: String, enum: ['open', 'cancelled'], default: 'open' },
    cancelled: { type: new mongoose.Schema({ ...stamp, reason: String }, { _id: false }), default: null },
  },
  { timestamps: true },
);
billSchema.plugin(tenantScoped);
billSchema.index({ tenantId: 1, number: 1 }, { unique: true });
billSchema.index({ tenantId: 1, patientId: 1, on: -1 });
billSchema.index({ tenantId: 1, on: -1 });
billSchema.index({ tenantId: 1, admissionId: 1 });
billSchema.index({ tenantId: 1, 'payments.at': 1 });
billSchema.index({ tenantId: 1, 'lines.ref.id': 1 });
// One open outpatient bill per patient per day, one open bill per stay.
billSchema.index({ tenantId: 1, patientId: 1, on: 1 }, { unique: true, partialFilterExpression: { kind: 'opd', status: 'open' } });
billSchema.index({ tenantId: 1, admissionId: 1 }, { unique: true, partialFilterExpression: { kind: 'ipd', status: 'open' }, name: 'one_open_stay_bill' });

export const Bill = mongoose.model('Bill', billSchema);
