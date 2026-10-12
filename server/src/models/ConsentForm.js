import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';
import { CARE_TYPES } from './Patient.js';

// A consent form in the hospital's library, printed for patients in English with Marathi or Hindi next to it,
// clause by clause. Each hospital gets its own copy of the built-in DRAFT forms (consents/builtInForms.js) and
// can add its own. The wording must come from the hospital and be legally reviewed: a form stays a draft
// ("DRAFT" on every printed page) until a doctor approves it, and any change makes it a draft again.
// Forms are never deleted – a form the hospital doesn't use is made inactive.

// When the patient's Consent forms tab suggests the form (consents/suggest.js).
// From 'blood_pressure' on, for information forms: a condition the record shows (a ticked condition, the latest
// visit's red flags, a lab result, the blood group, BMI or age, problems in earlier pregnancies).
export const SUGGEST_RULES = [
  'none',
  'always',
  'high_risk',
  'previous_caesarean',
  'scan_due',
  'hiv_test_due',
  'from_37_weeks',
  'from_40_weeks',
  'blood_pressure',
  'diabetes',
  'thyroid',
  'anaemia',
  'rh_negative',
  'not_head_down',
  'bad_obstetric_history',
  'reduced_movements',
  'heart_disease',
  'epilepsy',
  'hepatitis_b',
  'obesity',
  'age_35_plus',
];
// consent: the patient agrees to a procedure. information: the doctor records that the patient and her relatives
// were told about a condition or complication (e.g. PIH, GDM) and its risks – they sign that they were informed.
export const FORM_KINDS = ['consent', 'information'];

const text = (max, required = false) => ({ type: String, trim: true, maxlength: max, default: '', ...(required ? { required: true } : {}) });
// The same words in English (always), Marathi and Hindi.
const inLanguages = (max) => new mongoose.Schema({ en: text(max, true), mr: text(max), hi: text(max) }, { _id: false });

const formSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 60 }, // built-in key, or form_ + 8 hex for the hospital's own
    origin: { type: String, enum: ['built_in', 'hospital'], required: true },
    kind: { type: String, enum: FORM_KINDS, default: 'consent' },
    // Which built-in wording this copy has; null once a person edits it (built-in updates then leave it alone).
    builtInVersion: { type: Number, default: null },
    title: { type: inLanguages(150), required: true },
    description: text(1000), // notes for staff: when to use it, what to check (not printed)
    careTypes: { type: [{ type: String, enum: CARE_TYPES }], default: [] }, // empty = every type of care
    suggestWhen: { type: String, enum: SUGGEST_RULES, default: 'none' },
    clauses: {
      type: [inLanguages(2000)],
      validate: [(v) => Array.isArray(v) && v.length >= 1 && v.length <= 40, 'A form needs 1 to 40 clauses.'],
    },
    order: { type: Number, default: 1000 }, // place in lists (built-in forms in the order of care)
    isActive: { type: Boolean, default: true },
    status: { type: String, enum: ['draft', 'approved'], default: 'draft' },
    version: { type: Number, default: 1 },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedByName: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    approvedVersion: { type: Number, default: null },
    updatedByName: { type: String, default: null },
  },
  // optimisticConcurrency: a save from an out-of-date copy fails instead of overwriting a newer change.
  { timestamps: true, optimisticConcurrency: true },
);
formSchema.plugin(tenantScoped);
formSchema.index({ tenantId: 1, key: 1 }, { unique: true });
formSchema.index({ tenantId: 1, isActive: 1, order: 1 });
formSchema.index({ tenantId: 1, kind: 1 });

formSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.approvedBy;
    return ret;
  },
});

export const ConsentForm = mongoose.model('ConsentForm', formSchema);
