import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { bookSlot, cancelAppointment, freeStarts, hospitalDoctors, nextAppointment } from '../appointments/appointmentService.js';
import { Appointment } from '../models/Appointment.js';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config.js';
import { addDays, hospitalToday, isoDay, utcDay } from '../careplans/dates.js';
import { portalPlanItems } from '../careplans/plansService.js';
import { hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { PortalAccess } from '../models/PortalAccess.js';
import { Tenant } from '../models/Tenant.js';
import { Visit } from '../models/Visit.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { isDuplicate } from '../patients/duplicateRules.js';
import { isClosed, refuseNewOnClosed } from '../patients/deathRules.js';
import { patientAccess } from '../utils/patientAccess.js';
import { findPatient } from '../utils/patientLookup.js';
import { parse, requiredDateOnly } from '../utils/validate.js';
import { letterheadFor } from './settings.js';

// The patient portal (Version 2) – deliberately small, because it opens patient information to the internet:
//  - off until the hospital admin switches it on (Hospital admin → Patient messages);
//  - staff (doctors, RMOs, nurses, reception) make an access code for a patient and hand it to her on paper;
//  - she signs in with the code and the last 4 digits of her mobile number; 5 wrong tries lock the code for 30
//    minutes, and sign-ins are rate-limited per computer;
//  - she sees only her next appointment and the upcoming items of her care plan in plain words, and the hospital's
//    phone – never results, notes, diagnoses, risk, documents or anything typed by staff;
//  - she reads it in English, Marathi or Hindi (5 Oct 2026): the page's own words and the built-in care-plan items are
//    translated in the browser (DRAFT wording); an item a doctor added or reworded is shown as typed;
//  - her session is a separate cookie with its own signing key (it can never open a staff page), ends after 15
//    minutes, and every sign-in, failed try and view is in the audit log (ids only);
//  - when the hospital admin also switched on online booking (4 Oct 2026), she may book ONE appointment with her own
//    doctor, from tomorrow up to 30 days ahead, in a free time of the doctor's OPD, and cancel a booking she made
//    online. She never sees who else is booked – only which times are free.

export const portalRouter = Router(); // /api/portal (no staff login)
export const patientPortalAccessRouter = Router({ mergeParams: true }); // /api/patients/:id/portal-access

const PORTAL_COOKIE = 'perinexa_portal';
const SESSION_MINUTES = 15;
const CODE_DAYS = 90;
const MAX_FAILED = 5;
const LOCK_MINUTES = 30;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const STAFF = ['doctor', 'rmo', 'nurse', 'receptionist'];

// A key of its own for portal sessions and code hashes (derived from JWT_SECRET, never the same as the staff key)
const portalKey = createHmac('sha256', config.JWT_SECRET).update('perinexa-patient-portal-v1').digest();
const hashCode = (code) => createHmac('sha256', portalKey).update(code).digest('hex');
const normaliseCode = (text) => String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const lastFour = (phone) => String(phone ?? '').replace(/\D/g, '').slice(-4);
const sameText = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function newCode() {
  let code = '';
  for (let i = 0; i < 12; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code; // shown as XXXX-XXXX-XXXX
}
const showCode = (code) => code.match(/.{1,4}/g).join('-');

const cookieOptions = () => ({ httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/api/portal' });

// ---------- Staff: the patient's access code ----------

async function portalEnabled(tenantId) {
  const t = await Tenant.findById(tenantId, { messaging: 1 }).lean();
  return Boolean(t?.messaging?.portalEnabled);
}
function assertStaff(req, patient) {
  if (!hasRole(req.membership, ...STAFF)) throw new HttpError(403, 'Portal codes are made by doctors, RMOs, nurses and reception.', 'FORBIDDEN');
  if (!patientAccess(req, patient).view.has('phone')) throw new HttpError(403, "You can't manage this patient's portal access.", 'FORBIDDEN');
}
const accessView = (a) => (a ? { createdByName: a.createdByName, createdAt: a.createdAt, expiresAt: a.expiresAt, lastUsedAt: a.lastUsedAt } : null);
const activeAccess = (tenantId, patientId, now) => PortalAccess.findOne({ tenantId, patientId, revoked: null, expiresAt: { $gt: now } }).sort({ createdAt: -1 });

patientPortalAccessRouter.get('/', async (req, res) => {
  const patient = await findPatient(req);
  assertStaff(req, patient);
  res.json({ enabled: await portalEnabled(req.tenantId), active: accessView(await activeAccess(req.tenantId, patient._id, req.now)), hasMobile: lastFour(patient.phone).length === 4 });
});

// A new code (any earlier code stops working). The code is in this answer only.
patientPortalAccessRouter.post('/', async (req, res) => {
  const patient = await findPatient(req);
  assertStaff(req, patient);
  refuseNewOnClosed(patient, 'portal'); // a record closed after a death: its portal access ended, and no new code is made
  if (!(await portalEnabled(req.tenantId))) throw new HttpError(409, 'The patient portal is switched off for this hospital (Hospital admin → Patient messages).', 'PORTAL_OFF');
  if (lastFour(patient.phone).length !== 4) throw new HttpError(400, 'Add her mobile number first: she signs in with its last 4 digits.', 'VALIDATION');
  const stamp = { by: req.user._id, byName: req.user.name, at: req.now };
  await PortalAccess.updateMany({ tenantId: req.tenantId, patientId: patient._id, revoked: null }, { $set: { revoked: stamp } });
  const code = newCode();
  const access = await PortalAccess.create({ tenantId: req.tenantId, patientId: patient._id, codeHash: hashCode(code), expiresAt: addDays(req.now, CODE_DAYS), createdBy: req.user._id, createdByName: req.user.name });
  await audit(req, 'PORTAL_ACCESS_CREATED', { details: { patientId: String(patient._id), mrn: patient.mrn } });
  res.status(201).json({ code: showCode(code), active: accessView(access) });
});

patientPortalAccessRouter.delete('/', async (req, res) => {
  const patient = await findPatient(req);
  assertStaff(req, patient);
  const r = await PortalAccess.updateMany({ tenantId: req.tenantId, patientId: patient._id, revoked: null }, { $set: { revoked: { by: req.user._id, byName: req.user.name, at: req.now } } });
  if (r.modifiedCount) await audit(req, 'PORTAL_ACCESS_REVOKED', { details: { patientId: String(patient._id), mrn: patient.mrn } });
  res.json({ active: null });
});

// ---------- The patient ----------

const signInLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { message: 'Too many tries. Please wait 15 minutes, or call the hospital.', code: 'RATE_LIMITED' } } });
const WRONG = 'The code or the 4 digits are not right. Check the paper the hospital gave you, or call the hospital.';
const portalAudit = (req, action, access, extra = {}) =>
  audit(req, action, { actor: null, tenantId: access?.tenantId ?? null, details: access ? { patientId: String(access.patientId), ...extra } : extra });

portalRouter.post('/login', signInLimiter, async (req, res) => {
  const body = parse(z.object({ code: z.string().max(40), digits: z.string().max(10) }).strict(), req.body);
  const code = normaliseCode(body.code);
  const digits = String(body.digits).replace(/\D/g, '');
  const access = code.length === 12 ? await PortalAccess.findOne({ codeHash: hashCode(code) }) : null;
  const now = req.now;
  if (!access || access.revoked || access.expiresAt <= now) {
    await portalAudit(req, 'PORTAL_LOGIN_FAILED', null, { reason: access ? 'expired_or_withdrawn' : 'unknown_code' });
    throw new HttpError(401, WRONG, 'PORTAL_LOGIN_FAILED');
  }
  if (access.lockedUntil && access.lockedUntil > now) throw new HttpError(429, 'This code is locked for a while after wrong tries. Please call the hospital.', 'PORTAL_LOCKED');
  const [patient, enabled] = await Promise.all([Patient.findOne({ _id: access.patientId, tenantId: access.tenantId }), portalEnabled(access.tenantId)]);
  // (a record closed after a death: its codes were withdrawn when it was closed – the same answer as for any withdrawn code)
  if (!enabled || !patient || isClosed(patient)) throw new HttpError(401, WRONG, 'PORTAL_LOGIN_FAILED');
  const expected = lastFour(patient.phone);
  if (expected.length !== 4 || digits.length !== 4 || !sameText(expected, digits)) {
    access.failedAttempts += 1;
    if (access.failedAttempts >= MAX_FAILED) {
      access.lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60 * 1000);
      access.failedAttempts = 0;
    }
    await access.save();
    await portalAudit(req, 'PORTAL_LOGIN_FAILED', access, { reason: 'wrong_digits' });
    throw new HttpError(401, WRONG, 'PORTAL_LOGIN_FAILED');
  }
  access.failedAttempts = 0;
  access.lockedUntil = null;
  access.lastUsedAt = now;
  await access.save();
  const token = jwt.sign({ aid: String(access._id), aud: 'perinexa-portal' }, portalKey, { expiresIn: SESSION_MINUTES * 60 });
  res.cookie(PORTAL_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_MINUTES * 60 * 1000 });
  await portalAudit(req, 'PORTAL_LOGIN_SUCCESS', access);
  res.json({ ok: true });
});

portalRouter.post('/logout', (_req, res) => {
  res.clearCookie(PORTAL_COOKIE, cookieOptions());
  res.json({ ok: true });
});

/** The patient's session: the access (still valid), her record and the hospital; 401 otherwise. */
async function portalSession(req, res) {
  const token = req.cookies?.[PORTAL_COOKIE];
  let payload = null;
  try {
    payload = token ? jwt.verify(token, portalKey, { audience: 'perinexa-portal' }) : null;
  } catch {
    payload = null;
  }
  const access = payload?.aid ? await PortalAccess.findById(payload.aid) : null;
  if (!access || access.revoked || access.expiresAt <= req.now || !(await portalEnabled(access.tenantId))) {
    res.clearCookie(PORTAL_COOKIE, cookieOptions());
    throw new HttpError(401, 'Please sign in again.', 'PORTAL_SIGNED_OUT');
  }
  const [patient, tenant] = await Promise.all([Patient.findOne({ _id: access.patientId, tenantId: access.tenantId }), Tenant.findById(access.tenantId)]);
  if (!patient || !tenant?.isActive || isClosed(patient)) {
    res.clearCookie(PORTAL_COOKIE, cookieOptions());
    throw new HttpError(401, 'Please sign in again.', 'PORTAL_SIGNED_OUT');
  }
  // Each request renews the 15 minutes
  res.cookie(PORTAL_COOKIE, jwt.sign({ aid: String(access._id), aud: 'perinexa-portal' }, portalKey, { expiresIn: SESSION_MINUTES * 60 }), { ...cookieOptions(), maxAge: SESSION_MINUTES * 60 * 1000 });
  return { access, patient, tenant };
}

portalRouter.get('/me', async (req, res) => {
  const { access, patient, tenant } = await portalSession(req, res);
  const today = hospitalToday(req.now);
  // Her own record's next appointment; on a record marked as a duplicate, the one that went from it to her main
  // record (never another appointment of that record)
  const moved = await movedAppointment(access.tenantId, patient, today);
  const next = moved ? { date: utcDay(moved.on), start: moved.start ?? null } : await nextAppointment(access.tenantId, patient._id, today);
  const appointment = next?.date ?? null;
  const plan = await portalPlanItems(access.tenantId, patient, req.now);
  const lh = letterheadFor(tenant);
  // An appointment that is on her main record now was shown: the audit entry names that record too (ids only)
  await portalAudit(req, 'PORTAL_VIEWED', access, moved ? { mainPatientId: String(moved.patientId) } : {});
  res.json({
    hospital: { name: lh.name, phone: lh.phone, address: lh.address },
    patient: { fullName: patient.fullName },
    // The language recorded for her messages (Reminders and portal), or null: the portal opens in it on a phone or
    // computer where nobody has chosen a language yet. Only while she agrees to messages (with "No automatic
    // reminders" the language saved is one nobody chose).
    language: patient.reminders?.consent ? patient.reminders.language : null,
    today,
    appointment,
    appointmentTime: next?.start ?? null,
    plan,
    sessionMinutes: SESSION_MINUTES,
  });
});

// ---------- Booking her own appointment (only when the hospital switched it on) ----------

const BOOK_DAYS_AHEAD = 30;
const TAKEN = 'That time has just been taken. Please choose another time.';
// Bookings and cancellations made in the portal are recorded as hers, never as a member of staff.
const asPatient = (req, access) => ({ tenantId: access.tenantId, now: req.now, user: { _id: null, name: 'Patient (online)' } });
/**
 * On a record marked as a duplicate: her next appointment among those that went FROM this record to her main record
 * when it was marked – or null. Only these: an appointment that was always the main record's own is never shown in
 * this record's portal (a marking can be wrong, and is then undone; the code and phone digits that opened this
 * session prove this record only).
 */
function movedAppointment(tenantId, patient, today) {
  if (!isDuplicate(patient)) return null;
  return Appointment.findOne({ tenantId, patientId: patient.duplicateOf.patient, movedFromPatientId: patient._id, on: { $gte: today }, kind: 'slot', status: 'booked' }).sort({ on: 1, start: 1 });
}

async function bookingState(req, res) {
  const session = await portalSession(req, res);
  const { access, patient, tenant } = session;
  const today = hospitalToday(req.now);
  // A record marked as a duplicate takes no new appointment: online booking is off for it (she calls the hospital)
  const enabled = Boolean(tenant.messaging?.portalBooking) && !isDuplicate(patient);
  const doctor = enabled && patient.assignedDoctor ? ((await hospitalDoctors(access.tenantId)).find((d) => d.id === String(patient.assignedDoctor)) ?? null) : null;
  const upcoming = isDuplicate(patient)
    ? await movedAppointment(access.tenantId, patient, today)
    : await Appointment.findOne({ tenantId: access.tenantId, patientId: patient._id, on: { $gte: today }, kind: 'slot', status: 'booked' }).sort({ on: 1, start: 1 });
  return { ...session, today, enabled, doctor, upcoming, from: addDays(today, 1), to: addDays(today, BOOK_DAYS_AHEAD) };
}
const upcomingView = (a, today) =>
  a ? { date: isoDay(a.on), start: a.start ?? null, online: a.source === 'portal', canCancel: a.source === 'portal' && utcDay(a.on) > today } : null;

portalRouter.get('/booking', async (req, res) => {
  const s = await bookingState(req, res);
  res.json({
    enabled: s.enabled,
    doctorName: s.doctor?.name ?? null,
    upcoming: upcomingView(s.upcoming, s.today),
    from: isoDay(s.from),
    to: isoDay(s.to),
  });
});

// The free times of one day with her doctor – times only, never who is booked.
portalRouter.get('/booking/times', async (req, res) => {
  const s = await bookingState(req, res);
  const { date } = parse(z.object({ date: requiredDateOnly('Date') }).strict(), req.query);
  if (!s.enabled || !s.doctor) throw new HttpError(409, 'Online booking is not available. Please call the hospital.', 'BOOKING_OFF');
  if (date < s.from || date > s.to) throw new HttpError(400, `Please choose a day from tomorrow up to ${BOOK_DAYS_AHEAD} days ahead.`, 'VALIDATION');
  res.json({ date: isoDay(date), times: await freeStarts(s.access.tenantId, s.doctor.id, date, { now: req.now }) });
});

portalRouter.post('/booking', async (req, res) => {
  const s = await bookingState(req, res);
  const body = parse(z.object({ date: requiredDateOnly('Date'), start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).strict(), req.body);
  if (!s.enabled || !s.doctor) throw new HttpError(409, 'Online booking is not available. Please call the hospital.', 'BOOKING_OFF');
  if (s.upcoming) throw new HttpError(409, 'You already have an appointment. To change it, call the hospital.', 'ALREADY_BOOKED');
  if (body.date < s.from || body.date > s.to) throw new HttpError(400, `Please choose a day from tomorrow up to ${BOOK_DAYS_AHEAD} days ahead.`, 'VALIDATION');
  let appt;
  try {
    appt = await bookSlot(asPatient(req, s.access), { doctorId: s.doctor.id, date: body.date, start: body.start, patientId: s.patient._id, visitType: 'follow_up', confirm: false, source: 'portal' });
  } catch (err) {
    // Staff are told who has the time; a patient is only told it is taken.
    if (err instanceof HttpError && err.status === 409) throw new HttpError(409, TAKEN, 'SLOT_TAKEN');
    throw err;
  }
  await portalAudit(req, 'PORTAL_APPOINTMENT_BOOKED', s.access, { appointmentId: String(appt._id), date: isoDay(appt.on), start: appt.start });
  res.status(201).json({ upcoming: upcomingView(appt, s.today) });
});

portalRouter.post('/booking/cancel', async (req, res) => {
  const s = await bookingState(req, res);
  if (!s.enabled) throw new HttpError(409, 'Online booking is not available. Please call the hospital.', 'BOOKING_OFF');
  if (!s.upcoming || !upcomingView(s.upcoming, s.today).canCancel) throw new HttpError(409, 'This appointment cannot be cancelled here. Please call the hospital.', 'NOT_CANCELLABLE');
  await cancelAppointment(asPatient(req, s.access), s.upcoming, 'patient_asked');
  await portalAudit(req, 'PORTAL_APPOINTMENT_CANCELLED', s.access, { appointmentId: String(s.upcoming._id), date: isoDay(s.upcoming.on) });
  res.json({ upcoming: null });
});
