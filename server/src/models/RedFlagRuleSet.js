import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';
import { DEFAULT_APPLIES_TO, NUMBER_OPS, RED_FLAG_CARE_TYPES, RED_FLAG_FACTORS, RED_FLAG_LEVELS } from '../redflags/redFlags.js';

const conditionSchema = new mongoose.Schema(
  {
    factor: { type: String, enum: Object.keys(RED_FLAG_FACTORS), required: true },
    op: { type: String, enum: [...NUMBER_OPS, null], default: null }, // number factors
    value: { type: Number, default: null },
    grade: { type: String, default: null }, // grade factors: the lowest grade that raises the flag
    choices: { type: [String], default: undefined }, // choice factors
  },
  { _id: false },
);

const ruleSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 60 },
    label: { type: String, required: true, trim: true, maxlength: 120 },
    level: { type: String, enum: RED_FLAG_LEVELS, required: true },
    message: { type: String, trim: true, maxlength: 500, default: '' }, // what the doctor should consider doing
    // The types of care the rule applies to. A rule saved before rules had this (4 Oct 2026) is for pregnancy care.
    appliesTo: { type: [{ type: String, enum: RED_FLAG_CARE_TYPES }], default: () => [...DEFAULT_APPLIES_TO] },
    conditions: { type: [conditionSchema], default: [] }, // ALL must hold
    fromWeek: { type: Number, default: null }, // weeks of pregnancy (antenatal patients only)
    toWeek: { type: Number, default: null },
    fromDay: { type: Number, default: null }, // a baby's age in whole days when the value was taken (newborn patients only)
    toDay: { type: Number, default: null },
    source: { type: String, trim: true, maxlength: 400, default: '' },
  },
  { _id: false },
);

// The hospital's red-flag rules (one set per hospital). Starts as the built-in draft; any change makes it a
// draft again (new version) that a doctor must approve – like the care-plan templates.
const ruleSetSchema = new mongoose.Schema(
  {
    set: { type: String, enum: ['standard'], default: 'standard' }, // one set per hospital (see the unique index)
    rules: { type: [ruleSchema], default: [] },
    builtInVersion: { type: Number, default: null }, // null once a doctor has edited the rules
    // The built-in version these rules were made from or last offered: later built-in rules are offered to a
    // doctor to add as a draft (never added by themselves). Not recorded before 4 Oct 2026: version 1.
    builtInSeenVersion: { type: Number, default: null },
    // The codes of built-in rules a doctor added to the hospital's own rules ("Add them as a draft") that no doctor
    // has approved since: shown as "New built-in draft" on the rules page. Emptied when the rules are approved.
    builtInAdded: { type: [String], default: [] },
    status: { type: String, enum: ['draft', 'approved'], default: 'draft' },
    version: { type: Number, default: 1 },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedByName: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    updatedByName: { type: String, default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);
ruleSetSchema.plugin(tenantScoped);
ruleSetSchema.index({ tenantId: 1, set: 1 }, { unique: true });

ruleSetSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const RedFlagRuleSet = mongoose.model('RedFlagRuleSet', ruleSetSchema);
