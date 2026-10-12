import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A ready-made package of lab tests in the hospital's library, ordered together with one click (for example the
// newborn screening before going home, or the antenatal booking tests). Each hospital gets its own copy of the
// built-in DRAFT packages (lab/builtInPackages.js) and can add its own. A package stays a draft until a doctor
// approves it; any change makes it a draft again. Packages are never deleted – one not used is made inactive.

export const PACKAGE_WHO = ['newborn', 'adult']; // whose tests: a baby's, or an adult's (mostly the mother's)
export const MAX_PACKAGE_TESTS = 20;
export const MAX_DAY = 3650;

const packageSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 60 }, // built-in key, or pkg_ + 8 hex for the hospital's own
    origin: { type: String, enum: ['built_in', 'hospital'], required: true },
    builtInVersion: { type: Number, default: null }, // null once a person edits it (built-in updates then leave it alone)
    who: { type: String, enum: PACKAGE_WHO, required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    forWhom: { type: String, trim: true, maxlength: 300, default: '' }, // which patients ('' = every baby / everyone)
    about: { type: String, trim: true, maxlength: 1000, default: '' }, // notes for doctors (sources, what to check)
    // Babies: the days of life when the package fits (day of birth = 0); toDay null = any later day. Adults: null.
    fromDay: { type: Number, min: 0, max: MAX_DAY, default: null },
    toDay: { type: Number, min: 0, max: MAX_DAY, default: null },
    tests: {
      type: [String],
      validate: [(v) => Array.isArray(v) && v.length >= 1 && v.length <= MAX_PACKAGE_TESTS, `A package needs 1 to ${MAX_PACKAGE_TESTS} tests.`],
    },
    order: { type: Number, default: 1000 },
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
  { timestamps: true, optimisticConcurrency: true },
);
packageSchema.plugin(tenantScoped);
packageSchema.index({ tenantId: 1, key: 1 }, { unique: true });
packageSchema.index({ tenantId: 1, isActive: 1, order: 1 });

export const LabPackage = mongoose.model('LabPackage', packageSchema);
