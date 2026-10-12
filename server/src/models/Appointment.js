import mongoose from 'mongoose';
import { CANCEL_REASONS, VISIT_TYPES } from '../appointments/appointmentRules.js';
import { tenantScoped } from '../utils/tenantScope.js';

// An appointment with a doctor on a day (appointment booking, docs/APPOINTMENTS_PLAN.md). Two kinds:
//  - 'slot': a booked time ("10:30"); start is null while it still "needs a time" (a next visit the app could not
//    place, e.g. the doctor is on leave that day);
//  - 'token': a walk-in, numbered per doctor per day when reception marks her arrived.
// A quick booking (a new patient on the phone) has no patient yet – only a name and phone (guest) – until she is
// registered. Not clinical: no medical details, only the visit type (New, Follow-up, Scan, Other).
// Stored status is 'booked' or 'cancelled'; arrived, seen and "did not come" are worked out from the arrivals and
// visits of the day (appointmentService.js), so they can never disagree with the Today page.

const { ObjectId } = mongoose.Schema.Types;
const byWhom = { by: { type: ObjectId, ref: 'User' }, byName: String, at: Date };

const appointmentSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', default: null },
    guest: {
      type: new mongoose.Schema(
        { name: { type: String, trim: true, maxlength: 150, required: true }, phone: { type: String, trim: true, maxlength: 30, required: true } },
        { _id: false },
      ),
      default: null,
    },
    doctorId: { type: ObjectId, ref: 'User', required: true },
    on: { type: Date, required: true }, // the day (midnight UTC)
    kind: { type: String, enum: ['slot', 'token'], required: true },
    start: { type: String, default: null, match: /^([01]\d|2[0-3]):[0-5]\d$/ }, // slot only; null = needs a time
    // slot only: how long it takes, in minutes (a longer visit also takes the slots that follow its start)
    minutes: { type: Number, default: null, min: 10, max: 120 },
    token: { type: Number, default: null, min: 1 }, // token only
    visitType: { type: String, enum: VISIT_TYPES, default: 'follow_up' },
    status: { type: String, enum: ['booked', 'cancelled'], default: 'booked' },
    // Who made it: reception or a doctor on the Appointments page, the app from a visit's "next visit", a walk-in,
    // or the patient herself in the patient portal ('portal').
    source: { type: String, enum: ['booked', 'next_visit', 'walk_in', 'portal'], required: true },
    visitId: { type: ObjectId, ref: 'Visit', default: null }, // the visit whose "next visit" made it
    // Moved or given a time by hand: a later change of the visit's next-visit date leaves it alone.
    movedByHand: { type: Boolean, default: false },
    // Each change (booked, moved, cancelled) counts up: one message per change (reminders/messages.js).
    changes: { type: Number, default: 0 },
    // 'record_closed': cancelled by the app when the record was closed (patients/deathRules.js) – no message goes out.
    cancelled: {
      type: new mongoose.Schema({ reason: { type: String, enum: [...CANCEL_REASONS, 'next_visit_cleared', 'visit_cancelled', 'arrival_undone', 'record_closed'] }, ...byWhom }, { _id: false }),
      default: null,
    },
    // Moved here from a record that was marked as a duplicate of this patient's record (patients/duplicateService.js):
    // "Undo" there brings it back while it is still ahead. null for every other appointment.
    movedFromPatientId: { type: ObjectId, ref: 'Patient', default: null },
    created: { type: new mongoose.Schema(byWhom, { _id: false }), required: true },
    updated: { type: new mongoose.Schema(byWhom, { _id: false }), default: null },
  },
  { timestamps: true },
);
appointmentSchema.plugin(tenantScoped);
appointmentSchema.index({ tenantId: 1, on: 1, doctorId: 1 });
appointmentSchema.index({ tenantId: 1, patientId: 1, on: -1 });
appointmentSchema.index({ tenantId: 1, visitId: 1 });
// One token number per doctor per day.
appointmentSchema.index({ tenantId: 1, doctorId: 1, on: 1, token: 1 }, { unique: true, partialFilterExpression: { kind: 'token' } });

export const Appointment = mongoose.model('Appointment', appointmentSchema);
