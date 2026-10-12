import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';
import { RISK_FACTORS, RISK_LEVELS, RISK_OPS } from '../careplans/risk.js';
import { CONDITIONS, PAST_COMPLICATIONS } from './Patient.js';
import { PREGNANCY_FINDINGS } from '../patients/pregnancyFindings.js';

export const ITEM_KINDS = ['visit', 'investigation', 'scan', 'vaccination', 'medication', 'advice'];
// Who an item is for. diabetes / hypertension: the pre-existing (chronic) condition only. gdm … bleeding: a
// finding ticked on the record for this pregnancy. diabetes_any / hypertension_any: either of the two.
// loss_…: pregnancy-loss care (the Abortion type of care), from the record's Pregnancy loss section – a molar
// pregnancy; an ectopic managed by waiting; an ectopic managed by waiting or with methotrexate; the recurrent-loss
// work-up (from the loss numbered RECURRENT_WORKUP_FROM_LOSSES, patients/abortionRules.js); an Rh-negative woman
// whose anti-D is not yet recorded as given or not needed; a loss cared for now (a miscarriage, an ectopic or a
// molar pregnancy – not a record that is only for the recurrent-loss work-up, where she is not pregnant now).
export const APPLIES_WHEN = [
  'always',
  'high_risk',
  'rh_negative',
  'previous_caesarean',
  'diabetes',
  'hypertension',
  'gdm',
  'pregnancy_hypertension',
  'multiple_pregnancy',
  'placenta_praevia',
  'bleeding',
  'diabetes_any',
  'hypertension_any',
  'loss_molar',
  'loss_ectopic_expectant',
  'loss_ectopic_hcg',
  'loss_recurrent',
  'loss_anti_d_due',
  'loss_now',
];
// New types go at the END (as in models/Patient.js CARE_TYPES).
export const TEMPLATE_CARE_TYPES = ['antenatal', 'postnatal', 'infertility', 'gynaecology', 'newborn', 'abortion'];

const itemSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 60 },
    kind: { type: String, enum: ITEM_KINDS, required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    patientText: { type: String, trim: true, maxlength: 300, default: '' },
    atBooking: { type: Boolean, default: false },
    // Antenatal: weeks of pregnancy (0–44, checked when saved); other types: weeks after delivery, birth or the
    // plan's start (up to 900 – the immunisation schedule runs to 16 years).
    fromWeek: { type: Number, min: 0, max: 900, default: null },
    toWeek: { type: Number, min: 0, max: 900, default: null },
    after: {
      key: { type: String, trim: true, maxlength: 60, default: null },
      weeks: { type: Number, min: 1, max: 520, default: null },
    },
    appliesWhen: { type: String, enum: APPLIES_WHEN, default: 'always' },
    source: { type: String, trim: true, maxlength: 400, default: '' },
  },
  { _id: false },
);

// A rule for the automatic risk level, e.g. "age over 35 → high", "diabetes → high" or "twins in this pregnancy → high".
const riskRuleSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 60 },
    label: { type: String, required: true, trim: true, maxlength: 150 },
    factor: { type: String, enum: Object.keys(RISK_FACTORS), required: true },
    op: { type: String, enum: [...RISK_OPS, null], default: null },
    value: { type: Number, default: null },
    condition: { type: String, enum: [...CONDITIONS, null], default: null },
    complication: { type: String, enum: [...PAST_COMPLICATIONS, null], default: null },
    finding: { type: String, enum: [...PREGNANCY_FINDINGS, null], default: null }, // a finding in this pregnancy
    level: { type: String, enum: RISK_LEVELS, required: true },
    source: { type: String, trim: true, maxlength: 400, default: '' },
  },
  { _id: false },
);

// One doctor's approval of exactly this content: the fingerprints of the items and risk rules they reviewed
// (careplans/hashes.js). A patient's plan counts as approved when a doctor approved the content it was built
// from – never just because the template's status says "approved".
const approvalSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    itemsHash: { type: String, required: true },
    rulesHash: { type: String, default: null }, // null: no risk rules (personal protocols)
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: null },
    at: { type: Date, default: null },
  },
  { _id: false },
);

// A care-plan template: the list of visits, tests, scans, vaccinations, medicines and advice for a type of
// care. Each hospital has its own "standard" template (starts as a draft that a doctor must approve), and
// doctors can keep their own "personal" protocols. Any change makes the template a draft again.
const templateSchema = new mongoose.Schema(
  {
    careType: { type: String, enum: TEMPLATE_CARE_TYPES, required: true },
    kind: { type: String, enum: ['standard', 'personal'], required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // for personal protocols
    ownerName: { type: String, default: null },
    basedOn: { type: mongoose.Schema.Types.ObjectId, ref: 'CarePlanTemplate', default: null },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    sources: { type: String, trim: true, maxlength: 1000, default: '' },
    items: { type: [itemSchema], default: [] },
    // Risk rules (antenatal). undefined = template created before risk rules existed (filled in on upgrade).
    riskRules: { type: [riskRuleSchema], default: undefined },
    // Which version of the built-in draft rules this template has (null once a doctor edits the rules).
    builtInRulesVersion: { type: Number, default: null },
    // Built-in items added to an existing standard template after it was created (e.g. 'newborn_tests'), so that
    // they are added once and not again after a doctor removes them.
    builtInAdditions: { type: [String], default: [] },
    status: { type: String, enum: ['draft', 'approved'], default: 'draft' },
    version: { type: Number, default: 1 },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedByName: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    approvedVersion: { type: Number, default: null },
    approvals: { type: [approvalSchema], default: [] }, // every approval ever given, oldest first
    updatedByName: { type: String, default: null },
    // A doctor's own protocol chosen as "my default" for its type of care: new care plans of the patients assigned
    // to that doctor start from it instead of the hospital standard – only while it is approved and the doctor
    // still works here as a doctor (careplans/defaultProtocol.js). At most one per doctor and type of care. Changing
    // or removing it never touches existing plans. Personal protocols only.
    ownerDefault: { type: Boolean, default: false },
  },
  // optimisticConcurrency: a save based on an out-of-date copy fails (409) instead of overwriting a change
  // or an approval saved at the same moment.
  { timestamps: true, optimisticConcurrency: true },
);
templateSchema.plugin(tenantScoped);
templateSchema.index({ tenantId: 1, careType: 1, kind: 1 });
templateSchema.index({ tenantId: 1, owner: 1 });
// Exactly one standard template per hospital and type of care.
templateSchema.index({ tenantId: 1, careType: 1 }, { unique: true, partialFilterExpression: { kind: 'standard' } });
// At most one default protocol per doctor and type of care (two clicks at the same moment: one wins).
templateSchema.index({ tenantId: 1, owner: 1, careType: 1 }, { unique: true, partialFilterExpression: { ownerDefault: true } });

templateSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const CarePlanTemplate = mongoose.model('CarePlanTemplate', templateSchema);
