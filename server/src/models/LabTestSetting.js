import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// The hospital's test list (lab module, docs/LAB_LIMS_PLAN.md feature 2): one document per test the hospital has
// changed or added.
//  - A built-in test (lab/labTests.js) gets one only when the hospital changes it: its department, turnaround times,
//    usual outside lab, whether it is offered, and its usual ranges (`fieldRanges`: other limits, and ranges for a
//    group of patients – lab/labSetup.js rangeFor).
//  - The hospital's own test (custom, key h_ + 8 hex) holds its whole definition (name, sample, fields).
// Changing a field or a range is clinical: it makes a new DRAFT version that only a doctor approves. Department,
// times, outside lab and "offered" are not clinical and keep the status. Never deleted: a test not used is not offered.

const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 40 },
    custom: { type: Boolean, default: false },
    // The hospital's own test only (a built-in test keeps its own name, sample, group and fields):
    name: { type: String, trim: true, maxlength: 150, default: '' },
    group: { type: String, trim: true, maxlength: 40, default: '' },
    sample: { type: String, trim: true, maxlength: 150, default: '' },
    who: { type: String, enum: ['adult', 'newborn'], default: 'adult' },
    fields: { type: [mongoose.Schema.Types.Mixed], default: [] }, // as lab/labTests.js fields, with `bands`
    // A built-in test only: { [fieldKey]: { low, high, range, bands } } – what the hospital changed
    fieldRanges: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Any test (not clinical):
    department: { type: String, trim: true, maxlength: 40, default: '' }, // '' = the built-in department
    tatHours: { type: Number, min: 1, max: 2000, default: null }, // null = the department's usual time
    urgentTatHours: { type: Number, min: 1, max: 2000, default: null },
    outsideLab: { type: String, trim: true, maxlength: 120, default: '' }, // usually sent to (shown when sending)
    active: { type: Boolean, default: true }, // offered when ordering
    // How it prints (docs/LAB_TEMPLATES_PLAN.md): { template, method, notes, ownPage } – what the hospital changed over
    // the built-in ones (lab/labSetup.js reportOf). The method and notes are clinical wording (a change makes a DRAFT).
    report: { type: mongoose.Schema.Types.Mixed, default: null },
    antibiotics: { type: [String], default: undefined }, // the culture template's sensitivity panel (none = built-in)
    // The clinical part (fields and ranges): DRAFT until a doctor approves this version
    status: { type: String, enum: ['draft', 'approved'], default: 'draft' },
    version: { type: Number, default: 1 },
    approvedVersion: { type: Number, default: null },
    approvedByName: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    updatedByName: { type: String, default: null },
  },
  { timestamps: true, minimize: false },
);
settingSchema.plugin(tenantScoped);
settingSchema.index({ tenantId: 1, key: 1 }, { unique: true });

export const LabTestSetting = mongoose.model('LabTestSetting', settingSchema);
