import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';
import { CARE_TYPES } from './Patient.js';
import { rxItemSchema } from './Visit.js';

// A ready-made prescription set in the hospital's library (Feature 8b): the medicines with their doses, general
// instructions, tests advised and advice for a common situation (for example the first trimester, or PCOS). On
// the Prescription tab a doctor adds a set with one click and changes it before saving – it is only a starting
// point, and the saved prescription is the doctor's own. Each hospital gets its own copy of the built-in DRAFT
// sets (visits/builtInSets.js) and can add its own. A set stays a draft until a doctor has checked every medicine
// and dose and approves it; any change makes it a draft again. Sets are never deleted – one the hospital doesn't
// use is made inactive.

const text = (max) => ({ type: String, trim: true, maxlength: max, default: '' });

export const MAX_SET_ITEMS = 20;

const setSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 60 }, // built-in key, or set_ + 8 hex for the hospital's own
    origin: { type: String, enum: ['built_in', 'hospital'], required: true },
    // Which built-in content this copy has; null once a person edits it (built-in updates then leave it alone).
    builtInVersion: { type: Number, default: null },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    about: text(1000), // notes for doctors: when to use it, sources, what to check (never printed)
    careTypes: { type: [{ type: String, enum: CARE_TYPES }], default: [] }, // empty = every type of care
    items: {
      type: [rxItemSchema],
      validate: [(v) => Array.isArray(v) && v.length <= MAX_SET_ITEMS, `A set can have at most ${MAX_SET_ITEMS} medicines.`],
    },
    notes: text(1000), // general instructions, printed under the medicines
    investigations: text(1000), // tests advised (added to the visit's notes)
    advice: text(2000), // advice for the patient (added to the visit's notes)
    order: { type: Number, default: 1000 }, // place in lists (built-in sets in the order of care)
    isActive: { type: Boolean, default: true },
    status: { type: String, enum: ['draft', 'approved'], default: 'draft' },
    version: { type: Number, default: 1 },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedByName: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    approvedVersion: { type: Number, default: null },
    createdByName: { type: String, default: null },
    updatedByName: { type: String, default: null },
  },
  // optimisticConcurrency: a save from an out-of-date copy fails instead of overwriting a newer change.
  { timestamps: true, optimisticConcurrency: true },
);
setSchema.plugin(tenantScoped);
setSchema.index({ tenantId: 1, key: 1 }, { unique: true });
setSchema.index({ tenantId: 1, isActive: 1, order: 1 });

export const PrescriptionSet = mongoose.model('PrescriptionSet', setSchema);
