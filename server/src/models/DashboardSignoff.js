import mongoose from 'mongoose';
import { DEPARTMENTS } from '../clinical/dashboards.js';
import { tenantScoped } from '../utils/tenantScope.js';

// The monthly dashboards' targets and the lead's sign-off (Clinical Requirements Group B, item 17).
// DashboardTarget: a hospital's own target for one row (set by a doctor or the quality lead; who, when).
// DashboardSignoff: one department's month signed off by a doctor (the department lead – privileges come with the base
// rules, Group C), with a comment and the rows as they were then (a snapshot). Never changed or deleted.

const { ObjectId } = mongoose.Schema.Types;
const targetSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, maxlength: 40 },
    target: { type: Number, default: null },
    setBy: { type: ObjectId, ref: 'User' },
    setByName: String,
  },
  { timestamps: true },
);
targetSchema.plugin(tenantScoped);
targetSchema.index({ tenantId: 1, key: 1 }, { unique: true });
export const DashboardTarget = mongoose.model('DashboardTarget', targetSchema);

const signoffSchema = new mongoose.Schema(
  {
    department: { type: String, enum: Object.keys(DEPARTMENTS), required: true },
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    rows: { type: [mongoose.Schema.Types.Mixed], default: [] }, // the rows as signed off
    comment: { type: String, maxlength: 2000, default: '' },
    by: { type: ObjectId, ref: 'User', required: true },
    byName: { type: String, required: true },
    at: { type: Date, required: true },
  },
  { timestamps: true },
);
signoffSchema.plugin(tenantScoped);
signoffSchema.index({ tenantId: 1, department: 1, month: 1 }, { unique: true });
export const DashboardSignoff = mongoose.model('DashboardSignoff', signoffSchema);
