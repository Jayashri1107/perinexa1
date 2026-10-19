import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A doctor's OPD timings in one hospital (appointment booking): the sessions of each day of the week (hospital
// clock, "HH:MM") and the days on leave. Set by the doctor (or the hospital admin). One per doctor per hospital.

const sessionSchema = new mongoose.Schema(
  {
    from: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    to: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  },
  { _id: false },
);

const scheduleSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Seven entries at most, one per day (0 = Sunday … 6 = Saturday); a day with no sessions is a day off.
    week: [
      new mongoose.Schema(
        { day: { type: Number, min: 0, max: 6, required: true }, sessions: { type: [sessionSchema], default: [] } },
        { _id: false },
      ),
    ],
    // Minutes a visit of each type takes with this doctor (whole slots; a type not set takes one slot).
    lengths: {
      type: new mongoose.Schema({ new: Number, follow_up: Number, scan: Number, other: Number }, { _id: false }),
      default: null,
    },
    // Days on leave (both inclusive, date-only at midnight UTC).
    leave: [
      new mongoose.Schema(
        { from: { type: Date, required: true }, to: { type: Date, required: true }, note: { type: String, trim: true, maxlength: 100, default: '' } },
        { _id: false },
      ),
    ],
    // Slots kept for walk-in patients (owner, 17 Oct 2026 – docs/RECEPTION_V2_PLAN.md): the last N slots of each session
    // are not offered for online booking (the patient portal); reception and doctors still book them.
    // Slots kept for walk-ins (owner, 19 Oct 2026 – appointments/slots.js walkInStarts): after every `walkInEvery`
    // slots open online, the next `walkInKeep` are kept for walk-ins, through the day. 0 kept: none.
    walkInEvery: { type: Number, min: 1, max: 20, default: 5 },
    walkInKeep: { type: Number, min: 0, max: 10, default: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedByName: { type: String, default: '' },
  },
  { timestamps: true },
);
scheduleSchema.plugin(tenantScoped);
scheduleSchema.index({ tenantId: 1, doctorId: 1 }, { unique: true });

export const OpdSchedule = mongoose.model('OpdSchedule', scheduleSchema);
