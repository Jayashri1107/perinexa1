import { Router } from 'express';
import { z } from 'zod';
import { BOOKING_ROLES, CANCEL_REASONS, MAX_LEAVE_DAYS, MAX_LEAVE_ENTRIES, MAX_SESSIONS_PER_DAY, PATIENT_APPOINTMENT_ROLES, QUEUE_ROLES, SLOT_MINUTES, VISIT_LENGTHS, VISIT_TYPES } from '../appointments/appointmentRules.js';
import {
  bookSlot,
  cancelAppointment,
  dayStates,
  findAppointment,
  hospitalDoctor,
  hospitalDoctors,
  linkPatient,
  moveSlot,
  placeWaitingNextVisits,
  statesFor,
  statusOf,
  viewsOf,
} from '../appointments/appointmentService.js';
import { coveredStarts, hospitalMinutes, leaveOn, lengthFor, sessionsOn, slotCheck, slotStarts, timetableProblems, waitingOrder } from '../appointments/slots.js';
import { MODE_LABELS, PAYMENT_MODES } from '../billing/billingRules.js';
import { appointmentFeeItem, takeAppointmentFee } from '../billing/billingService.js';
import { addDays, daysBetween, hospitalToday, isoDay, utcDay } from '../careplans/dates.js';
import { Appointment } from '../models/Appointment.js';
import { hasRole } from '../models/Membership.js';
import { OpdSchedule } from '../models/OpdSchedule.js';
import { Patient } from '../models/Patient.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { isDuplicate } from '../patients/duplicateRules.js';
import { isClosed } from '../patients/deathRules.js';
import { objectId, parse, requiredDateOnly } from '../utils/validate.js';

// Appointment booking (docs/APPOINTMENTS_PLAN.md, approved 3 Oct 2026):
//  - GET  /api/appointments/doctors            the hospital's doctors, who has OPD timings, what this person may do
//  - GET  /api/appointments/timings/:doctorId  a doctor's OPD timings and leave; PUT changes them (the doctor
//                                              themself, or a hospital admin)
//  - GET  /api/appointments/day                one doctor's day: the slots, who is booked, the walk-in tokens
//  - GET  /api/appointments/month              one doctor's month: each day's sessions with free / taken slots, and
//                                              how many were booked, seen and cancelled (counts only, no names)
//  - GET  /api/appointments/needs-time         next visits the app could not place – reception gives them a time
//  - GET  /api/appointments/queue              today's waiting list of each doctor, in the order to call them
//  - GET  /api/appointments/patient/:patientId a patient's appointments (her record's Appointments tab)
//  - POST /api/appointments                    book (reception and doctors); /:id/move, /:id/cancel, /:id/link
// Nothing medical: names, patient numbers, phones, doctors, days, times and visit types. Every booking, move,
// cancellation and change of timings is in the audit log (ids only).

export const appointmentsRouter = Router();

const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const canBook = (req) => hasRole(req.membership, ...BOOKING_ROLES);
const assertCanBook = (req) => {
  if (!canBook(req)) throw forbidden('Appointments are booked by reception and doctors.');
};
const isAdmin = (req) => hasRole(req.membership, 'admin');
const canEditTimings = (req, doctorId) => isAdmin(req) || (hasRole(req.membership, 'doctor') && String(req.user._id) === String(doctorId));

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Please enter a time like 10:30.');
const ids = (a, extra = {}) => ({ appointmentId: String(a._id), ...(a.patientId ? { patientId: String(a.patientId) } : {}), doctorId: String(a.doctorId), date: isoDay(a.on), ...extra });

async function viewOf(req, appt) {
  const [view] = await viewsOf(req.tenantId, [appt.toObject ? appt.toObject() : appt], hospitalToday(req.now));
  return view;
}

// ---------- Doctors and OPD timings ----------

appointmentsRouter.get('/doctors', async (req, res) => {
  if (!hasRole(req.membership, ...QUEUE_ROLES, 'admin')) throw forbidden('Appointments are for hospital staff.');
  const doctors = await hospitalDoctors(req.tenantId);
  const schedules = await OpdSchedule.find({ tenantId: req.tenantId }, { doctorId: 1, week: 1 }).lean();
  const withTimings = new Set(schedules.filter((s) => s.week?.some((w) => w.sessions?.length)).map((s) => String(s.doctorId)));
  res.json({
    doctors: doctors.map((d) => ({ ...d, hasTimings: withTimings.has(d.id), canEditTimings: canEditTimings(req, d.id) })),
    me: hasRole(req.membership, 'doctor') ? String(req.user._id) : null,
    canBook: canBook(req),
    slotMinutes: SLOT_MINUTES,
    today: isoDay(hospitalToday(req.now)),
  });
});

const sessionSchema = z.object({ from: time, to: time }).strict();
const timingsSchema = z
  .object({
    week: z
      .array(z.object({ day: z.number().int().min(0).max(6), sessions: z.array(sessionSchema).max(MAX_SESSIONS_PER_DAY, `At most ${MAX_SESSIONS_PER_DAY} sessions a day.`) }).strict())
      .max(7)
      .refine((w) => new Set(w.map((d) => d.day)).size === w.length, 'Each day only once.'),
    leave: z
      .array(z.object({ from: requiredDateOnly('Leave from'), to: requiredDateOnly('Leave to'), note: z.string().trim().max(100).default('') }).strict())
      .max(MAX_LEAVE_ENTRIES, `At most ${MAX_LEAVE_ENTRIES} leave entries.`),
    // Minutes a visit of each type takes (whole slots). Left out: the lengths stay as they are.
    lengths: z
      .object(Object.fromEntries(VISIT_TYPES.map((t) => [t, z.number().refine((n) => VISIT_LENGTHS.includes(n), 'Choose one of the lengths offered.')])))
      .strict()
      .optional(),
  })
  .strict();

const timingsView = (s) => ({
  week: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, sessions: (s?.week?.find((w) => w.day === day)?.sessions ?? []).map((x) => ({ from: x.from, to: x.to })) })),
  leave: (s?.leave ?? []).map((l) => ({ from: isoDay(l.from), to: isoDay(l.to), note: l.note ?? '' })),
  lengths: Object.fromEntries(VISIT_TYPES.map((t) => [t, lengthFor(s, t)])),
  updatedByName: s?.updatedByName ?? '',
  updatedAt: s?.updatedAt ?? null,
});

appointmentsRouter.get('/timings/:doctorId', async (req, res) => {
  if (!hasRole(req.membership, ...QUEUE_ROLES, 'admin')) throw forbidden('Appointments are for hospital staff.');
  const { doctorId } = parse(z.object({ doctorId: objectId }), req.params);
  const doctor = await hospitalDoctor(req.tenantId, doctorId);
  const schedule = await OpdSchedule.findOne({ tenantId: req.tenantId, doctorId }).lean();
  res.json({ doctor, timings: timingsView(schedule), canEdit: canEditTimings(req, doctorId), slotMinutes: SLOT_MINUTES, visitLengths: VISIT_LENGTHS });
});

appointmentsRouter.put('/timings/:doctorId', async (req, res) => {
  const { doctorId } = parse(z.object({ doctorId: objectId }), req.params);
  if (!canEditTimings(req, doctorId)) throw forbidden('Doctors set their own OPD timings (or the hospital admin does).');
  const doctor = await hospitalDoctor(req.tenantId, doctorId);
  const body = parse(timingsSchema, req.body);
  const problems = timetableProblems(body);
  for (const l of body.leave) if (daysBetween(l.from, l.to) + 1 > MAX_LEAVE_DAYS) problems.push(`A leave can be at most ${MAX_LEAVE_DAYS} days.`);
  if (problems.length) throw new HttpError(400, problems.join(' '), 'TIMINGS');
  const today = hospitalToday(req.now);
  const week = body.week.map((w) => ({ day: w.day, sessions: [...w.sessions].sort((a, b) => a.from.localeCompare(b.from)) }));
  // Leave that has ended is dropped; the rest in order.
  const leave = body.leave.filter((l) => l.to >= today).sort((a, b) => a.from - b.from);
  const schedule = await OpdSchedule.findOneAndUpdate(
    { tenantId: req.tenantId, doctorId },
    { $set: { week, leave, ...(body.lengths ? { lengths: body.lengths } : {}), updatedBy: req.user._id, updatedByName: req.user.name }, $setOnInsert: { tenantId: req.tenantId, doctorId } },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  await audit(req, 'OPD_TIMINGS_CHANGED', { details: { doctorId: String(doctorId), days: week.filter((w) => w.sessions.length).length, leave: leave.length } });
  // Next visits that were waiting for a time get one now, where the new timings allow
  const placed = await placeWaitingNextVisits(req, doctorId);
  // Bookings from today on that no longer fit (leave, no OPD that day, or outside the hours): reception moves them.
  const ahead = await Appointment.find({ tenantId: req.tenantId, doctorId, on: { $gte: today }, kind: 'slot', status: 'booked', start: { $ne: null } }).sort({ on: 1, start: 1 }).limit(500).lean();
  const affected = ahead.filter((a) => slotCheck(schedule, a.on, a.start, a.minutes ?? SLOT_MINUTES) !== 'ok');
  res.json({ doctor, timings: timingsView(schedule), canEdit: true, slotMinutes: SLOT_MINUTES, visitLengths: VISIT_LENGTHS, placed, affected: await viewsOf(req.tenantId, affected, today) });
});

// ---------- One doctor's day ----------

const dayQuery = z.object({ doctorId: objectId, date: requiredDateOnly('Date') }).strict();

appointmentsRouter.get('/day', async (req, res) => {
  if (!hasRole(req.membership, ...QUEUE_ROLES)) throw forbidden('Appointments are for hospital staff.');
  const q = parse(dayQuery, req.query);
  const doctor = await hospitalDoctor(req.tenantId, q.doctorId);
  const day = utcDay(q.date);
  const today = hospitalToday(req.now);
  const schedule = await OpdSchedule.findOne({ tenantId: req.tenantId, doctorId: q.doctorId }).lean();
  const appts = await Appointment.find({ tenantId: req.tenantId, doctorId: q.doctorId, on: day, status: 'booked' }).sort({ start: 1, token: 1, createdAt: 1 }).lean();
  const views = await viewsOf(req.tenantId, appts, today);
  const starts = slotStarts(sessionsOn(schedule, day));
  const onLeave = leaveOn(schedule, day);
  const nowMinutes = day.getTime() === today.getTime() ? hospitalMinutes(req.now) : day < today ? 24 * 60 : -1;
  const slotSet = new Set(onLeave ? [] : starts);
  const slots = onLeave
    ? []
    : starts.map((start) => {
        const [h, m] = start.split(':').map(Number);
        // A longer visit that began earlier still lasts through this slot: it is not free
        const busy = views.find((v) => v.kind === 'slot' && v.start && v.start !== start && coveredStarts(v.start, v.minutes).includes(start));
        return {
          start,
          past: h * 60 + m < nowMinutes,
          appointments: views.filter((v) => v.kind === 'slot' && v.start === start),
          busyWith: busy ? { id: busy.id, start: busy.start, name: busy.patient?.fullName ?? busy.guest?.name ?? '' } : null,
        };
      });
  res.json({
    doctor,
    date: isoDay(day),
    today: isoDay(today),
    hasTimings: Boolean(schedule?.week?.some((w) => w.sessions?.length)),
    sessions: onLeave ? [] : sessionsOn(schedule, day).map((s) => ({ from: s.from, to: s.to })),
    leave: onLeave ? { from: isoDay(onLeave.from), to: isoDay(onLeave.to), note: onLeave.note ?? '' } : null,
    slots,
    // Booked at a time that is no longer one of the doctor's slots (timings changed), or still with no time.
    other: views.filter((v) => v.kind === 'slot' && (!v.start || !slotSet.has(v.start))),
    tokens: views.filter((v) => v.kind === 'token'),
    canBook: canBook(req),
    canTakeFee: canTakeFee(req),
    slotMinutes: SLOT_MINUTES,
    lengths: Object.fromEntries(VISIT_TYPES.map((t) => [t, lengthFor(schedule, t)])),
  });
});

// ---------- The front desk's day (owner, 14 Oct 2026) ----------
// Reception's Today: each doctor's OPD today (hours, leave, how many booked / arrived / seen / waiting), and
// tomorrow's bookings with a phone number, to call and confirm. The same views as the day schedule (not audited, as
// /day is not).
appointmentsRouter.get('/desk', async (req, res) => {
  // The hospital admin (no patient data): each doctor's OPD today and the counts only – not tomorrow's list
  const countsOnly = !hasRole(req.membership, ...QUEUE_ROLES) && hasRole(req.membership, 'admin');
  if (!countsOnly && !hasRole(req.membership, ...QUEUE_ROLES)) throw forbidden('Appointments are for hospital staff.');
  const today = hospitalToday(req.now);
  const tomorrow = addDays(today, 1);
  const [doctors, schedules, todayAppts, tomorrowAppts] = await Promise.all([
    hospitalDoctors(req.tenantId),
    OpdSchedule.find({ tenantId: req.tenantId }).lean(),
    Appointment.find({ tenantId: req.tenantId, on: today, status: 'booked' }).lean(),
    Appointment.find({ tenantId: req.tenantId, on: tomorrow, status: 'booked', kind: 'slot' }).sort({ start: 1, createdAt: 1 }).lean(),
  ]);
  const todayViews = await viewsOf(req.tenantId, todayAppts, today);
  const scheduleOf = new Map(schedules.map((s) => [String(s.doctorId), s]));
  const desk = doctors.map((d) => {
    const schedule = scheduleOf.get(d.id) ?? null;
    const onLeave = leaveOn(schedule, today);
    const mine = todayViews.filter((v) => v.doctor?.id === d.id);
    const count = (status) => mine.filter((v) => v.status === status).length;
    return {
      id: d.id,
      name: d.name,
      hasTimings: Boolean(schedule?.week?.some((w) => w.sessions?.length)),
      sessions: onLeave ? [] : sessionsOn(schedule, today).map((s) => ({ from: s.from, to: s.to })),
      leave: onLeave ? { to: isoDay(onLeave.to), note: onLeave.note ?? '' } : null,
      expected: count('booked'),
      waiting: count('arrived'),
      seen: count('seen'),
    };
  });
  if (countsOnly) return res.json({ today: isoDay(today), tomorrow: isoDay(tomorrow), doctors: desk, tomorrowList: [], countsOnly: true });
  const tomorrowViews = await viewsOf(req.tenantId, tomorrowAppts, today);
  res.json({ today: isoDay(today), tomorrow: isoDay(tomorrow), doctors: desk, tomorrowList: tomorrowViews });
});

// ---------- A doctor's month (owner, 13 Oct 2026: the slot calendar) ----------

const monthQuery = z.object({ doctorId: objectId, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month as YYYY-MM') }).strict();

appointmentsRouter.get('/month', async (req, res) => {
  if (!hasRole(req.membership, ...QUEUE_ROLES)) throw forbidden('Appointments are for hospital staff.');
  const q = parse(monthQuery, req.query);
  const doctor = await hospitalDoctor(req.tenantId, q.doctorId);
  const [y, m] = q.month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const next = new Date(Date.UTC(y, m, 1));
  const today = hospitalToday(req.now);
  const schedule = await OpdSchedule.findOne({ tenantId: req.tenantId, doctorId: q.doctorId }).lean();
  const appts = await Appointment.find({ tenantId: req.tenantId, doctorId: q.doctorId, on: { $gte: first, $lt: next } }, { on: 1, start: 1, minutes: 1, kind: 1, status: 1, patientId: 1 }).lean();
  const states = await statesFor(req.tenantId, appts.filter((a) => a.status === 'booked'));
  const days = [];
  for (let d = first; d < next; d = new Date(d.getTime() + 86400000)) {
    const key = isoDay(d);
    const mine = appts.filter((a) => isoDay(a.on) === key);
    const booked = mine.filter((a) => a.status === 'booked');
    const taken = new Set(booked.filter((a) => a.kind === 'slot' && a.start).flatMap((a) => coveredStarts(a.start, a.minutes ?? SLOT_MINUTES)));
    const onLeave = schedule ? leaveOn(schedule, d) : null;
    const sessions = onLeave || !schedule ? [] : sessionsOn(schedule, d);
    const count = (status) => booked.filter((a) => statusOf(a, a.patientId ? states.get(`${a.patientId}:${key}`) : null, today) === status).length;
    days.push({
      date: key,
      past: d < today,
      leave: Boolean(onLeave),
      sessions: sessions.map((s) => {
        const starts = slotStarts([s]);
        return { from: s.from, to: s.to, slots: starts.length, taken: starts.filter((t) => taken.has(t)).length };
      }),
      counts: { booked: count('booked') + count('arrived'), seen: count('seen'), noShow: count('no_show'), cancelled: mine.filter((a) => a.status === 'cancelled').length, tokens: booked.filter((a) => a.kind === 'token').length },
    });
  }
  res.json({ doctor, month: q.month, today: isoDay(today), hasTimings: Boolean(schedule?.week?.some((w) => w.sessions?.length)), slotMinutes: SLOT_MINUTES, days });
});

// ---------- Needs a time ----------

appointmentsRouter.get('/needs-time', async (req, res) => {
  if (!hasRole(req.membership, ...QUEUE_ROLES)) throw forbidden('Appointments are for hospital staff.');
  const today = hospitalToday(req.now);
  const appts = await Appointment.find({ tenantId: req.tenantId, kind: 'slot', status: 'booked', start: null, on: { $gte: today } }).sort({ on: 1, createdAt: 1 }).limit(300).lean();
  res.json({ appointments: await viewsOf(req.tenantId, appts, today), canBook: canBook(req) });
});

// ---------- Today's waiting lists ----------

/**
 * Today's waiting list of each doctor (owner: booked patients go in at their time, walk-ins fill the gaps in token
 * order): who has arrived and not yet been seen, in the order to call them; also who is still expected.
 */
export const queuesFor = async (req) => ({ ...(await queuesOf(req.tenantId, req.now)), me: hasRole(req.membership, 'doctor') ? String(req.user._id) : null });

/** The waiting lists of a hospital today (also for the waiting-room screen, which shows no names). */
export async function queuesOf(tenantId, now) {
  const today = hospitalToday(now);
  const appts = await Appointment.find({ tenantId, on: today, status: 'booked' }).lean();
  const views = await viewsOf(tenantId, appts, today);
  const nowMinutes = hospitalMinutes(now);
  const doctors = await hospitalDoctors(tenantId);
  const queues = doctors
    .map((d) => {
      const mine = views.filter((v) => v.doctor.id === d.id);
      const waiting = waitingOrder(mine.filter((v) => v.status === 'arrived'), nowMinutes);
      const expected = mine.filter((v) => v.status === 'booked').sort((a, b) => (a.start ?? '99:99').localeCompare(b.start ?? '99:99'));
      return { doctor: d, waiting, expected, seen: mine.filter((v) => v.status === 'seen').length, tokens: mine.filter((v) => v.kind === 'token').length };
    })
    .filter((q) => q.waiting.length || q.expected.length || q.seen);
  return { today: isoDay(today), now: `${String(Math.floor(nowMinutes / 60)).padStart(2, '0')}:${String(nowMinutes % 60).padStart(2, '0')}`, queues };
}

appointmentsRouter.get('/queue', async (req, res) => {
  if (!hasRole(req.membership, ...QUEUE_ROLES)) throw forbidden('The waiting lists are for doctors, RMOs, nurses and reception.');
  res.json(await queuesFor(req));
});

// ---------- A patient's appointments ----------

appointmentsRouter.get('/patient/:patientId', async (req, res) => {
  if (!hasRole(req.membership, ...PATIENT_APPOINTMENT_ROLES)) throw forbidden("Your role doesn't include appointments.");
  const { patientId } = parse(z.object({ patientId: objectId }), req.params);
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: patientId });
  if (!patient) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  if (!patientAccess(req, patient).view.has('phone')) throw forbidden("You can't see this patient's appointments.");
  const appts = await Appointment.find({ tenantId: req.tenantId, patientId }).sort({ on: -1, start: -1, token: -1 }).limit(200).lean();
  const today = hospitalToday(req.now);
  const views = await viewsOf(req.tenantId, appts, today);
  res.json({
    upcoming: views.filter((v) => v.date >= isoDay(today) && !['cancelled', 'seen'].includes(v.status)).reverse(),
    past: views.filter((v) => !(v.date >= isoDay(today) && !['cancelled', 'seen'].includes(v.status))),
    // a record marked as a duplicate, or closed after a death, takes no new appointment
    canBook: canBook(req) && !isDuplicate(patient) && !isClosed(patient),
    canTakeFee: canTakeFee(req),
  });
});

// The patient card (reception): printed in the browser; recorded here (ids only – never what was printed).
appointmentsRouter.post('/patient/:patientId/card-printed', async (req, res) => {
  if (!hasRole(req.membership, ...PATIENT_APPOINTMENT_ROLES)) throw forbidden("Your role doesn't include printing patient cards.");
  const { patientId } = parse(z.object({ patientId: objectId }), req.params);
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: patientId });
  if (!patient) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  if (!patientAccess(req, patient).view.has('phone')) throw forbidden("You can't print this patient's card.");
  await audit(req, 'PATIENT_CARD_PRINTED', { details: { patientId: String(patient._id), mrn: patient.mrn } });
  res.json({ ok: true });
});

// ---------- Book, move, cancel, link ----------

const bookSchema = z
  .object({
    doctorId: objectId,
    date: requiredDateOnly('Date'),
    start: time,
    patientId: objectId.optional(),
    guest: z.object({ name: z.string().trim().min(2, 'Please enter her name.').max(150), phone: z.string().trim().min(6, 'Please enter a phone number.').max(30) }).strict().optional(),
    visitType: z.enum(VISIT_TYPES).default('follow_up'),
    confirm: z.boolean().default(false),
  })
  .strict()
  .refine((b) => Boolean(b.patientId) !== Boolean(b.guest), { message: 'Choose a patient, or enter a new patient’s name and phone.', path: ['patientId'] });

appointmentsRouter.post('/', async (req, res) => {
  assertCanBook(req);
  const body = parse(bookSchema, req.body);
  const appt = await bookSlot(req, body);
  await audit(req, 'APPOINTMENT_BOOKED', { details: ids(appt, { start: appt.start, quick: !appt.patientId }) });
  res.status(201).json({ appointment: await viewOf(req, appt) });
});

const moveSchema = z
  .object({ doctorId: objectId.optional(), date: requiredDateOnly('Date'), start: time, visitType: z.enum(VISIT_TYPES).optional(), confirm: z.boolean().default(false) })
  .strict();

appointmentsRouter.post('/:id/move', async (req, res) => {
  assertCanBook(req);
  const { id } = parse(z.object({ id: objectId }), req.params);
  const body = parse(moveSchema, req.body);
  const appt = await findAppointment(req, id);
  const from = { date: isoDay(appt.on), start: appt.start, doctorId: String(appt.doctorId) };
  await moveSlot(req, appt, body);
  await audit(req, 'APPOINTMENT_MOVED', { details: ids(appt, { start: appt.start, from }) });
  res.json({ appointment: await viewOf(req, appt) });
});

appointmentsRouter.post('/:id/cancel', async (req, res) => {
  assertCanBook(req);
  const { id } = parse(z.object({ id: objectId }), req.params);
  const { reason } = parse(z.object({ reason: z.enum(CANCEL_REASONS) }).strict(), req.body);
  const appt = await findAppointment(req, id);
  const today = hospitalToday(req.now);
  if (appt.status === 'cancelled') throw new HttpError(409, 'This appointment was already cancelled.', 'CANCELLED');
  if (utcDay(appt.on) < today) throw new HttpError(409, 'This appointment is in the past.', 'PAST');
  if (appt.patientId) {
    const states = await dayStates(req.tenantId, [appt.patientId], appt.on);
    const status = statusOf(appt, states.get(String(appt.patientId)), today);
    if (status !== 'booked') throw new HttpError(409, status === 'seen' ? 'She has already been seen.' : 'She has arrived. Undo the arrival on the Today page first.', 'ARRIVED');
  }
  await cancelAppointment(req, appt, reason);
  await audit(req, 'APPOINTMENT_CANCELLED', { details: ids(appt, { reason }) });
  res.json({ appointment: await viewOf(req, appt) });
});

// ---------- The consultation fee, taken when booking (owner, 4 Oct 2026) ----------
// Reception may take the consultation fee in advance for a registered patient's New or Follow-up appointment: it
// goes on her bill of that day, paid, with a receipt, and her visit adds no second consultation. Cancelling the
// appointment takes the charge off; the money then shows as due back on the bill for reception to give back.

const canTakeFee = (req) => hasRole(req.membership, 'receptionist');
const assertCanTakeFee = (req) => {
  if (!canTakeFee(req)) throw forbidden('Fees are taken by reception.');
};

appointmentsRouter.get('/:id/fee', async (req, res) => {
  assertCanTakeFee(req);
  const { id } = parse(z.object({ id: objectId }), req.params);
  const appt = await findAppointment(req, id);
  const item = await appointmentFeeItem(req.tenantId, appt);
  res.json({ name: item.name, amountPaise: item.pricePaise, modes: PAYMENT_MODES.map((m) => ({ value: m, label: MODE_LABELS[m] })) });
});

const feeSchema = z
  .object({ mode: z.enum(PAYMENT_MODES), reference: z.string().trim().max(80).default(''), scheme: z.string().trim().max(80).default('') })
  .strict()
  .refine((b) => b.mode !== 'insurance' || b.scheme.length >= 2, { message: 'Write the name of the insurance company or scheme.', path: ['scheme'] });

appointmentsRouter.post('/:id/fee', async (req, res) => {
  assertCanTakeFee(req);
  const { id } = parse(z.object({ id: objectId }), req.params);
  const body = parse(feeSchema, req.body);
  const appt = await findAppointment(req, id);
  if (utcDay(appt.on) < hospitalToday(req.now)) throw new HttpError(409, 'This appointment is in the past.', 'PAST');
  const { bill, receipt, amountPaise } = await takeAppointmentFee(req, appt, body);
  await audit(req, 'PAYMENT_RECEIVED', { details: { billId: String(bill._id), number: bill.number, patientId: String(appt.patientId), appointmentId: String(appt._id), receipt, kind: 'payment', mode: body.mode, amountPaise } });
  res.status(201).json({ appointment: await viewOf(req, appt), receipt, billId: String(bill._id) });
});

// A quick booking's patient was registered: the booking joins her record.
appointmentsRouter.post('/:id/link', async (req, res) => {
  if (!hasRole(req.membership, 'receptionist', 'doctor', 'rmo')) throw forbidden('Only those who register patients can do this.');
  const { id } = parse(z.object({ id: objectId }), req.params);
  const { patientId } = parse(z.object({ patientId: objectId }).strict(), req.body);
  const appt = await findAppointment(req, id);
  await linkPatient(req, appt, patientId);
  await audit(req, 'APPOINTMENT_LINKED', { details: ids(appt) });
  res.json({ appointment: await viewOf(req, appt) });
});
