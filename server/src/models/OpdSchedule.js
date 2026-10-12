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
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedByName: { type: String, default: '' },
  },
  { timestamps: true },
);
scheduleSchema.plugin(tenantScoped);
scheduleSchema.index({ tenantId: 1, doctorId: 1 }, { unique: true });

export const OpdSchedule = mongoose.model('OpdSchedule', scheduleSchema);
