import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';
import { DOSE_UNITS, MED_SAFETY_KINDS, MED_SAFETY_LEVELS } from '../medsafety/medicineSafety.js';

const entrySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 60 },
    kind: { type: String, enum: MED_SAFETY_KINDS, required: true },
    label: { type: String, required: true, trim: true, maxlength: 120 },
    terms: { type: [String], default: [] }, // names that identify the medicine (lower case)
    otherTerms: { type: [String], default: [] }, // combination: the other medicine
    level: { type: String, enum: MED_SAFETY_LEVELS, required: true },
    fromWeek: { type: Number, default: null }, // weeks of pregnancy (kind 'medicine')
    toWeek: { type: Number, default: null },
    // kind 'newborn', and a per-kg dose limit: only up to this age in days (null: any age in newborn care)
    maxAgeDays: { type: Number, default: null },
    // kind 'dose': the usual maximum of one dose and of a whole day, in doseUnit (per kg of body weight when perKg –
    // newborn-care patients only; otherwise adults)
    doseUnit: { type: String, enum: [...DOSE_UNITS, ''], default: '' },
    maxSingle: { type: Number, default: null },
    maxDaily: { type: Number, default: null },
    perKg: { type: Boolean, default: false },
    message: { type: String, trim: true, maxlength: 500, default: '' },
    source: { type: String, trim: true, maxlength: 400, default: '' },
  },
  { _id: false },
);

// The hospital's medicine safety list (one per hospital). Starts as the built-in draft; any change makes it a
// draft again (new version) that a doctor must approve.
const listSchema = new mongoose.Schema(
  {
    set: { type: String, enum: ['standard'], default: 'standard' },
    entries: { type: [entrySchema], default: [] },
    builtInVersion: { type: Number, default: null }, // the built-in version, while no doctor has changed the list
    // The built-in version this list was made from or last offered (kept when a doctor changes the list): entries
    // added to the built-in list after it are offered to the doctor, never added by themselves.
    builtInSeenVersion: { type: Number, default: null },
    status: { type: String, enum: ['draft', 'approved'], default: 'draft' },
    version: { type: Number, default: 1 },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedByName: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    updatedByName: { type: String, default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);
listSchema.plugin(tenantScoped);
listSchema.index({ tenantId: 1, set: 1 }, { unique: true });

listSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const MedicineSafetyList = mongoose.model('MedicineSafetyList', listSchema);
