import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A doctor or centre that refers patients to the lab (Lab version 2 – docs/LAB_V2_PLAN.md). Recorded on walk-in orders
// and printed on the report. No money is ever recorded for a referrer: commissions are not allowed. Never deleted – one
// no longer used is made inactive.
const referrerSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['doctor', 'centre'], required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    qualification: { type: String, trim: true, maxlength: 80, default: '' },
    registrationNumber: { type: String, trim: true, maxlength: 40, default: '' },
    phone: { type: String, trim: true, maxlength: 20, default: '' },
    address: { type: String, trim: true, maxlength: 200, default: '' },
    active: { type: Boolean, default: true },
    updatedByName: { type: String, default: '' },
  },
  { timestamps: true },
);
referrerSchema.plugin(tenantScoped);
referrerSchema.index({ tenantId: 1, active: 1, name: 1 });

export const Referrer = mongoose.model('Referrer', referrerSchema);
