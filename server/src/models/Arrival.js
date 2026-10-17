import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A patient arrived at the hospital on a day (Feature 10, daily lists): marked by reception (or a nurse, doctor or
// RMO) on the Today page – before any visit is started. One per patient per day; undone by deleting it the same day.
// Not clinical: only the time and who marked it.

const arrivalSchema = new mongoose.Schema(
  {
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
    on: { type: Date, required: true }, // the hospital's day (midnight UTC)
    at: { type: Date, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    byName: { type: String, required: true, maxlength: 150 },
    // The OPD number of this visit (OP-2026-000001, per hospital and year – docs/ADMISSION_DESK_PLAN.md), printed on the
    // OPD case paper. Not set on older arrivals.
    opdNo: { type: String, default: null },
  },
  { timestamps: false },
);
arrivalSchema.plugin(tenantScoped);
arrivalSchema.index({ tenantId: 1, patientId: 1, on: 1 }, { unique: true });
arrivalSchema.index({ tenantId: 1, on: 1 });

export const Arrival = mongoose.model('Arrival', arrivalSchema);
