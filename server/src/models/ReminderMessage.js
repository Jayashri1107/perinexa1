import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';
import { CHANGE_KINDS, CHANNELS, REMINDER_LANGUAGES } from '../reminders/messages.js';
import { GENERAL_KINDS } from '../reminders/reminderRules.js';

// The reminder outbox (Version 2): one message per patient, kind and appointment day. Queued the day before the
// appointment for patients who agreed to reminders – and, with appointment booking, when an appointment is booked,
// moved or cancelled (kind booked / moved / cancelled; ref = "<appointment id>:<change number>", so each change
// is its own message); sent by the provider, or – without one – left for staff to
// send by hand ("to send"). Kept as a record of what was sent (text, number, when, result); never deleted.
//
// Since 4 Oct 2026 also the two general messages (reminders/generalReminders.js):
//  - 'care_due': a care-plan item is overdue and nothing is booked ("A check-up or test is due …");
//  - 'missed':   a booked appointment passed and nobody came ("we missed you …"; ref = the appointment's id, so
//                each appointment gets one at most; aboutOn = the day of that appointment).
// For these two, dueOn is the LAST day the message may still go out (it waits a few days to be sent by hand); a
// 'missed' message is once per appointment AND day (ref + aboutOn), so an appointment moved to a new day counts anew.

const { ObjectId } = mongoose.Schema.Types;
const messageSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    kind: { type: String, enum: ['appointment', ...CHANGE_KINDS, ...GENERAL_KINDS], required: true },
    ref: { type: String, default: '', maxlength: 60 },
    dueOn: { type: Date, required: true }, // the appointment day (hospital date, midnight UTC); general kinds: the last day to send
    sendOn: { type: Date, required: true }, // the day it goes out (the day before)
    aboutOn: { type: Date, default: null }, // 'missed' only: the day of the appointment nobody came to
    channel: { type: String, enum: CHANNELS, required: true },
    language: { type: String, enum: REMINDER_LANGUAGES, required: true },
    to: { type: String, required: true, maxlength: 20 },
    text: { type: String, required: true, maxlength: 500 },
    status: { type: String, enum: ['queued', 'sent', 'failed', 'to_send', 'sent_by_hand', 'cancelled'], default: 'queued' },
    attempts: { type: Number, default: 0 },
    // When a round took this message to send it (reminderService.js): a second round at the same moment leaves it
    // alone, so it is never sent twice. Cleared when the attempt failed; a mark older than a few minutes (a round
    // that was cut off) no longer counts.
    claimedAt: { type: Date, default: null },
    providerId: { type: String, default: '' },
    error: { type: String, default: '' },
    sentAt: { type: Date, default: null },
    handled: { type: new mongoose.Schema({ by: ObjectId, byName: String, at: Date }, { _id: false }), default: null },
  },
  { timestamps: true },
);
messageSchema.plugin(tenantScoped);
messageSchema.index({ tenantId: 1, patientId: 1, kind: 1, dueOn: 1, ref: 1 }, { unique: true });
messageSchema.index({ tenantId: 1, status: 1, sendOn: 1 });

export const ReminderMessage = mongoose.model('ReminderMessage', messageSchema);
