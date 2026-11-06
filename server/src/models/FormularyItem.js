import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// One row of the hospital's formulary (Clinical Requirements Group A, item 7 – owner's decision 9, 5 Nov 2026: one
// formulary, verified once). The medicine safety list grows into it later. A dose is worked out only from a row
// that is VERIFIED: a doctor and the pharmacist have each confirmed this version of the row (who, when). Any change
// makes a new version and clears both confirmations, so an unverified row calculates nothing. Starts empty: the
// department leads and the pharmacist fill it in the app – Perinexa ships no doses.

export const POPULATIONS = ['adult', 'obstetric', 'paediatric', 'neonatal'];
export const DOSE_BASES = ['per_kg', 'fixed'];
const { ObjectId } = mongoose.Schema.Types;
const confirmation = new mongoose.Schema({ by: { type: ObjectId, ref: 'User', required: true }, byName: String, role: { type: String, enum: ['doctor', 'pharmacist'] }, at: Date, version: Number }, { _id: false });
const itemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 }, // generic name
    form: { type: String, trim: true, maxlength: 60, default: '' }, // injection, tablet …
    strength: { type: String, trim: true, maxlength: 80, default: '' }, // e.g. "40 mg in 0.4 mL"
    route: { type: String, trim: true, maxlength: 40, default: '' },
    population: { type: String, enum: POPULATIONS, required: true },
    indication: { type: String, trim: true, maxlength: 200, default: '' },
    doseBasis: { type: String, enum: DOSE_BASES, required: true },
    doseMg: { type: Number, required: true, min: 0 }, // mg per kg (per_kg) or mg (fixed) per dose
    frequency: { type: String, trim: true, maxlength: 80, default: '' },
    maxSingleMg: { type: Number, default: null, min: 0 },
    maxDailyMg: { type: Number, default: null, min: 0 },
    highAlert: { type: Boolean, default: false },
    notes: { type: String, trim: true, maxlength: 1000, default: '' },
    source: { type: String, trim: true, maxlength: 300, required: true }, // the manual page or reference it comes from
    version: { type: Number, default: 1 },
    confirmations: { type: [confirmation], default: [] },
    isActive: { type: Boolean, default: true },
    updatedByName: { type: String, required: true },
  },
  { timestamps: true, optimisticConcurrency: true },
);
itemSchema.plugin(tenantScoped);
itemSchema.index({ tenantId: 1, name: 1, population: 1, indication: 1 });

/** Verified: a doctor and the pharmacist confirmed THIS version. PURE. */
export function isVerified(item) {
  const now = (item.confirmations ?? []).filter((c) => c.version === item.version);
  return now.some((c) => c.role === 'doctor') && now.some((c) => c.role === 'pharmacist');
}

export const FormularyItem = mongoose.model('FormularyItem', itemSchema);
