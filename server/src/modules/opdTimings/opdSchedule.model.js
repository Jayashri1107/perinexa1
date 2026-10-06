// A doctor's OPD timings in one hospital: the sessions of each day of the week ("HH:MM", hospital clock), how long each
// type of visit takes, and the days on leave. One per doctor per hospital. Used by appointment booking (a later module).
import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';
import { VISIT_TYPE_KEYS } from '../../config/index.js';

const { ObjectId } = mongoose.Schema.Types;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const sessionSchema = new mongoose.Schema(
  { from: { type: String, required: true, match: TIME }, to: { type: String, required: true, match: TIME } },
  { _id: false },
);

const daySchema = new mongoose.Schema(
  { day: { type: Number, min: 0, max: 6, required: true }, sessions: { type: [sessionSchema], default: [] } },
  { _id: false },
);

const leaveSchema = new mongoose.Schema(
  {
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    note: { type: String, trim: true, maxlength: 100, default: '' },
  },
  { _id: false },
);

const opdScheduleSchema = new mongoose.Schema(
  {
    doctorId: { type: ObjectId, ref: 'User', required: true, immutable: true },
    week: { type: [daySchema], default: [] },
    // minutes per visit type (keys from config.opd.visitTypes)
    lengths: new mongoose.Schema(Object.fromEntries(VISIT_TYPE_KEYS.map((k) => [k, { type: Number, min: 1 }])), { _id: false }),
    leave: { type: [leaveSchema], default: [] },
    updatedBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
opdScheduleSchema.plugin(hospitalScoped);
opdScheduleSchema.index({ hospitalId: 1, doctorId: 1 }, { unique: true });

export const OpdSchedule = mongoose.model('OpdSchedule', opdScheduleSchema, 'opd_schedules');
