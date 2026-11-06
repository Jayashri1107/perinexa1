import mongoose from 'mongoose';
import { BILI_METHODS, CORD_CLAMPING, NICU_OUTCOMES, NICU_REASONS, NICU_SOURCES, NICU_UNITS, RESUSCITATION } from '../clinical/newbornCare.js';
import { tenantScoped } from '../utils/tenantScope.js';

// A baby's care at birth and on the ward, her bilirubin readings and her NICU or SNCU admissions (Clinical Requirements
// Group B, items 12 and 13 – DRAFT, clinical/newbornCare.js). All on the baby's own record; each is saved with who and
// when, and never changed or deleted – one written by mistake is marked "entered in error".

const { ObjectId } = mongoose.Schema.Types;
const cancel = { type: new mongoose.Schema({ reason: String, by: ObjectId, byName: String, at: Date }, { _id: false }), default: null };
const stamp = { by: { type: ObjectId, ref: 'User', required: true }, byName: { type: String, required: true } };

// At birth (one per baby that is in use)
const birthSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    criedAtBirth: { type: String, enum: ['yes', 'no'], required: true },
    resuscitation: { type: String, enum: Object.keys(RESUSCITATION), required: true },
    cordClamping: { type: String, enum: Object.keys(CORD_CLAMPING), required: true },
    checks: { type: mongoose.Schema.Types.Mixed, default: {} }, // { key: 'yes' | 'no' | 'na' }
    temperatureC: { type: Number, default: null }, // at one hour
    note: { type: String, maxlength: 1000, default: '' },
    ...stamp,
    cancelled: cancel,
    live: { type: Boolean, default: true },
  },
  { timestamps: true, minimize: false },
);
birthSchema.plugin(tenantScoped);
birthSchema.index({ tenantId: 1, patientId: 1 }, { unique: true, partialFilterExpression: { live: true } });
export const NewbornBirthCare = mongoose.model('NewbornBirthCare', birthSchema);

// The examination on the ward (any number – before discharge, and later)
const examSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    examinedAt: { type: Date, required: true },
    weightGrams: { type: Number, default: null },
    findings: { type: mongoose.Schema.Types.Mixed, default: {} }, // { key: 'normal' | 'abnormal' }
    notes: { type: mongoose.Schema.Types.Mixed, default: {} },
    ready: { type: mongoose.Schema.Types.Mixed, default: {} }, // discharge readiness { key: 'yes' | 'no' }
    summary: { type: String, maxlength: 1000, default: '' },
    ...stamp,
    cancelled: cancel,
  },
  { timestamps: true, minimize: false },
);
examSchema.plugin(tenantScoped);
examSchema.index({ tenantId: 1, patientId: 1, examinedAt: -1 });
export const NewbornExam = mongoose.model('NewbornExam', examSchema);

// A bilirubin reading
const biliSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    at: { type: Date, required: true },
    mgdl: { type: Number, required: true, min: 0, max: 40 },
    method: { type: String, enum: Object.keys(BILI_METHODS), required: true },
    note: { type: String, maxlength: 300, default: '' },
    ...stamp,
    cancelled: cancel,
  },
  { timestamps: true },
);
biliSchema.plugin(tenantScoped);
biliSchema.index({ tenantId: 1, patientId: 1, at: 1 });
export const BilirubinReading = mongoose.model('BilirubinReading', biliSchema);

// A NICU or SNCU admission and its outcome – the register (NEO-L-05)
const nicuSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    serial: { type: Number, required: true }, // the register number, per hospital
    unit: { type: String, enum: Object.keys(NICU_UNITS), required: true },
    source: { type: String, enum: Object.keys(NICU_SOURCES), required: true },
    admittedAt: { type: Date, required: true },
    reasons: { type: [{ type: String, enum: Object.keys(NICU_REASONS) }], default: [] },
    reasonNote: { type: String, maxlength: 500, default: '' },
    weightGrams: { type: Number, default: null },
    temperatureC: { type: Number, default: null },
    gestationWeeks: { type: Number, default: null },
    ...stamp,
    outcome: { type: new mongoose.Schema({ result: { type: String, enum: Object.keys(NICU_OUTCOMES) }, at: Date, note: String, by: ObjectId, byName: String }, { _id: false }), default: null },
    cancelled: cancel,
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true },
);
nicuSchema.plugin(tenantScoped);
nicuSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });
nicuSchema.index({ tenantId: 1, serial: 1 }, { unique: true });
nicuSchema.index({ tenantId: 1, admittedAt: -1 });
nicuSchema.index({ tenantId: 1, patientId: 1, admittedAt: -1 });
export const NicuAdmission = mongoose.model('NicuAdmission', nicuSchema);
