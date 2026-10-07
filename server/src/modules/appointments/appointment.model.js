// An appointment with a doctor on a day (as in Perinexa). Two kinds:
//  - 'slot':  a booked time ("10:30"); start is null while it still "needs a time";
//  - 'token': a walk-in, numbered per doctor per day when reception marks her arrived.
// A quick booking (a new patient on the phone) has no patient yet – only a name and phone (guest) – until she is
// registered and linked. Not clinical: no medical details, only the visit type (config.opd.visitTypes).
// status: booked → arrived → seen, or cancelled. "Did not come" is worked out: a booked day that has passed.
import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';
import { CANCEL_REASON_KEYS, VISIT_TYPE_KEYS } from '../../config/index.js';

const { ObjectId } = mongoose.Schema.Types;

export const APPOINTMENT_STATUSES = ['booked', 'arrived', 'seen', 'cancelled'];

const appointmentSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', default: null },
    guest: {
      type: new mongoose.Schema(
        { name: { type: String, trim: true, maxlength: 120, required: true }, phone: { type: String, trim: true, maxlength: 20, required: true } },
        { _id: false },
      ),
      default: null,
    },
    doctorId: { type: ObjectId, ref: 'User', required: true },
    on: { type: Date, required: true }, // the day (midnight UTC)
    kind: { type: String, enum: ['slot', 'token'], required: true },
    start: { type: String, default: null, match: /^([01]\d|2[0-3]):[0-5]\d$/ }, // slot only; null = needs a time
    minutes: { type: Number, default: null, min: 5, max: 240 }, // slot only
    token: { type: Number, default: null, min: 1 }, // token only
    visitType: { type: String, enum: VISIT_TYPE_KEYS, default: VISIT_TYPE_KEYS[0] },
    status: { type: String, enum: APPOINTMENT_STATUSES, default: 'booked' },
    source: { type: String, enum: ['booked', 'walk_in'], required: true },
    arrivedAt: { type: Date, default: null },
    seenAt: { type: Date, default: null },
    cancelled: {
      type: new mongoose.Schema(
        { reason: { type: String, enum: CANCEL_REASON_KEYS }, note: { type: String, trim: true, maxlength: 200, default: '' }, by: { type: ObjectId, ref: 'User' }, at: Date },
        { _id: false },
      ),
      default: null,
    },
    reminderSentAt: { type: Date, default: null },
    createdBy: { type: ObjectId, ref: 'User', required: true },
    updatedBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
appointmentSchema.plugin(hospitalScoped);
appointmentSchema.index({ hospitalId: 1, on: 1, doctorId: 1 });
appointmentSchema.index({ hospitalId: 1, patientId: 1, on: -1 });
appointmentSchema.index({ hospitalId: 1, kind: 1, status: 1, start: 1, on: 1 });
// One token number per doctor per day.
appointmentSchema.index({ hospitalId: 1, doctorId: 1, on: 1, token: 1 }, { unique: true, partialFilterExpression: { kind: 'token' } });

export const Appointment = mongoose.model('Appointment', appointmentSchema, 'appointments');
