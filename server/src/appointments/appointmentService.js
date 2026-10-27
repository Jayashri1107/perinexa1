// Appointment booking (docs/APPOINTMENTS_PLAN.md): the rules shared by the Appointments page, the visit page (a
// next visit books itself), the Today page (tokens, waiting lists), the calendar and the reminders.
//
// Rules this file keeps:
//  - every query starts with this hospital's tenantId;
//  - an appointment's arrived / seen / "did not come" is worked out from the day's arrivals and visits, never
//    stored (one source of truth with the Today page);
//  - messages go only to registered patients who agreed to them, and only when the hospital switched them on;
//  - nothing medical is read or sent: names, patient numbers, phones, doctors, days, times and visit types.

import mongoose from 'mongoose';
import { notify } from '../notifications/notify.js';
import { addDays, hospitalToday, isoDay, utcDay } from '../careplans/dates.js';
import { appointmentFees } from '../billing/billingService.js';
import { billAppointmentCancelled } from '../billing/hooks.js';
import { Appointment } from '../models/Appointment.js';
import { Arrival } from '../models/Arrival.js';
import { nextNumber } from '../models/Counter.js';
import { Membership } from '../models/Membership.js';
import { OpdSchedule } from '../models/OpdSchedule.js';
import { Patient } from '../models/Patient.js';
import { ReminderMessage } from '../models/ReminderMessage.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { appointmentChangeMessage, timeWords } from '../reminders/messages.js';
import { mobileNumber } from '../reminders/phone.js';
import { sendSoon } from '../reminders/reminderService.js';
import { HttpError } from '../utils/httpError.js';
import { isDuplicate, refuseNewOnDuplicate } from '../patients/duplicateRules.js';
import { isClosed, refuseNewOnClosed } from '../patients/deathRules.js';
import { MAX_DAYS_AHEAD, SLOT_MINUTES } from './appointmentRules.js';
import { coveredStarts, firstFreeSlot, hospitalMinutes, leaveOn, lengthFor, minutesOf, sessionsOn, slotCheck, slotStarts, walkInStarts } from './slots.js';

const who = (req) => ({ by: req.user?._id ?? null, byName: req.user?.name ?? 'Perinexa', at: req.now ?? new Date() });

// ---------- Doctors and their timings ----------

/** The hospital's active doctors: [{ id, name }] by name. */
export async function hospitalDoctors(tenantId) {
  const memberships = await Membership.find({ tenantId, isActive: true, roles: 'doctor' }, { userId: 1 }).lean();
  const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) }, isActive: true }, { name: 1 }).sort({ name: 1 }).lean();
  return users.map((u) => ({ id: String(u._id), name: u.name }));
}

/** The doctor with this id in this hospital ({ id, name }), or a 400 naming the problem. */
export async function hospitalDoctor(tenantId, doctorId) {
  const doctor = (await hospitalDoctors(tenantId)).find((d) => d.id === String(doctorId));
  if (!doctor) throw new HttpError(400, 'Please choose a doctor of this hospital.', 'NOT_A_DOCTOR');
  return doctor;
}

export const scheduleOf = (tenantId, doctorId) => OpdSchedule.findOne({ tenantId, doctorId }).lean();

/** A doctor's booked time slots of a day (not cancelled), except one appointment. */
const bookedSlots = (tenantId, doctorId, day, exceptId = null) =>
  Appointment.find(
    { tenantId, doctorId, on: utcDay(day), kind: 'slot', status: 'booked', start: { $ne: null }, ...(exceptId ? { _id: { $ne: exceptId } } : {}) },
    { start: 1, minutes: 1, patientId: 1, guest: 1 },
  )
    .sort({ start: 1 })
    .lean();

/** Slot times already taken for a doctor on a day – every slot each booking lasts through – except one appointment. */
export async function takenStarts(tenantId, doctorId, day, exceptId = null) {
  const rows = await bookedSlots(tenantId, doctorId, day, exceptId);
  return new Set(rows.flatMap((r) => coveredStarts(r.start, r.minutes ?? SLOT_MINUTES)));
}

/**
 * The times of a doctor's day that are free for a visit of this type (every slot it takes is free and in a session,
 * and not already past today): ["10:00", …]. [] on leave, on a day off, or when the doctor set no timings.
 */
export async function freeStarts(tenantId, doctorId, day, { visitType = 'follow_up', now = new Date(), online = false } = {}) {
  const schedule = await scheduleOf(tenantId, doctorId);
  if (!schedule || leaveOn(schedule, day)) return [];
  const minutes = lengthFor(schedule, visitType);
  const starts = slotStarts(sessionsOn(schedule, day));
  const taken = await takenStarts(tenantId, doctorId, day);
  const isToday = utcDay(day).getTime() === hospitalToday(now).getTime();
  const nowMinutes = hospitalMinutes(now);
  // Online (the patient portal): never the slots kept for walk-ins
  const kept = online ? walkInStarts(schedule, day) : new Set();
  return starts.filter((start) => coveredStarts(start, minutes).every((s) => starts.includes(s) && !taken.has(s) && !kept.has(s)) && !(isToday && minutesOf(start) < nowMinutes));
}

// ---------- Arrived, seen, did not come ----------

/**
 * For registered patients on one day: "<patientId>" -> { arrivedAt, seen }. arrivedAt: marked arrived by reception
 * or her visit started, whichever came first; seen: a visit was started for her that day.
 */
export async function dayStates(tenantId, patientIds, day) {
  const ids = [...new Set(patientIds.filter(Boolean).map(String))];
  const out = new Map();
  if (!ids.length) return out;
  const on = utcDay(day);
  const [arrivals, visits] = await Promise.all([
    Arrival.find({ tenantId, on, patientId: { $in: ids } }, { patientId: 1, at: 1, emergency: 1, purpose: 1 }).lean(),
    Visit.find({ tenantId, visitOn: on, status: 'active', patientId: { $in: ids } }, { patientId: 1, createdAt: 1 }).lean(),
  ]);
  const at = (pid) => out.get(pid) ?? out.set(pid, { arrivedAt: null, seen: false }).get(pid);
  const earliest = (s, t) => {
    if (t && (!s.arrivedAt || t < s.arrivedAt)) s.arrivedAt = t;
  };
  for (const a of arrivals) {
    earliest(at(String(a.patientId)), a.at);
    if (a.emergency) at(String(a.patientId)).emergency = true; // the live queue: seen first
    if (a.purpose?.kind) at(String(a.patientId)).purpose = { kind: a.purpose.kind, note: a.purpose.note ?? '' }; // why she came
  }
  for (const v of visits) {
    const s = at(String(v.patientId));
    s.seen = true;
    earliest(s, v.createdAt);
  }
  return out;
}

/** 'cancelled' | 'seen' | 'arrived' | 'booked' | 'no_show' ("did not come": the day passed with no arrival). */
export function statusOf(appt, state, today) {
  if (appt.status === 'cancelled') return 'cancelled';
  if (state?.seen || appt.done) return 'seen';
  if (state?.arrivedAt) return 'arrived';
  return utcDay(appt.on) < utcDay(today) ? 'no_show' : 'booked';
}

/** The states of many appointments (any days): Map "<patientId>:<YYYY-MM-DD>" -> state. */
export async function statesFor(tenantId, appts) {
  const byDay = new Map();
  for (const a of appts) {
    if (!a.patientId) continue;
    const k = isoDay(a.on);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(a.patientId);
  }
  const out = new Map();
  for (const [day, ids] of byDay) {
    const states = await dayStates(tenantId, ids, new Date(`${day}T00:00:00Z`));
    for (const [pid, s] of states) out.set(`${pid}:${day}`, s);
  }
  return out;
}

// ---------- What the website gets ----------

/** Names, patient numbers and phones of the patients, and the doctors' names, for a list of appointments. */
export async function lookups(tenantId, appts) {
  const pids = [...new Set(appts.map((a) => a.patientId && String(a.patientId)).filter(Boolean))];
  const dids = [...new Set(appts.map((a) => String(a.doctorId)))];
  const [patients, doctors] = await Promise.all([
    pids.length ? Patient.find({ tenantId, _id: { $in: pids } }, { fullName: 1, mrn: 1, phone: 1, assignedDoctor: 1 }).lean() : [],
    dids.length ? User.find({ _id: { $in: dids } }, { name: 1 }).lean() : [],
  ]);
  // Consultation fees taken in advance (billing): only for registered patients' time slots
  const fees = await appointmentFees(tenantId, appts.filter((a) => a.patientId && a.kind === 'slot').map((a) => a._id));
  return { patients: new Map(patients.map((p) => [String(p._id), p])), doctors: new Map(doctors.map((d) => [String(d._id), d.name])), fees };
}

/** One appointment as the website gets it (built field by field). */
export function appointmentView(a, { patients, doctors, states, today, fees = null }) {
  const p = a.patientId ? patients.get(String(a.patientId)) : null;
  const state = a.patientId ? states?.get(`${String(a.patientId)}:${isoDay(a.on)}`) : null;
  const status = statusOf(a, state, today);
  return {
    id: String(a._id),
    date: isoDay(a.on),
    kind: a.kind,
    start: a.start ?? null,
    minutes: a.kind === 'slot' ? (a.minutes ?? SLOT_MINUTES) : null,
    token: a.token ?? null,
    needsTime: a.kind === 'slot' && !a.start,
    visitType: a.visitType,
    status,
    arrivedAt: ['arrived', 'seen'].includes(status) ? (state?.arrivedAt ?? null) : null,
    // Marked as an emergency today (the live queue): first in the doctor's waiting list
    emergency: status === 'arrived' && Boolean(state?.emergency),
    // Why she came, marked at check-in (a fixed purpose and a short note – never a medical detail)
    purpose: ['arrived', 'seen'].includes(status) ? (state?.purpose ?? null) : null,
    source: a.source,
    fromVisit: Boolean(a.visitId),
    movedByHand: Boolean(a.movedByHand),
    doctor: { id: String(a.doctorId), name: doctors.get(String(a.doctorId)) ?? 'Doctor' },
    patient: p ? { id: String(p._id), fullName: p.fullName, mrn: p.mrn, phone: p.phone ?? '' } : null,
    guest: !p && a.guest ? { name: a.guest.name, phone: a.guest.phone } : null,
    cancelled: a.status === 'cancelled' && a.cancelled ? { reason: a.cancelled.reason, byName: a.cancelled.byName ?? '', at: a.cancelled.at ?? null } : null,
    bookedBy: a.created?.byName ?? '',
    // The consultation fee taken in advance, if any: { amountPaise, billId, number }
    fee: fees?.get(String(a._id)) ?? null,
  };
}

/** Views of many appointments, with their lookups and states. */
export async function viewsOf(tenantId, appts, today) {
  const [{ patients, doctors, fees }, states] = await Promise.all([lookups(tenantId, appts), statesFor(tenantId, appts)]);
  return appts.map((a) => appointmentView(a, { patients, doctors, states, today, fees }));
}

// ---------- Messages ----------

/**
 * Queues the message for a booking, a move or a cancellation – only when the hospital switched messages on, the
 * appointment has a time and a registered patient who agreed, with a mobile number. Sent with the hourly round
 * (reminders/reminderService.js). Returns true when one was queued.
 */
export async function queueChangeMessage(tenantId, appt, kind, now = new Date()) {
  if (!appt.patientId || !appt.start || appt.kind !== 'slot') return false;
  const tenant = await Tenant.findById(tenantId, { name: 1, letterhead: 1, messaging: 1 }).lean();
  if (!tenant?.messaging?.remindersEnabled) return false;
  const p = await Patient.findOne({ tenantId, _id: appt.patientId }, { phone: 1, reminders: 1, 'death.on': 1 }).lean();
  // (a closed record – a death was recorded on it – gets no message of any kind)
  if (!p?.reminders?.consent || isClosed(p)) return false;
  const to = mobileNumber(p.phone);
  if (!to) return false;
  const doctor = await User.findById(appt.doctorId, { name: 1 }).lean();
  const language = p.reminders.language ?? 'en';
  const day = utcDay(appt.on);
  const text = appointmentChangeMessage({ kind, hospital: tenant.letterhead?.name || tenant.name, phone: tenant.letterhead?.phone ?? '', day, time: appt.start, doctor: doctor?.name ?? '', lang: language });
  // An earlier message of this appointment that has not gone out yet is no longer true: replaced by this one
  await ReminderMessage.updateMany(
    { tenantId, patientId: appt.patientId, kind: { $in: ['booked', 'moved', 'cancelled'] }, ref: new RegExp(`^${String(appt._id)}:`), status: 'queued' },
    { $set: { status: 'cancelled', error: 'Replaced by a newer change' } },
  );
  await ReminderMessage.create({
    tenantId,
    patientId: appt.patientId,
    kind,
    ref: `${String(appt._id)}:${appt.changes}`,
    dueOn: day,
    sendOn: hospitalToday(now),
    channel: p.reminders.channel ?? 'sms',
    language,
    to,
    text,
  });
  sendSoon(tenantId, now); // at once, not with the next hourly round (not waited for: the booking never waits on it)
  return true;
}

// ---------- Booking, moving, cancelling ----------

const conflict = (message, code, extra = {}) => Object.assign(new HttpError(409, message, code), extra);

/**
 * Checks a day and time for a doctor (throws a 400/409 naming the problem). confirm: book a slot that is already
 * taken, or a second appointment for the patient that day, after the warning.
 */
async function checkSlot(req, { doctor, day, start, visitType, patientId, exceptId = null, confirm = false }) {
  const today = hospitalToday(req.now);
  if (day < today) throw new HttpError(400, 'That day has passed. Please choose today or a later day.', 'DAY_PASSED');
  if (day > addDays(today, MAX_DAYS_AHEAD)) throw new HttpError(400, 'Appointments can be booked up to a year ahead.', 'TOO_FAR');
  const schedule = await scheduleOf(req.tenantId, doctor.id);
  // Booked for the day without a time (bookSlot only): no slot to check – only a second booking for her that day
  if (start === null) {
    if (!confirm) await assertNoOtherThatDay(req, { patientId, day, exceptId });
    return schedule ? lengthFor(schedule, visitType) : null;
  }
  if (!schedule) throw new HttpError(400, `${doctor.name} has not set OPD timings yet (Appointments → OPD timings).`, 'NO_TIMINGS');
  const minutes = lengthFor(schedule, visitType);
  const check = slotCheck(schedule, day, start, minutes);
  if (check === 'too_long') throw new HttpError(400, `This visit takes ${minutes} minutes: it does not fit before ${doctor.name}'s OPD ends. Please choose an earlier time.`, 'TOO_LONG');
  if (check === 'leave') throw new HttpError(400, `${doctor.name} is on leave that day.`, 'ON_LEAVE');
  if (check === 'off') throw new HttpError(400, `${doctor.name} has no OPD that day.`, 'NO_OPD');
  if (check === 'outside') throw new HttpError(400, `${timeWords(start)} is not one of ${doctor.name}'s appointment times that day.`, 'OUTSIDE_OPD');
  if (day.getTime() === today.getTime() && minutesOf(start) < hospitalMinutes(req.now)) {
    throw new HttpError(400, `${timeWords(start)} has already passed today. Please choose a later time.`, 'TIME_PASSED');
  }
  if (confirm) return minutes;
  // Taken: another booking lasts through any of the slots this one needs
  const wanted = new Set(coveredStarts(start, minutes));
  const taken = (await bookedSlots(req.tenantId, doctor.id, day, exceptId)).find((r) => coveredStarts(r.start, r.minutes ?? SLOT_MINUTES).some((s) => wanted.has(s)));
  if (taken) {
    const p = taken.patientId ? await Patient.findOne({ tenantId: req.tenantId, _id: taken.patientId }, { fullName: 1 }).lean() : null;
    const when = taken.start === start ? `${timeWords(start)} is already booked` : `${timeWords(taken.start)} is booked`;
    throw conflict(`${when} for ${p?.fullName ?? taken.guest?.name ?? 'another patient'}${minutes > SLOT_MINUTES && taken.start !== start ? `, and this visit takes ${minutes} minutes` : ''}. Book anyway?`, 'SLOT_TAKEN', { confirmable: true });
  }
  await assertNoOtherThatDay(req, { patientId, day, exceptId });
  return minutes;
}

async function assertNoOtherThatDay(req, { patientId, day, exceptId }) {
  if (!patientId) return;
  const same = await Appointment.findOne({ tenantId: req.tenantId, patientId, on: day, status: 'booked', ...(exceptId ? { _id: { $ne: exceptId } } : {}) }, { start: 1, token: 1 }).lean();
  if (same) throw conflict(`She already has an appointment that day${same.start ? ` at ${timeWords(same.start)}` : ''}. Book another anyway?`, 'ALREADY_BOOKED', { confirmable: true });
}

/** Books a time slot (Appointments page). body: { doctorId, date, start, patientId | guest, visitType, confirm }. */
export async function bookSlot(req, body) {
  const doctor = await hospitalDoctor(req.tenantId, body.doctorId);
  const day = utcDay(body.date);
  let patientId = null;
  if (body.patientId) {
    const p = await Patient.findOne({ tenantId: req.tenantId, _id: body.patientId }, { _id: 1, duplicateOf: 1, 'death.on': 1 }).lean();
    if (!p) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
    refuseNewOnDuplicate(p, 'appointment'); // a record marked as a duplicate takes no new appointment
    refuseNewOnClosed(p, 'appointment'); // nor a record closed after a death
    patientId = p._id;
  }
  const minutes = await checkSlot(req, { doctor, day, start: body.start, visitType: body.visitType, patientId, confirm: body.confirm });
  const appt = await Appointment.create({
    tenantId: req.tenantId,
    patientId,
    guest: patientId ? null : body.guest,
    doctorId: doctor.id,
    on: day,
    kind: 'slot',
    start: body.start,
    minutes,
    visitType: body.visitType,
    source: body.source ?? 'booked',
    created: who(req),
  });
  await queueChangeMessage(req.tenantId, appt, 'booked', req.now);
  // The doctor is told (not when the doctor booked it): name, day and time – never why she comes
  const bookedName = patientId ? (await Patient.findOne({ tenantId: req.tenantId, _id: patientId }, { fullName: 1 }).lean())?.fullName : body.guest?.name;
  await notify(req, { userIds: [doctor.id] }, { kind: 'appointment', text: `New appointment: ${bookedName ?? 'a patient'}, ${isoDay(day)}${body.start ? ` at ${body.start}` : ' (time to be set)'}${body.source === 'portal' ? ' (booked online)' : ''}.`, link: '/appointments' });
  return appt;
}

/** The appointment with this id in this hospital (404 otherwise). */
export async function findAppointment(req, id) {
  const appt = await Appointment.findOne({ tenantId: req.tenantId, _id: id });
  if (!appt) throw new HttpError(404, 'Appointment not found.', 'NOT_FOUND');
  return appt;
}

const assertChangeable = (appt, today) => {
  if (appt.status === 'cancelled') throw new HttpError(409, 'This appointment was cancelled.', 'CANCELLED');
  if (appt.kind === 'token') throw new HttpError(409, 'A walk-in token cannot be moved. Undo the arrival on the Today page instead.', 'TOKEN');
  if (utcDay(appt.on) < utcDay(today)) throw new HttpError(409, 'This appointment is in the past.', 'PAST');
};

/** Moves a slot (another day, time or doctor), or gives a "needs a time" booking its time. */
export async function moveSlot(req, appt, body) {
  const today = hospitalToday(req.now);
  assertChangeable(appt, today);
  const doctor = await hospitalDoctor(req.tenantId, body.doctorId ?? appt.doctorId);
  const day = utcDay(body.date);
  if (appt.patientId) {
    // (a closed record's appointments were cancelled when it was closed; one left over is not moved either)
    refuseNewOnClosed(await Patient.findOne({ tenantId: req.tenantId, _id: appt.patientId }, { 'death.on': 1 }).lean(), 'appointment');
    const states = await dayStates(req.tenantId, [appt.patientId], appt.on);
    if (statusOf(appt, states.get(String(appt.patientId)), today) === 'seen') throw new HttpError(409, 'She has already been seen for this appointment.', 'SEEN');
  }
  const minutes = await checkSlot(req, { doctor, day, start: body.start, visitType: body.visitType ?? appt.visitType, patientId: appt.patientId, exceptId: appt._id, confirm: body.confirm });
  const hadTime = Boolean(appt.start);
  appt.doctorId = doctor.id;
  appt.on = day;
  appt.start = body.start;
  appt.minutes = minutes;
  if (body.visitType) appt.visitType = body.visitType;
  appt.movedByHand = true;
  appt.changes += 1;
  appt.updated = who(req);
  await appt.save();
  // Whether she gets a message with the new day and time (reception and the doctor are told – 24 Oct 2026)
  appt.$locals.messaged = await queueChangeMessage(req.tenantId, appt, hadTime ? 'moved' : 'booked', req.now);
  return appt;
}

/** Cancels an appointment (reason: patient_asked | doctor_leave | other, or one the app gives). */
export async function cancelAppointment(req, appt, reason, { message = true } = {}) {
  if (appt.status === 'cancelled') return appt;
  appt.status = 'cancelled';
  appt.cancelled = { reason, ...who(req) };
  appt.changes += 1;
  appt.updated = who(req);
  await appt.save();
  await billAppointmentCancelled(req, appt);
  if (message && utcDay(appt.on) >= hospitalToday(req.now)) await queueChangeMessage(req.tenantId, appt, 'cancelled', req.now);
  return appt;
}

/** Links a quick booking to the patient she was registered as. */
export async function linkPatient(req, appt, patientId) {
  if (appt.patientId) throw new HttpError(409, 'This appointment already belongs to a registered patient.', 'LINKED');
  const p = await Patient.findOne({ tenantId: req.tenantId, _id: patientId }, { _id: 1, duplicateOf: 1, 'death.on': 1 }).lean();
  if (!p) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  refuseNewOnDuplicate(p, 'appointment');
  refuseNewOnClosed(p, 'appointment');
  appt.patientId = p._id;
  appt.updated = who(req);
  await appt.save();
  return appt;
}

// ---------- Walk-in tokens ----------

/** The next token number of a doctor's day (1, 2, 3 … – never given twice, even after an undo). */
export async function giveToken(req, { patientId, doctor, day }) {
  const token = await nextNumber(req.tenantId, `token:${doctor.id}:${isoDay(day)}`);
  return Appointment.create({
    tenantId: req.tenantId,
    patientId,
    doctorId: doctor.id,
    on: day,
    kind: 'token',
    token,
    visitType: 'other',
    source: 'walk_in',
    created: who(req),
  });
}

// ---------- A visit's "next visit" ----------

/** The doctor a next visit is booked with: the patient's doctor, else the one who saved the visit (if a doctor). */
async function nextVisitDoctor(req, patient) {
  const doctors = await hospitalDoctors(req.tenantId);
  const byId = (id) => id && doctors.find((d) => d.id === String(id));
  return byId(patient.assignedDoctor) || byId(req.user?._id) || null;
}

/**
 * Places a next visit: the first free time that day with the doctor for a visit of this type ({ start, minutes }),
 * else { start: null } – it "needs a time".
 */
async function place(req, doctor, day, { visitType = 'follow_up', exceptId = null } = {}) {
  const schedule = await scheduleOf(req.tenantId, doctor.id);
  if (!schedule) return { start: null, minutes: null };
  const minutes = lengthFor(schedule, visitType);
  const taken = await takenStarts(req.tenantId, doctor.id, day, exceptId);
  const start = firstFreeSlot(schedule, day, taken, { today: hospitalToday(req.now), nowMinutes: hospitalMinutes(req.now), minutes });
  return { start, minutes: start ? minutes : null };
}

/**
 * After a visit's details were saved: books, moves or cancels the appointment its "next visit" made (owner: the app
 * books the first free slot that day with the same doctor; reception can move it). before: the next-visit date
 * before this save. A booking reception moved by hand is left alone. Returns the visit's booking, or null.
 */
export async function syncNextVisit(req, patient, visit, before) {
  const next = visit.details?.nextVisitOn ? utcDay(visit.details.nextVisitOn) : null;
  const changed = (before ? utcDay(before).getTime() : null) !== (next ? next.getTime() : null);
  const linked = await Appointment.find({ tenantId: req.tenantId, visitId: visit._id }).sort({ createdAt: -1 });
  const active = linked.find((a) => a.status === 'booked');
  if (!changed && (linked.length || !next)) return active ?? null;
  if (active?.movedByHand) return active;
  // A record marked as a duplicate takes no new appointment (its visits can no longer be changed either); nor does a
  // record closed after a death (its appointments were cancelled when it was closed)
  if (isDuplicate(patient) || isClosed(patient)) return active ?? null;
  if (!next) {
    if (active) await cancelAppointment(req, active, 'next_visit_cleared');
    return null;
  }
  if (next < hospitalToday(req.now)) return active ?? null;
  // Already booked that day by hand (e.g. reception, on the phone): that booking stands
  const existing = await Appointment.findOne({ tenantId: req.tenantId, patientId: patient._id, on: next, status: 'booked', _id: { $ne: active?._id } }).lean();
  if (existing) {
    if (active) await cancelAppointment(req, active, 'next_visit_cleared', { message: false });
    return existing;
  }
  const doctor = active ? { id: String(active.doctorId) } : await nextVisitDoctor(req, patient);
  if (!doctor) return active ?? null; // no doctor to book with: the date stays on the calendar as before
  const { start, minutes } = await place(req, doctor, next, { visitType: active?.visitType ?? 'follow_up', exceptId: active?._id ?? null });
  if (active) {
    active.on = next;
    active.start = start;
    active.minutes = minutes;
    active.changes += 1;
    active.updated = who(req);
    await active.save();
    await queueChangeMessage(req.tenantId, active, 'moved', req.now);
    return active;
  }
  const appt = await Appointment.create({
    tenantId: req.tenantId,
    patientId: patient._id,
    doctorId: doctor.id,
    on: next,
    kind: 'slot',
    start,
    minutes,
    visitType: 'follow_up',
    source: 'next_visit',
    visitId: visit._id,
    created: who(req),
  });
  await queueChangeMessage(req.tenantId, appt, 'booked', req.now);
  return appt;
}

/**
 * After a doctor's OPD timings changed: their next visits from today on that still need a time (and were not given
 * one by hand) get the first free slot of their day, if there now is one. Returns how many were placed.
 */
export async function placeWaitingNextVisits(req, doctorId) {
  const waiting = await Appointment.find({ tenantId: req.tenantId, doctorId, kind: 'slot', status: 'booked', start: null, movedByHand: false, on: { $gte: hospitalToday(req.now) } })
    .sort({ on: 1, createdAt: 1 })
    .limit(500);
  let placed = 0;
  for (const appt of waiting) {
    const { start, minutes } = await place(req, { id: String(doctorId) }, appt.on, { visitType: appt.visitType });
    if (!start) continue;
    appt.start = start;
    appt.minutes = minutes;
    appt.changes += 1;
    appt.updated = who(req);
    await appt.save();
    await queueChangeMessage(req.tenantId, appt, 'booked', req.now);
    placed += 1;
  }
  return placed;
}

/**
 * A visit was cancelled: the booking its next visit made goes too (unless reception moved it by hand). Only while
 * the booking is still on the visit's own record: one that went to the main record when this record was marked as
 * a duplicate is hers there, and stays.
 */
export async function cancelForVisit(req, visit) {
  const active = await Appointment.find({ tenantId: req.tenantId, visitId: visit._id, patientId: visit.patientId, status: 'booked', movedByHand: false });
  for (const a of active) await cancelAppointment(req, a, 'visit_cancelled');
}

/** The booking a visit's next visit made, as the visit page shows it ({ date, start, needsTime, doctorName, movedByHand }). */
export async function visitBooking(tenantId, visit, today) {
  if (!visit.details?.nextVisitOn) return null;
  const appt =
    (await Appointment.findOne({ tenantId, visitId: visit._id, status: 'booked' }).lean()) ??
    (await Appointment.findOne({ tenantId, patientId: visit.patientId, on: utcDay(visit.details.nextVisitOn), status: 'booked' }).lean());
  if (!appt) return null;
  const doctor = await User.findById(appt.doctorId, { name: 1 }).lean();
  return {
    id: String(appt._id),
    date: isoDay(appt.on),
    start: appt.start ?? null,
    needsTime: !appt.start,
    doctorName: doctor?.name ?? 'Doctor',
    movedByHand: Boolean(appt.movedByHand),
    past: utcDay(appt.on) < utcDay(today),
  };
}

/**
 * A patient's next appointment from today on, for the portal and the reminder page: { date, start, doctorName } –
 * the earliest booked time slot, else the next-visit date of her latest visit (when it made no appointment).
 */
export async function nextAppointment(tenantId, patientId, today) {
  const appt = await Appointment.findOne({ tenantId, patientId, on: { $gte: utcDay(today) }, kind: 'slot', status: 'booked' }).sort({ on: 1, start: 1 }).lean();
  if (appt) {
    const doctor = await User.findById(appt.doctorId, { name: 1 }).lean();
    return { date: utcDay(appt.on), start: appt.start ?? null, doctorName: doctor?.name ?? null };
  }
  const latest = await Visit.findOne({ tenantId, patientId, status: 'active' }, { details: 1 }).sort({ visitOn: -1, createdAt: -1 }).lean();
  const next = latest?.details?.nextVisitOn;
  if (!next || next < utcDay(today) || (await Appointment.exists({ tenantId, visitId: latest._id }))) return null;
  return { date: utcDay(next), start: null, doctorName: null };
}

/**
 * Which of these patients are already coming: a booked appointment from today on, or – from before appointment
 * booking – the next-visit date (from today on) of her latest visit when it made no appointment (the rule of the
 * Today page's call lists). Returns Map "<patientId>" -> the day she is booked for (the earliest).
 */
export async function bookedAhead(tenantId, patientIds, today) {
  const out = new Map();
  const ids = [...new Set(patientIds.map(String))].map((id) => new mongoose.Types.ObjectId(id));
  if (!ids.length) return out;
  const from = utcDay(today);
  const appts = await Appointment.find({ tenantId, patientId: { $in: ids }, on: { $gte: from }, status: 'booked' }, { patientId: 1, on: 1 }).sort({ on: 1 }).lean();
  for (const a of appts) if (!out.has(String(a.patientId))) out.set(String(a.patientId), utcDay(a.on));
  // Each patient's latest visit that was not cancelled (the order of the index { tenantId, patientId, visitOn, createdAt })
  const latest = await Visit.aggregate([
    { $match: { tenantId: new mongoose.Types.ObjectId(String(tenantId)), status: 'active', patientId: { $in: ids } } },
    { $sort: { patientId: 1, visitOn: -1, createdAt: -1 } },
    { $group: { _id: '$patientId', visitId: { $first: '$_id' }, next: { $first: '$details.nextVisitOn' } } },
  ]);
  const withDate = latest.filter((l) => l.next && utcDay(l.next) >= from && !out.has(String(l._id)));
  // A next visit that made an appointment counts through the appointment above: a cancelled one is not "coming"
  const linked = withDate.length ? new Set((await Appointment.find({ tenantId, visitId: { $in: withDate.map((l) => l.visitId) } }, { visitId: 1 }).lean()).map((a) => String(a.visitId))) : new Set();
  for (const l of withDate) if (!linked.has(String(l.visitId))) out.set(String(l._id), utcDay(l.next));
  return out;
}

// ---------- Next-visit dates from before appointment booking ----------

/**
 * Turns the next-visit dates (from today on) of each patient's latest visit into appointments, once – they were
 * the only bookings before appointment booking. Safe to run again: a visit that already has an appointment is
 * skipped. Returns how many were made.
 */
export async function convertNextVisits(tenantId, now = new Date()) {
  const today = hospitalToday(now);
  const visits = await Visit.find({ tenantId, status: 'active', 'details.nextVisitOn': { $gte: today } }, { patientId: 1, visitOn: 1, createdAt: 1, createdBy: 1, details: 1 })
    .sort({ visitOn: -1, createdAt: -1 })
    .lean();
  let made = 0;
  const seen = new Set();
  for (const v of visits) {
    const pid = String(v.patientId);
    if (seen.has(pid)) continue;
    seen.add(pid);
    const latest = await Visit.findOne({ tenantId, patientId: v.patientId, status: 'active' }, { _id: 1 }).sort({ visitOn: -1, createdAt: -1 }).lean();
    if (String(latest?._id) !== String(v._id)) continue;
    if (await Appointment.exists({ tenantId, visitId: v._id })) continue;
    const patient = await Patient.findOne({ tenantId, _id: v.patientId }, { assignedDoctor: 1, duplicateOf: 1, 'death.on': 1 }).lean();
    if (!patient || isDuplicate(patient) || isClosed(patient)) continue;
    const creator = await User.findById(v.createdBy, { name: 1 }).lean();
    const req = { tenantId, now, user: creator ? { _id: creator._id, name: creator.name } : null };
    const appt = await syncNextVisit(req, patient, v, null);
    if (appt && String(appt.visitId) === String(v._id)) made += 1;
  }
  return made;
}
