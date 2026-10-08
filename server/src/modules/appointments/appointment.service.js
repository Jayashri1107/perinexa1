// Appointments (as in Perinexa): one doctor's day of time slots, bookings that still need a time, walk-in tokens,
// arrivals and "seen", a patient's appointments, and the reminders to send. Doctors set their own OPD timings here
// (the hospital admin also can, under Hospital admin). No medical details: only the visit type.
// The audit log gets ids only.
import { config } from '../../config/index.js';
import { todayLocal } from '../../core/dates.js';
import { HttpError, fieldError, notFoundError } from '../../core/httpError.js';
import { toObjectId } from '../../core/validate.js';
import { Counter } from '../../db/counter.js';
import { recordAudit } from '../audit/audit.service.js';
import { OpdSchedule } from '../opdTimings/opdSchedule.model.js';
import * as opdService from '../opdTimings/opdTimings.service.js';
import { Patient } from '../patients/patient.model.js';
import { recordLevel } from '../patients/patientAccess.js';
import { doctorOptions, pickPatients } from '../patients/patient.service.js';
import { User } from '../users/user.model.js';
import { Appointment } from './appointment.model.js';
import { notify } from '../notifications/notification.service.js';
import { addDays, coveredStarts, hhmm, hospitalMinutes, isoDay, leaveOn, lengthFor, minutesOf, sessionsOn, slotCheck, slotStarts, utcDay, waitingOrder } from './slots.js';

const { access, adminRole } = config;
const DOCTOR = config.opd.doctorRole;
const { maxDaysAhead } = config.appointments;
const ACTIVE = ['booked', 'arrived', 'seen'];
const has = (req, list) => req.membership.roles.some((r) => list.includes(r));
const canBook = (req) => has(req, access.bookAppointments);
const canMarkSeen = (req) => has(req, access.patientsClinical);
// Doctors set their own timings; the hospital admin sets anyone's.
const canEditTimings = (req, doctorId) =>
  req.membership.roles.includes(adminRole) || (req.membership.roles.includes(DOCTOR) && req.user._id.equals(doctorId));
const today = () => utcDay(todayLocal());

function assertCanBook(req) {
  if (!canBook(req)) throw new HttpError(403, 'Reception and doctors book appointments.', 'FORBIDDEN');
}

// ---------- Doctors and their timings ----------

async function findDoctor(hospitalId, doctorId) {
  const doctor = (await doctorOptions(hospitalId)).find((d) => d.id === String(doctorId));
  if (!doctor) throw fieldError('doctorId', 'Choose a doctor who works in this hospital.');
  return doctor;
}

const scheduleOf = (hospitalId, doctorId) => OpdSchedule.findOne({ hospitalId, doctorId }).lean();

export async function doctors(req) {
  const list = await doctorOptions(req.hospitalId);
  const schedules = await OpdSchedule.find({ hospitalId: req.hospitalId }).select('doctorId week').lean();
  const withTimings = new Set(schedules.filter((s) => s.week?.some((w) => w.sessions?.length)).map((s) => String(s.doctorId)));
  return {
    doctors: list.map((d) => ({ ...d, hasTimings: withTimings.has(d.id), canEditTimings: canEditTimings(req, d.id) })),
    // 'me' only for a doctor on this hospital's list (the super admin holds every role but is not one of its doctors)
    me: req.membership.roles.includes(DOCTOR) && list.some((d) => d.id === String(req.user._id)) ? String(req.user._id) : null,
    canBook: canBook(req),
    canMarkSeen: canMarkSeen(req),
    today: todayLocal(),
  };
}

export async function getTimings(req, doctorId) {
  await findDoctor(req.hospitalId, doctorId);
  return { schedule: await opdService.getSchedule(req.hospitalId, doctorId), canEdit: canEditTimings(req, doctorId) };
}

// Saves the timings, then lists the bookings from today on that no longer fit them (reception moves those).
export async function saveTimings(req, doctorId, data) {
  if (!canEditTimings(req, doctorId)) throw new HttpError(403, 'Doctors set their own OPD timings (or the hospital admin does).', 'FORBIDDEN');
  const schedule = await opdService.saveSchedule(req, req.hospitalId, doctorId, data);
  const ahead = await Appointment.find({ hospitalId: req.hospitalId, doctorId, on: { $gte: today() }, kind: 'slot', status: 'booked', start: { $ne: null } })
    .sort({ on: 1, start: 1 })
    .limit(500)
    .lean();
  const affected = ahead.filter((a) => slotCheck(schedule, a.on, a.start, a.minutes) !== 'ok');
  return { schedule, canEdit: true, affected: await viewsOf(req.hospitalId, affected) };
}

// ---------- What the website gets ----------

export function statusOf(a, todayDay = today()) {
  if (a.status === 'booked' && utcDay(a.on) < todayDay) return 'no_show';
  return a.status;
}

async function viewsOf(hospitalId, appts) {
  const pids = [...new Set(appts.map((a) => a.patientId && String(a.patientId)).filter(Boolean))];
  const dids = [...new Set(appts.map((a) => String(a.doctorId)))];
  const [patients, doctors] = await Promise.all([
    pids.length ? Patient.find({ hospitalId: hospitalId, _id: { $in: pids } }).select('patientNumber name phone').lean() : [],
    dids.length ? User.find({ _id: { $in: dids } }).select('name').lean() : [],
  ]);
  const pMap = new Map(patients.map((p) => [String(p._id), p]));
  const dMap = new Map(doctors.map((d) => [String(d._id), d.name]));
  const day = today();
  return appts.map((a) => {
    const p = a.patientId ? pMap.get(String(a.patientId)) : null;
    return {
      id: String(a._id),
      date: isoDay(a.on),
      kind: a.kind,
      start: a.start ?? null,
      minutes: a.kind === 'slot' ? a.minutes : null,
      token: a.token ?? null,
      needsTime: a.kind === 'slot' && !a.start,
      visitType: a.visitType,
      status: statusOf(a, day),
      arrivedAt: a.arrivedAt,
      seenAt: a.seenAt,
      source: a.source,
      doctor: { id: String(a.doctorId), name: dMap.get(String(a.doctorId)) ?? 'Doctor' },
      patient: p ? { id: String(p._id), patientNumber: p.patientNumber, name: p.name, phone: p.phone ?? '' } : null,
      guest: !p && a.guest ? { name: a.guest.name, phone: a.guest.phone } : null,
      cancelled: a.status === 'cancelled' && a.cancelled ? { reason: a.cancelled.reason, note: a.cancelled.note ?? '', at: a.cancelled.at } : null,
      reminderSentAt: a.reminderSentAt,
    };
  });
}

const viewOne = async (hospitalId, a) => (await viewsOf(hospitalId, [a.toObject ? a.toObject() : a]))[0];

// ---------- One doctor's day ----------

export async function day(req, { doctorId, date }) {
  const doctor = await findDoctor(req.hospitalId, doctorId);
  const on = utcDay(date);
  const todayDay = today();
  const [schedule, appts] = await Promise.all([
    scheduleOf(req.hospitalId, doctorId),
    Appointment.find({ hospitalId: req.hospitalId, doctorId, on, status: { $ne: 'cancelled' } }).sort({ start: 1, token: 1, createdAt: 1 }).lean(),
  ]);
  const views = await viewsOf(req.hospitalId, appts);
  const onLeave = leaveOn(schedule, on);
  const starts = onLeave ? [] : slotStarts(sessionsOn(schedule, on));
  const nowMinutes = on.getTime() === todayDay.getTime() ? hospitalMinutes() : on < todayDay ? 24 * 60 : -1;
  const slotSet = new Set(starts);
  const slots = starts.map((start) => {
    // A longer visit that began earlier still lasts through this slot.
    const busy = views.find((v) => v.kind === 'slot' && v.start && v.start !== start && coveredStarts(v.start, v.minutes).includes(start));
    return {
      start,
      past: minutesOf(start) < nowMinutes,
      appointments: views.filter((v) => v.kind === 'slot' && v.start === start),
      busyWith: busy ? { id: busy.id, start: busy.start, name: busy.patient?.name ?? busy.guest?.name ?? '' } : null,
    };
  });
  const isToday = on.getTime() === todayDay.getTime();
  return {
    doctor,
    date: isoDay(on),
    today: isoDay(todayDay),
    hasTimings: Boolean(schedule?.week?.some((w) => w.sessions?.length)),
    sessions: onLeave ? [] : sessionsOn(schedule, on).map((s) => ({ from: s.from, to: s.to })),
    leave: onLeave ? { from: isoDay(onLeave.from), to: isoDay(onLeave.to), note: onLeave.note ?? '' } : null,
    slots,
    // booked at a time that is no longer one of the doctor's slots, or with no time yet
    other: views.filter((v) => v.kind === 'slot' && (!v.start || !slotSet.has(v.start))),
    tokens: views.filter((v) => v.kind === 'token'),
    // today: who is waiting, in the order to call them
    waiting: isToday ? waitingOrder(views.filter((v) => v.status === 'arrived'), hospitalMinutes()) : [],
    lengths: Object.fromEntries(config.opd.visitTypes.map((t) => [t.key, lengthFor(schedule, t.key)])),
    canBook: canBook(req),
    canMarkSeen: canMarkSeen(req),
  };
}

export async function needsTime(req) {
  const appts = await Appointment.find({ hospitalId: req.hospitalId, kind: 'slot', status: 'booked', start: null, on: { $gte: today() } })
    .sort({ on: 1, createdAt: 1 })
    .limit(300)
    .lean();
  return { items: await viewsOf(req.hospitalId, appts), canBook: canBook(req) };
}

// ---------- Booking ----------

// Checks a time and returns how long the visit takes (null for "needs a time").
async function checkSlot(req, { doctor, on, start, visitType, patientId, exceptId = null, confirm }) {
  const todayDay = today();
  if (on < todayDay) throw fieldError('date', 'This day has passed.');
  if (on > addDays(todayDay, maxDaysAhead)) throw fieldError('date', `Book at most ${maxDaysAhead} days ahead.`);

  let minutes = null;
  if (start) {
    const schedule = await scheduleOf(req.hospitalId, doctor.id);
    minutes = lengthFor(schedule, visitType);
    const problem = slotCheck(schedule, on, start, minutes);
    const MESSAGES = {
      leave: `${doctor.name} is on leave that day.`,
      off: `${doctor.name} has no OPD that day.`,
      outside: `${start} is not one of ${doctor.name}'s slots that day.`,
      too_long: `This visit takes ${minutes} minutes and would run past the end of the session. Choose an earlier time.`,
    };
    if (problem !== 'ok') throw fieldError('start', MESSAGES[problem]);
    if (on.getTime() === todayDay.getTime() && minutesOf(start) < hospitalMinutes()) throw fieldError('start', 'This time has already passed.');

    const others = await Appointment.find({
      hospitalId: req.hospitalId,
      doctorId: doctor.id,
      on,
      kind: 'slot',
      status: { $in: ACTIVE },
      start: { $ne: null },
      ...(exceptId && { _id: { $ne: exceptId } }),
    }).lean();
    const taken = new Set(others.flatMap((a) => coveredStarts(a.start, a.minutes)));
    if (coveredStarts(start, minutes).some((s) => taken.has(s))) {
      throw new HttpError(409, 'This time is already taken. Choose another slot.', 'SLOT_TAKEN', { start: 'This time is already taken.' });
    }
  }

  if (patientId && !confirm) {
    const same = await Appointment.findOne({ hospitalId: req.hospitalId, patientId, on, status: { $in: ACTIVE }, ...(exceptId && { _id: { $ne: exceptId } }) }).lean();
    if (same) {
      throw new HttpError(409, `She already has an appointment that day${same.start ? ` at ${same.start}` : ''}. Book another anyway?`, 'ALREADY_BOOKED', undefined, { confirmable: true });
    }
  }
  return minutes;
}

async function activePatient(req, patientId) {
  const p = await Patient.findOne({ hospitalId: req.hospitalId, _id: patientId }).select('status').lean();
  if (!p) throw fieldError('patientId', 'Choose a patient of this hospital.');
  if (p.status !== 'active') throw fieldError('patientId', 'Her record is closed. Reopen it first.');
  return p._id;
}

export async function book(req, body) {
  assertCanBook(req);
  const doctor = await findDoctor(req.hospitalId, body.doctorId);
  const on = utcDay(body.date);
  const patientId = body.patientId ? await activePatient(req, body.patientId) : null;
  const minutes = await checkSlot(req, { doctor, on, start: body.start, visitType: body.visitType, patientId, confirm: body.confirm });
  const appt = await Appointment.create({
    hospitalId: req.hospitalId,
    patientId,
    guest: patientId ? null : body.guest,
    doctorId: toObjectId(doctor.id),
    on,
    kind: 'slot',
    start: body.start,
    minutes,
    visitType: body.visitType,
    source: 'booked',
    createdBy: req.user._id,
  });
  await recordAudit(req, 'APPOINTMENT_BOOKED', {
    hospitalId: req.hospitalId,
    details: { appointmentId: String(appt._id), ...(patientId && { patientId: String(patientId) }), doctorId: doctor.id, date: body.date },
  });
  const view = await viewOne(req.hospitalId, appt);
  await notify(req, [doctor.id], {
    type: 'NEW_APPOINTMENT',
    title: 'New appointment',
    message: `${view.patient?.name ?? view.guest?.name ?? 'A patient'} · ${body.date}${body.start ? ` at ${body.start}` : ' (time to be given)'}`,
    link: '/hospital/appointments',
  });
  return view;
}

async function findAppointment(req, id) {
  const appt = await Appointment.findOne({ hospitalId: req.hospitalId, _id: id });
  if (!appt) throw notFoundError('Appointment');
  return appt;
}

export async function move(req, id, body) {
  assertCanBook(req);
  const appt = await findAppointment(req, id);
  if (appt.kind === 'token') throw new HttpError(409, 'A walk-in token cannot be moved.', 'TOKEN');
  if (appt.status !== 'booked' || utcDay(appt.on) < today()) throw new HttpError(409, 'Only a booking that is still ahead can be moved.', 'NOT_MOVABLE');
  const doctor = await findDoctor(req.hospitalId, body.doctorId ?? appt.doctorId);
  const on = utcDay(body.date);
  const visitType = body.visitType ?? appt.visitType;
  const minutes = await checkSlot(req, { doctor, on, start: body.start, visitType, patientId: appt.patientId, exceptId: appt._id, confirm: body.confirm });
  const hadTime = Boolean(appt.start);
  appt.set({ doctorId: toObjectId(doctor.id), on, start: body.start, minutes, visitType, updatedBy: req.user._id, reminderSentAt: null });
  await appt.save();
  await recordAudit(req, hadTime ? 'APPOINTMENT_MOVED' : 'APPOINTMENT_BOOKED', {
    hospitalId: req.hospitalId,
    details: { appointmentId: id, doctorId: doctor.id, date: body.date },
  });
  return viewOne(req.hospitalId, appt);
}

export async function cancel(req, id, { reason, note }) {
  assertCanBook(req);
  const appt = await findAppointment(req, id);
  if (appt.status === 'cancelled') return viewOne(req.hospitalId, appt);
  if (appt.status === 'seen') throw new HttpError(409, 'She has already been seen.', 'SEEN');
  appt.set({ status: 'cancelled', cancelled: { reason, note, by: req.user._id, at: new Date() }, updatedBy: req.user._id });
  await appt.save();
  await recordAudit(req, 'APPOINTMENT_CANCELLED', { hospitalId: req.hospitalId, details: { appointmentId: id, reason } });
  return viewOne(req.hospitalId, appt);
}

// A quick booking is linked to the patient once she is registered.
export async function link(req, id, patientId) {
  assertCanBook(req);
  const appt = await findAppointment(req, id);
  if (appt.patientId) throw new HttpError(409, 'This appointment already belongs to a registered patient.', 'LINKED');
  appt.set({ patientId: await activePatient(req, patientId), guest: null, updatedBy: req.user._id });
  await appt.save();
  await recordAudit(req, 'APPOINTMENT_LINKED', { hospitalId: req.hospitalId, details: { appointmentId: id, patientId } });
  return viewOne(req.hospitalId, appt);
}

// ---------- The day itself: arrivals, walk-ins, seen ----------

function assertToday(appt) {
  if (utcDay(appt.on).getTime() !== today().getTime()) throw new HttpError(409, 'Only today’s appointments can be marked.', 'NOT_TODAY');
}

export async function arrive(req, id) {
  const appt = await findAppointment(req, id);
  assertToday(appt);
  if (appt.status !== 'booked') throw new HttpError(409, 'This appointment is not waiting for an arrival.', 'NOT_BOOKED');
  if (!appt.patientId) throw new HttpError(409, 'Register her and link this quick booking first.', 'NOT_REGISTERED');
  appt.set({ status: 'arrived', arrivedAt: new Date(), updatedBy: req.user._id });
  await appt.save();
  await recordAudit(req, 'APPOINTMENT_ARRIVED', { hospitalId: req.hospitalId, details: { appointmentId: id, patientId: String(appt.patientId) } });
  const view = await viewOne(req.hospitalId, appt);
  await notify(req, [appt.doctorId], { type: 'PATIENT_ARRIVED', title: 'Patient arrived', message: `${view.patient?.name ?? 'A patient'} is waiting`, link: '/hospital/appointments' });
  return view;
}

export async function undoArrival(req, id) {
  const appt = await findAppointment(req, id);
  assertToday(appt);
  if (appt.status !== 'arrived') throw new HttpError(409, 'She is not marked as arrived.', 'NOT_ARRIVED');
  // A walk-in token is only an arrival: undoing it cancels it (its number is never given again).
  if (appt.kind === 'token') appt.set({ status: 'cancelled', cancelled: { reason: 'other', note: 'Arrival undone', by: req.user._id, at: new Date() } });
  else appt.set({ status: 'booked', arrivedAt: null });
  appt.updatedBy = req.user._id;
  await appt.save();
  await recordAudit(req, 'APPOINTMENT_ARRIVAL_UNDONE', { hospitalId: req.hospitalId, details: { appointmentId: id } });
  return viewOne(req.hospitalId, appt);
}

export async function markSeen(req, id) {
  if (!canMarkSeen(req)) throw new HttpError(403, 'Doctors, RMOs and nurses mark a patient as seen.', 'FORBIDDEN');
  const appt = await findAppointment(req, id);
  assertToday(appt);
  if (appt.status !== 'arrived') throw new HttpError(409, 'Mark her as arrived first.', 'NOT_ARRIVED');
  appt.set({ status: 'seen', seenAt: new Date(), updatedBy: req.user._id });
  await appt.save();
  await recordAudit(req, 'APPOINTMENT_SEEN', { hospitalId: req.hospitalId, details: { appointmentId: id, patientId: String(appt.patientId) } });
  return viewOne(req.hospitalId, appt);
}

// A walk-in: she arrives without a booking and gets the next token number of the doctor's day.
export async function giveToken(req, { doctorId, patientId }) {
  assertCanBook(req);
  const doctor = await findDoctor(req.hospitalId, doctorId);
  const pid = await activePatient(req, patientId);
  const on = today();
  const already = await Appointment.findOne({ hospitalId: req.hospitalId, patientId: pid, doctorId: doctor.id, on, status: 'arrived' }).lean();
  if (already) throw new HttpError(409, 'She is already waiting for this doctor.', 'ALREADY_WAITING');
  // She has a booking with this doctor today: that booking is marked arrived, no second token.
  const booked = await Appointment.findOne({ hospitalId: req.hospitalId, patientId: pid, doctorId: doctor.id, on, status: 'booked', kind: 'slot' });
  if (booked) return arrive(req, String(booked._id));
  const { seq } = await Counter.findOneAndUpdate(
    { hospitalId: req.hospitalId, name: `token:${doctor.id}:${isoDay(on)}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  const appt = await Appointment.create({
    hospitalId: req.hospitalId,
    patientId: pid,
    doctorId: toObjectId(doctor.id),
    on,
    kind: 'token',
    token: seq,
    visitType: 'other',
    status: 'arrived',
    arrivedAt: new Date(),
    source: 'walk_in',
    createdBy: req.user._id,
  });
  await recordAudit(req, 'APPOINTMENT_ARRIVED', { hospitalId: req.hospitalId, details: { appointmentId: String(appt._id), patientId: String(pid), token: seq } });
  const view = await viewOne(req.hospitalId, appt);
  await notify(req, [doctor.id], { type: 'PATIENT_ARRIVED', title: 'Walk-in patient', message: `${view.patient?.name ?? 'A patient'} · token ${seq}`, link: '/hospital/appointments' });
  return view;
}

// ---------- A patient's appointments ----------

export async function forPatient(req, patientId) {
  const patient = await Patient.findOne({ hospitalId: req.hospitalId, _id: patientId }).lean();
  if (!patient || recordLevel(req, patient) === 'none') throw notFoundError('Patient');
  const appts = await Appointment.find({ hospitalId: req.hospitalId, patientId }).sort({ on: -1, start: -1 }).limit(50).lean();
  return { items: await viewsOf(req.hospitalId, appts), canBook: canBook(req) };
}

// ---------- Reminders ----------

// Booked times of a day for patients who agreed to reminders, with a message that names no medical detail. Staff
// send it from their phone and mark it sent (no SMS service is connected).
export async function reminders(req, date) {
  const on = utcDay(date);
  const appts = await Appointment.find({ hospitalId: req.hospitalId, on, kind: 'slot', status: 'booked', patientId: { $ne: null } })
    .sort({ start: 1 })
    .limit(500)
    .lean();
  const agreed = new Set(
    (await Patient.find({ hospitalId: req.hospitalId, _id: { $in: appts.map((a) => a.patientId) }, consentMessages: true }).select('_id').lean()).map((p) => String(p._id)),
  );
  const views = await viewsOf(req.hospitalId, appts.filter((a) => agreed.has(String(a.patientId))));
  const hospital = req.hospital.name;
  const dateWords = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(on);
  return {
    date: isoDay(on),
    notAgreed: appts.length - views.length,
    items: views.map((v) => ({
      ...v,
      message: `Reminder from ${hospital}: your appointment with ${v.doctor.name} is on ${dateWords}${v.start ? ` at ${v.start}` : ''}. Please come 10 minutes early.`,
    })),
    canSend: canBook(req),
  };
}

export async function markReminderSent(req, id) {
  assertCanBook(req);
  const appt = await findAppointment(req, id);
  appt.set({ reminderSentAt: new Date(), updatedBy: req.user._id });
  await appt.save();
  await recordAudit(req, 'APPOINTMENT_REMINDER_SENT', { hospitalId: req.hospitalId, details: { appointmentId: id } });
  return viewOne(req.hospitalId, appt);
}

// ---------- For other modules ----------

// Patients to book (name and number only).
export const findPatients = (req, search) => pickPatients(req.hospitalId, search);

// Today's appointments of one doctor, for the Today page: the counts and who is waiting.
export async function todayFor(hospitalId, doctorId) {
  const appts = await Appointment.find({ hospitalId, doctorId, on: today(), status: { $ne: 'cancelled' } }).lean();
  const views = await viewsOf(hospitalId, appts);
  const count = (s) => views.filter((v) => v.status === s).length;
  return {
    total: views.length,
    booked: count('booked'),
    arrived: count('arrived'),
    seen: count('seen'),
    waiting: waitingOrder(views.filter((v) => v.status === 'arrived'), hospitalMinutes()).slice(0, 10),
    next: views.filter((v) => v.status === 'booked' && v.start).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 5),
    now: hhmm(hospitalMinutes()),
  };
}
