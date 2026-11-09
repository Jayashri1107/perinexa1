import mongoose from 'mongoose';
import { BILI_METHODS, CORD_CLAMPING, NICU_OUTCOMES, NICU_REASONS, RESUSCITATION } from '../clinical/newbornCare.js';
import { ADMISSION_REASONS, BED_KINDS, OUTCOMES_F03 } from '../clinical/nicuAdmission.js';
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
    // The second person who checked the identity band (Group C, PX-X-06)
    idBandWitness: { type: new mongoose.Schema({ by: ObjectId, byName: String, role: String, at: Date }, { _id: false }), default: null },
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

// A NICU or SNCU admission and its outcome – the register (NEO-L-05). Build 13 (7 Nov 2026) made it the whole NEO-F-03
// form (clinical/nicuAdmission.js): format 'f03'. Records of the DRAFT (6 Nov 2026) have no format and keep their
// fields: unit nicu | sncu, source inborn | outborn, reasons, the hospital-wide serial. Every admission keeps a
// hospital-wide `serial`; a NEO-F-03 admission also gets its register number per unit per year (registerYear,
// registerNo) – given once, never changed (the model refuses), never reused: one entered in error keeps its number,
// so the register has no gaps.
const outcomeSchema = new mongoose.Schema(
  {
    result: { type: String, enum: [...Object.keys(NICU_OUTCOMES), ...Object.keys(OUTCOMES_F03)] },
    at: Date,
    note: String,
    by: ObjectId,
    byName: String,
    // NEO-L-05 (format f03): weight at discharge, morbidities, support days, death and transfer details
    details: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false, minimize: false },
);
const personRef = { type: new mongoose.Schema({ id: ObjectId, name: String }, { _id: false }), default: null };
const nicuSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    serial: { type: Number, required: true }, // hospital-wide, every admission
    format: { type: String, enum: ['f03'], default: undefined },
    registerYear: { type: Number, default: undefined },
    registerNo: { type: Number, default: undefined },
    unit: { type: String, required: true, maxlength: 30 }, // a unit key of the hospital (nicu | sncu in the DRAFT)
    source: { type: String, required: true, maxlength: 40 },
    admittedAt: { type: Date, required: true },
    reasons: { type: [{ type: String, enum: Object.keys(NICU_REASONS) }], default: [] }, // the DRAFT's reasons
    reasonNote: { type: String, maxlength: 500, default: '' },
    reasonPrimary: { type: String, enum: [...Object.keys(ADMISSION_REASONS), null], default: null },
    weightGrams: { type: Number, default: null },
    temperatureC: { type: Number, default: null },
    gestationWeeks: { type: Number, default: null },
    gestationDays: { type: Number, default: null },
    // Header (NEO-F-03)
    motherId: { type: ObjectId, ref: 'Patient', default: null },
    transferFromName: { type: String, maxlength: 150, default: '' },
    bedId: { type: ObjectId, ref: 'Bed', default: null },
    bedName: { type: String, maxlength: 100, default: '' },
    bedType: { type: String, enum: [...Object.keys(BED_KINDS), ''], default: '' },
    allergyAlert: { type: String, maxlength: 500, default: '' },
    consultant: personRef,
    admittingDoctor: personRef,
    // Below the unit's floor: the consultant's decision (admit here, or the transfer pathway)
    floorDecision: { type: new mongoose.Schema({ decision: { type: String, enum: ['admit_here', 'transfer'] }, consultantId: ObjectId, consultantName: String, note: String, at: Date }, { _id: false }), default: null },
    // Admitted at the desk by reception (9 Nov 2026): the header only; the clinical team completes the form
    desk: { type: new mongoose.Schema({ by: ObjectId, byName: String, at: Date }, { _id: false }), default: null },
    // N4: admitted to a full unit by the hospital admin's override
    fullOverride: { type: new mongoose.Schema({ reason: String, by: ObjectId, byName: String, at: Date }, { _id: false }), default: null },
    // §1–§3 and what follows the admission (counselling, consent, consultant review) – checked by routes/newbornCare.js
    maternal: { type: mongoose.Schema.Types.Mixed, default: null },
    maternalFrom: { type: mongoose.Schema.Types.Mixed, default: null }, // which field came from which record (PX-X-14)
    assessment: { type: mongoose.Schema.Types.Mixed, default: null },
    plan: { type: mongoose.Schema.Types.Mixed, default: null },
    followOn: { type: mongoose.Schema.Types.Mixed, default: null },
    signed: { type: new mongoose.Schema({ by: ObjectId, byName: String, role: String, at: Date }, { _id: false }), default: null },
    editedAt: { type: Date, default: null },
    editedByName: { type: String, default: null },
    automation: { type: new mongoose.Schema({ n1NotifiedAt: Date }, { _id: false }), default: null },
    ...stamp,
    outcome: { type: outcomeSchema, default: null },
    cancelled: cancel,
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true, minimize: false },
);
nicuSchema.plugin(tenantScoped);
nicuSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });
nicuSchema.index({ tenantId: 1, serial: 1 }, { unique: true });
nicuSchema.index({ tenantId: 1, unit: 1, registerYear: 1, registerNo: 1 }, { unique: true, partialFilterExpression: { registerNo: { $type: 'number' } } });
nicuSchema.index({ tenantId: 1, admittedAt: -1 });
nicuSchema.index({ tenantId: 1, patientId: 1, admittedAt: -1 });
nicuSchema.index({ tenantId: 1, bedId: 1 }, { partialFilterExpression: { bedId: { $type: 'objectId' } } });
// The register number and serial are given once and never changed (NEO-L-05 – not editable)
const FIXED = ['serial', 'registerNo', 'registerYear', 'unit'];
nicuSchema.pre('save', function () {
  if (!this.isNew && FIXED.some((k) => this.isModified(k))) throw new Error('The register number of a NICU admission cannot be changed');
});
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate']) {
  nicuSchema.pre(op, function () {
    const u = this.getUpdate() ?? {};
    if ([u, u.$set ?? {}, u.$unset ?? {}, u.$inc ?? {}].some((x) => FIXED.some((k) => k in x))) throw new Error('The register number of a NICU admission cannot be changed');
  });
}
export const NicuAdmission = mongoose.model('NicuAdmission', nicuSchema);

// The nurses on duty in a unit, as entered on the unit board (NEO-A-01: nurse:baby ≤ 1:2 for intensive beds). The
// latest entry counts; each one is kept.
const rosterSchema = new mongoose.Schema(
  {
    unit: { type: String, required: true, maxlength: 30 },
    nurses: { type: Number, required: true, min: 0, max: 50 },
    at: { type: Date, required: true },
    ...stamp,
  },
  { timestamps: false },
);
rosterSchema.plugin(tenantScoped);
rosterSchema.index({ tenantId: 1, unit: 1, at: -1 });
export const NicuRoster = mongoose.model('NicuRoster', rosterSchema);
