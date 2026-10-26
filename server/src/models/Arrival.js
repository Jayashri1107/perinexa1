import mongoose from 'mongoose';
import { PURPOSE_NOTE_MAX, VISIT_PURPOSES } from '../appointments/visitPurpose.js';
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
    // The live queue (26 Oct 2026): an emergency goes first in her doctor's waiting list (reception, nurses, doctors,
    // RMOs mark it; not a diagnosis – only that she is seen first); "left" is reception's "Done – she left" for a
    // patient who goes without a signed visit. Who and when only.
    emergency: { type: new mongoose.Schema({ at: Date, by: mongoose.Schema.Types.ObjectId, byName: String }, { _id: false }), default: null },
    left: { type: new mongoose.Schema({ at: Date, by: mongoose.Schema.Types.ObjectId, byName: String }, { _id: false }), default: null },
    // Why she came (26 Oct 2026): a fixed purpose and a short note, marked at check-in (from her follow-up when she
    // has one) – told to her doctor; never a medical detail (reception marks and sees it)
    purpose: { type: new mongoose.Schema({ kind: { type: String, enum: VISIT_PURPOSES }, note: { type: String, maxlength: PURPOSE_NOTE_MAX, default: '' } }, { _id: false }), default: null },
  },
  { timestamps: false },
);
arrivalSchema.plugin(tenantScoped);
arrivalSchema.index({ tenantId: 1, patientId: 1, on: 1 }, { unique: true });
arrivalSchema.index({ tenantId: 1, on: 1 });

export const Arrival = mongoose.model('Arrival', arrivalSchema);
