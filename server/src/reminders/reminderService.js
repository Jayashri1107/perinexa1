import { config } from '../config.js';
import { addDays, hospitalToday } from '../careplans/dates.js';
import { Appointment } from '../models/Appointment.js';
import { Patient } from '../models/Patient.js';
import { ReminderMessage } from '../models/ReminderMessage.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { cancelStaleGeneral, queueCareDue, queueMissedAppointments } from './generalReminders.js';
import { appointmentMessage } from './messages.js';
import { mobileNumber } from './phone.js';
import { GENERAL_KINDS } from './reminderRules.js';
import { DUPLICATE_MESSAGE_REASON, isDuplicate } from '../patients/duplicateRules.js';
import { CLOSED_MESSAGE_REASON, IN_USE, isClosed } from '../patients/deathRules.js';
import { currentSender } from './sender.js';

export { mobileNumber };

// Automatic appointment reminders (Version 2). Once an hour (server/src/index.js), for every hospital that switched
// reminders on: from REMINDER_SEND_HOUR (hospital time) the next day's appointments are queued – only for patients
// who agreed to reminders and have a mobile number – and the queued messages are sent through the provider. With
// no provider they wait as "to send" for staff to send by hand. An appointment is a booked time slot (appointment
// booking: the message gives the time and the doctor), or the "next visit" date of the patient's latest visit when
// it made no appointment (as on the calendar). Messages about a booking, a move or a cancellation are queued when
// they happen (appointments/appointmentService.js) and sent here too. A failed message is tried 3 times. Nothing is
// written to the log.
// Since 4 Oct 2026 the round also queues the two general messages (generalReminders.js): "a check-up or test is
// due" when a care-plan item is overdue and nothing is booked, and "we missed you" the day after a booked
// appointment nobody came to – under the same two switches (the hospital's, and the patient's own agreement).
// Those two go out only between REMINDER_SEND_HOUR and REMINDER_LAST_HOUR (hospital time): they are not tied to a
// day, so one that became due in the evening waits for the morning.
// A record marked as a duplicate of another gets no automatic message: none is queued for it, and one still waiting
// is cancelled instead of sent (her appointments are on the main record, which has its own agreement). The same for a
// record closed after a death (patients/deathRules.js): no message of any kind.
// A message is taken ("claimed") by one round before it is sent, so two rounds at the same moment – the hourly one
// and a doctor's "Send due reminders now" – never send it twice.

const MAX_ATTEMPTS = 3;
// A round that was cut off while sending leaves its mark on the message; after this long another round may take it.
const CLAIM_MINUTES = 10;

/** The hour (0–23) in the hospital's time zone. */
export function hospitalHour(now = new Date(), timeZone = config.HOSPITAL_TIME_ZONE) {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now);
  return Number(h);
}

/** Queues tomorrow's appointment reminders of one hospital. Returns how many were added. */
export async function queueAppointmentReminders(tenant, now = new Date()) {
  const tenantId = tenant._id;
  const today = hospitalToday(now);
  const tomorrow = addDays(today, 1);
  // Booked time slots tomorrow (the earliest one per patient), with the doctor
  const appts = await Appointment.find({ tenantId, on: tomorrow, kind: 'slot', status: 'booked', patientId: { $ne: null } }, { patientId: 1, doctorId: 1, start: 1 }).sort({ start: 1 }).lean();
  const when = new Map(); // patientId -> { time, doctorId }
  for (const a of appts) if (!when.has(String(a.patientId))) when.set(String(a.patientId), { time: a.start, doctorId: a.doctorId });
  // Next visits tomorrow that made no appointment (from before appointment booking)
  const booked = await Visit.find({ tenantId, status: 'active', 'details.nextVisitOn': tomorrow }, { patientId: 1 }).lean();
  const linked = booked.length ? new Set((await Appointment.find({ tenantId, visitId: { $in: booked.map((v) => v._id) } }, { visitId: 1 }).lean()).map((a) => String(a.visitId))) : new Set();
  const fromVisits = booked.filter((v) => !linked.has(String(v._id)) && !when.has(String(v.patientId)));
  const ids = [...new Set([...when.keys(), ...fromVisits.map((v) => String(v.patientId))])];
  if (!ids.length) return 0;
  const patients = await Patient.find({ tenantId, _id: { $in: ids }, 'reminders.consent': true, ...IN_USE }, { phone: 1, reminders: 1 }).lean();
  const doctorIds = [...new Set([...when.values()].map((w) => String(w.doctorId)))];
  const doctors = new Map((doctorIds.length ? await User.find({ _id: { $in: doctorIds } }, { name: 1 }).lean() : []).map((u) => [String(u._id), u.name]));
  const hospital = tenant.letterhead?.name || tenant.name;
  const phone = tenant.letterhead?.phone ?? '';
  let added = 0;
  for (const p of patients) {
    const slot = when.get(String(p._id));
    if (!slot) {
      // The booking counts only if it is from her latest visit (a later visit replaces it, as on the calendar)
      const latest = await Visit.findOne({ tenantId, patientId: p._id, status: 'active' }, { details: 1 }).sort({ visitOn: -1, createdAt: -1 }).lean();
      if (!latest?.details?.nextVisitOn || latest.details.nextVisitOn.getTime() !== tomorrow.getTime()) continue;
    }
    const to = mobileNumber(p.phone);
    if (!to) continue;
    const language = p.reminders.language ?? 'en';
    const text = appointmentMessage({ hospital, phone, day: tomorrow, time: slot?.time ?? null, doctor: slot ? (doctors.get(String(slot.doctorId)) ?? null) : null, lang: language });
    const r = await ReminderMessage.updateOne(
      { tenantId, patientId: p._id, kind: 'appointment', dueOn: tomorrow, ref: { $in: ['', null] } }, // older messages have no ref
      { $setOnInsert: { tenantId, patientId: p._id, kind: 'appointment', dueOn: tomorrow, ref: '', sendOn: today, channel: p.reminders.channel ?? 'sms', language, to, text } },
      { upsert: true },
    );
    if (r.upsertedCount) added += 1;
  }
  return added;
}

/**
 * Sends one hospital's due messages now, without waiting for the hourly round (a booking, a move or a cancellation –
 * docs/WHATSAPP_DESK_PLAN.md). Never fails the caller: a failure stays on the message for the next round.
 */
export function sendSoon(tenantId, now = new Date()) {
  return (async () => {
    const tenant = await Tenant.findById(tenantId);
    if (!tenant?.messaging?.remindersEnabled || !currentSender()) return null;
    return sendDueReminders(tenant, now, { withGeneral: false });
  })().catch((err) => {
    console.error('Reminders: sending a change at once failed', err?.message ?? err);
    return null;
  });
}

/**
 * Sends one hospital's queued messages that are due. Returns { sent, failed, toSend }.
 * withGeneral: false leaves the general messages ("something is due", "we missed you") waiting – used when they
 * could not be checked first for being still true, and outside the hours they go out.
 */
export async function sendDueReminders(tenant, now = new Date(), { withGeneral = true } = {}) {
  const tenantId = tenant._id;
  const today = hospitalToday(now);
  const due = await ReminderMessage.find({ tenantId, status: 'queued', sendOn: { $lte: today }, dueOn: { $gte: today }, ...(withGeneral ? {} : { kind: { $nin: GENERAL_KINDS } }) }).limit(500);
  const sender = currentSender();
  const out = { sent: 0, failed: 0, toSend: 0 };
  for (const m of due) {
    // The patient may have withdrawn her consent since it was queued
    const p = await Patient.findOne({ _id: m.patientId, tenantId }, { reminders: 1, duplicateOf: 1, 'death.on': 1 }).lean();
    if (!p?.reminders?.consent || isDuplicate(p) || isClosed(p)) {
      m.status = 'cancelled';
      m.error = isDuplicate(p) ? DUPLICATE_MESSAGE_REASON : isClosed(p) ? CLOSED_MESSAGE_REASON : 'Reminders switched off for this patient';
      await m.save();
      continue;
    }
    if (!sender || !sender.channels.includes(m.channel)) {
      m.status = 'to_send';
      m.error = sender ? `No ${m.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} sender is set up` : 'No message provider is set up';
      await m.save();
      out.toSend += 1;
      continue;
    }
    // Taken by this round only: another round that read the same queued message a moment ago leaves it alone
    if (!(await claim(m, tenantId, now))) continue;
    m.attempts += 1;
    try {
      const { providerId } = await sender.send({ channel: m.channel, to: m.to, text: m.text, hospital: tenant.letterhead?.name || tenant.name });
      m.status = 'sent';
      m.sentAt = now;
      m.providerId = providerId ?? '';
      m.error = '';
      out.sent += 1;
    } catch (err) {
      m.error = String(err?.message ?? 'Sending failed').slice(0, 300);
      // The attempt is over: the next round may try again. (The mark was set in the database, not on this copy –
      // so the copy is told that the field changed, or the save would leave the mark in place.)
      m.claimedAt = null;
      m.markModified('claimedAt');
      if (m.attempts >= MAX_ATTEMPTS) {
        m.status = 'failed';
        out.failed += 1;
      }
    }
    await m.save();
  }
  return out;
}

/** Takes a queued message for sending, in one step in the database. false: another round has it (or it is no longer queued). */
async function claim(m, tenantId, now) {
  const stale = new Date(now.getTime() - CLAIM_MINUTES * 60_000);
  const r = await ReminderMessage.updateOne({ _id: m._id, tenantId, status: 'queued', $or: [{ claimedAt: null }, { claimedAt: { $lt: stale } }] }, { $set: { claimedAt: now } });
  return r.modifiedCount === 1;
}

/** May the two general messages go out at this hour? From the sending hour until the last hour (hospital time). */
export function generalHours(now = new Date()) {
  const hour = hospitalHour(now);
  return hour >= config.REMINDER_SEND_HOUR && hour < config.REMINDER_LAST_HOUR;
}

// A step of the general messages never stops the appointment reminders of the round: if it fails, the round goes
// on without it (the message of the error only – never a patient – goes to the server's log, as for a whole round).
async function generalStep(fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    console.error('Reminders: a step of the general messages failed', err?.message ?? err);
    return fallback;
  }
}

/**
 * One round for one hospital: cancel the waiting general messages that are no longer true, queue tomorrow's
 * appointment reminders, the "we missed you" and the "something is due" messages, then send what is due.
 * Returns counts only: { queued, missed, careDue, heldBack, dropped, waiting, sent, failed, toSend } – heldBack:
 * patients with something overdue who got no message only because their care plan is still a draft (no doctor
 * approved it); waiting: general messages kept for the morning (it is outside the hours they go out).
 */
export async function runForTenant(tenant, now = new Date()) {
  // null: the check itself failed – then no general message is queued or sent in this round
  const dropped = await generalStep(() => cancelStaleGeneral(tenant, now), null);
  const checked = dropped !== null;
  const queued = await queueAppointmentReminders(tenant, now);
  // "We missed you" first: it is tied to a day; the 14-day rule then holds the other one back for this patient.
  const missed = checked ? await generalStep(() => queueMissedAppointments(tenant, now), 0) : 0;
  const { added: careDue, heldBack } = checked ? await generalStep(() => queueCareDue(tenant, now), { added: 0, heldBack: 0 }) : { added: 0, heldBack: 0 };
  // In the evening and at night the general messages wait (queued) for the next morning's round
  const inHours = generalHours(now);
  const today = hospitalToday(now);
  const waiting = inHours ? 0 : await ReminderMessage.countDocuments({ tenantId: tenant._id, status: 'queued', kind: { $in: GENERAL_KINDS }, sendOn: { $lte: today }, dueOn: { $gte: today } });
  return { queued, missed, careDue, heldBack, dropped: dropped ?? 0, waiting, ...(await sendDueReminders(tenant, now, { withGeneral: checked && inHours })) };
}

/** The hourly round: every hospital with reminders switched on, from the sending hour. */
export async function runReminders(now = new Date()) {
  if (hospitalHour(now) < config.REMINDER_SEND_HOUR) return [];
  const tenants = await Tenant.find({ isActive: true, 'messaging.remindersEnabled': true });
  const results = [];
  for (const t of tenants) {
    try {
      results.push(await runForTenant(t, now));
    } catch (err) {
      console.error('Reminders: a hospital could not be processed', err?.message ?? err);
    }
  }
  return results;
}
