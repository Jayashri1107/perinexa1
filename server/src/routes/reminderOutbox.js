import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { hospitalToday } from '../careplans/dates.js';
import { hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { ReminderMessage } from '../models/ReminderMessage.js';
import { Tenant } from '../models/Tenant.js';
import { cancelStaleGeneral } from '../reminders/generalReminders.js';
import { CHANNELS, REMINDER_LANGUAGES } from '../reminders/messages.js';
import { CARE_DUE_ROW_FOR_SENSITIVE, GENERAL_KINDS } from '../reminders/reminderRules.js';
import { runForTenant } from '../reminders/reminderService.js';
import { currentSender } from '../reminders/sender.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { whatsappNumberShown, whatsappStatus } from '../visits/whatsappSender.js';
import { patientAccess } from '../utils/patientAccess.js';
import { CLOSED_MESSAGE_REASON, closedRefusal, isClosed } from '../patients/deathRules.js';
import { findPatient } from '../utils/patientLookup.js';
import { objectId, parse } from '../utils/validate.js';

// Automatic reminders (Version 2):
//  - a patient's agreement: PUT /api/patients/:id/reminder-consent (doctors, RMOs, nurses and reception, for a
//    patient whose phone number they may see);
//  - the outbox: /api/reminders – what goes out on a day, what is waiting to be sent by hand, what failed;
//    "Send now" (doctors and hospital admins) runs the round at once. Each message carries its kind: an appointment
//    reminder, a booking, move or cancellation, or one of the two general messages – "a check-up or test is due"
//    (care_due) and "we missed you" (missed) – which say nothing about what is due, to any reader. A message is
//    shown to staff who may see the patient's phone number; the "check-up or test due" row of a SENSITIVE record
//    only to staff who may see her medical details (it says that something in her care plan is overdue);
//  - the hospital's switches (reminders, patient portal): /api/reminders/settings (hospital admins change them).
// The audit log gets ids only.

export const reminderOutboxRouter = Router();
export const patientReminderConsentRouter = Router({ mergeParams: true });

const STAFF = ['doctor', 'rmo', 'nurse', 'receptionist'];
const WAITING = ['to_send', 'failed', 'queued'];
const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');

/**
 * May this person see (and send by hand) this message? Everyone who may see the patient's phone number – except
 * that on a sensitive record the "check-up or test due" row needs the medical view (her doctor and RMOs): the row
 * itself tells that something in her care plan is overdue, which reception, nurses and other doctors see nowhere
 * else for a sensitive record. "Missed appointment" and the appointment messages are about a booking, which they
 * see anyway. (The message to the patient is the same either way.)
 */
function maySeeMessage(req, patient, message) {
  const access = patientAccess(req, patient);
  if (!access.view.has('phone')) return false;
  if (message.kind === 'care_due' && patient.sensitive && !CARE_DUE_ROW_FOR_SENSITIVE) return access.view.has('pregnancy');
  return true;
}

// ---------- Her agreement ----------

const consentSchema = z
  .object({
    consent: z.boolean(),
    channel: z.enum(CHANNELS).default('sms'),
    language: z.enum(REMINDER_LANGUAGES).default('en'),
  })
  .strict();

patientReminderConsentRouter.put('/', async (req, res) => {
  if (!hasRole(req.membership, ...STAFF)) throw forbidden('Reminder choices are recorded by doctors, RMOs, nurses and reception.');
  const patient = await findPatient(req);
  if (!patientAccess(req, patient).view.has('phone')) throw forbidden("You can't change this patient's reminders.");
  const body = parse(consentSchema, req.body);
  // A record closed after a death gets no message of any kind: reminders cannot be switched on for it (switching
  // them off is always possible)
  if (body.consent && isClosed(patient)) throw closedRefusal('message');
  patient.reminders = { ...body, byName: req.user.name, at: req.now };
  await patient.save();
  await audit(req, 'PATIENT_REMINDERS_CHANGED', { details: { patientId: String(patient._id), mrn: patient.mrn, consent: body.consent, channel: body.channel } });
  res.json({ reminders: patient.toObject().reminders });
});

// ---------- The outbox ----------

const isAdmin = (req) => hasRole(req.membership, 'admin');
reminderOutboxRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...STAFF, 'admin')) throw forbidden('Reminders are for hospital staff.');
  next();
});

const settingsOf = (tenant) => ({
  remindersEnabled: Boolean(tenant?.messaging?.remindersEnabled),
  portalEnabled: Boolean(tenant?.messaging?.portalEnabled),
  portalBooking: Boolean(tenant?.messaging?.portalBooking),
  whatsappDocuments: Boolean(tenant?.messaging?.whatsappDocuments),
  whatsappOtp: Boolean(tenant?.messaging?.whatsappOtp),
  whatsappQueue: Boolean(tenant?.messaging?.whatsappQueue),
  displayEnabled: Boolean(tenant?.messaging?.displayKey),
  portalSignup: Boolean(tenant?.messaging?.signupKey),
  // The hospital's portal address for sign-up and ABHA sign-in: public (it is printed on a poster), so all staff see it.
  signupKey: tenant?.messaging?.signupKey ?? null,
});
// The waiting-room screen's secret address is shown to the hospital admin only.
const displayOf = (req, tenant) => (isAdmin(req) ? { displayKey: tenant?.messaging?.displayKey ?? null } : {});
const newDisplayKey = () => randomBytes(16).toString('hex');
// 8 letters and digits without look-alikes (no 0/O, 1/I): easy to type from a poster, about 10^12 possible codes.
const SIGNUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newSignupKey = () => Array.from(randomBytes(8), (b) => SIGNUP_ALPHABET[b % SIGNUP_ALPHABET.length]).join('');
const whatsappView = () => ({ whatsapp: { ...whatsappStatus(), number: whatsappNumberShown() } });
function providerView() {
  const s = currentSender();
  return s ? { name: s.name, channels: s.channels } : null;
}

reminderOutboxRouter.get('/settings', async (req, res) => {
  const tenant = await Tenant.findById(req.tenantId);
  res.json({ settings: settingsOf(tenant), provider: providerView(), ...whatsappView(), canChange: isAdmin(req), ...displayOf(req, tenant) });
});

reminderOutboxRouter.put('/settings', async (req, res) => {
  if (!isAdmin(req)) throw forbidden('Only the hospital admin changes these settings.');
  const body = parse(z.object({ remindersEnabled: z.boolean(), portalEnabled: z.boolean(), portalBooking: z.boolean().default(false), whatsappDocuments: z.boolean().default(false), whatsappOtp: z.boolean().default(false), whatsappQueue: z.boolean().default(false), displayEnabled: z.boolean().default(false), portalSignup: z.boolean().default(false) }).strict(), req.body);
  const tenant = await Tenant.findById(req.tenantId);
  const before = settingsOf(tenant);
  const { displayEnabled, portalSignup, ...flags } = body;
  // Switching the screen on makes its address; switching it off makes the old address stop working.
  const displayKey = displayEnabled ? (tenant.messaging?.displayKey ?? newDisplayKey()) : null;
  // Sign-up needs the portal; switching it off makes the poster's address stop working (switching it on again makes a new one).
  const signupKey = portalSignup && flags.portalEnabled ? (tenant.messaging?.signupKey ?? newSignupKey()) : null;
  tenant.messaging = { ...flags, portalBooking: flags.portalBooking && flags.portalEnabled, displayKey, signupKey };
  await tenant.save();
  const changes = Object.fromEntries(Object.keys(body).filter((k) => before[k] !== body[k]).map((k) => [k, { from: before[k], to: body[k] }]));
  if (Object.keys(changes).length) await audit(req, 'TENANT_SETTINGS_UPDATED', { details: { changes } });
  res.json({ settings: settingsOf(tenant), provider: providerView(), ...whatsappView(), canChange: true, ...displayOf(req, tenant) });
});

// A new address for the waiting-room screen: the old one stops working at once (e.g. after it was shared by mistake).
reminderOutboxRouter.post('/settings/display-link', async (req, res) => {
  if (!isAdmin(req)) throw forbidden('Only the hospital admin changes these settings.');
  const tenant = await Tenant.findById(req.tenantId);
  if (!tenant?.messaging?.displayKey) throw new HttpError(409, 'Switch the waiting-room screen on first.', 'DISPLAY_OFF');
  tenant.messaging.displayKey = newDisplayKey();
  await tenant.save();
  await audit(req, 'TENANT_SETTINGS_UPDATED', { details: { changes: { displayLink: { from: 'old', to: 'new' } } } });
  res.json({ settings: settingsOf(tenant), provider: providerView(), ...whatsappView(), canChange: true, ...displayOf(req, tenant) });
});

// The messages of a day (the day they go out), or every message still to send by hand or failed.
reminderOutboxRouter.get('/', async (req, res) => {
  if (isAdmin(req) && !hasRole(req.membership, ...STAFF)) throw forbidden('The hospital admin sets reminders up; staff see the messages.');
  const q = parse(z.object({ day: z.iso.date().optional(), list: z.enum(['day', 'open']).default('day') }).strict(), req.query);
  const day = q.day ? new Date(`${q.day}T00:00:00Z`) : hospitalToday(req.now);
  // A waiting "something is due" or "we missed you" message that is no longer true (she booked, came, was admitted,
  // the hospital switched reminders off, it is too old) is cancelled before the list is shown, so nobody sends it
  // by hand. If that check fails, the waiting general messages are left out of the answer (never shown unchecked);
  // the appointment messages are shown as always.
  let generalChecked = true;
  try {
    await cancelStaleGeneral(await Tenant.findById(req.tenantId), req.now);
  } catch (err) {
    console.error('Reminders: the waiting general messages could not be checked', err?.message ?? err);
    generalChecked = false;
  }
  const unchecked = (m) => !generalChecked && GENERAL_KINDS.includes(m.kind) && ['queued', 'to_send', 'failed'].includes(m.status);
  const filter = q.list === 'open' ? { tenantId: req.tenantId, status: { $in: ['to_send', 'failed'] }, dueOn: { $gte: hospitalToday(req.now) } } : { tenantId: req.tenantId, sendOn: day };
  const messages = await ReminderMessage.find(filter).sort({ dueOn: 1, createdAt: 1 }).limit(500).lean();
  const patients = new Map(
    (await Patient.find({ tenantId: req.tenantId, _id: { $in: [...new Set(messages.map((m) => String(m.patientId)))] } })).map((p) => [String(p._id), p]),
  );
  const shown = messages
    .map((m) => {
      const p = patients.get(String(m.patientId));
      if (!p || !maySeeMessage(req, p, m) || unchecked(m)) return null;
      return {
        id: String(m._id),
        patient: { id: String(p._id), fullName: p.fullName, mrn: p.mrn },
        kind: m.kind,
        dueOn: m.dueOn,
        aboutOn: m.aboutOn ?? null, // "we missed you": the day of the appointment
        sendOn: m.sendOn,
        channel: m.channel,
        language: m.language,
        to: m.to,
        text: m.text,
        status: m.status,
        error: m.error,
        attempts: m.attempts,
        sentAt: m.sentAt,
        handled: m.handled ? { byName: m.handled.byName, at: m.handled.at } : null,
      };
    })
    .filter(Boolean);
  res.json({ day, list: q.list, messages: shown, provider: providerView(), canRun: hasRole(req.membership, 'doctor', 'admin') });
});

// Staff sent it themselves (from their phone or WhatsApp): recorded with their name.
reminderOutboxRouter.post('/:messageId/sent-by-hand', async (req, res) => {
  if (!hasRole(req.membership, ...STAFF)) throw forbidden('Reminders are sent by hospital staff.');
  const id = parse(objectId, req.params.messageId);
  let m = await ReminderMessage.findOne({ _id: id, tenantId: req.tenantId });
  if (!m) throw new HttpError(404, 'This message was not found.', 'NOT_FOUND');
  const p = await Patient.findOne({ _id: m.patientId, tenantId: req.tenantId });
  if (!p || !maySeeMessage(req, p, m)) throw forbidden("You can't send this patient's reminders.");
  // A general message is checked once more (the page may have been open for hours): still true, not too old, and
  // reminders still switched on. One that cannot be checked is not recorded as sent.
  if (GENERAL_KINDS.includes(m.kind) && WAITING.includes(m.status)) {
    try {
      await cancelStaleGeneral(await Tenant.findById(req.tenantId), req.now);
    } catch (err) {
      console.error('Reminders: the waiting general messages could not be checked', err?.message ?? err);
      throw new HttpError(503, 'This message could not be checked just now. Please try again in a moment.', 'TRY_AGAIN');
    }
    m = await ReminderMessage.findOne({ _id: id, tenantId: req.tenantId });
    if (m.status === 'cancelled') throw new HttpError(409, `This message is no longer to be sent${m.error ? ` (${m.error.toLowerCase()})` : ''}.`, 'CONFLICT');
  }
  if (!WAITING.includes(m.status)) throw new HttpError(409, 'This message was already sent or cancelled.', 'CONFLICT');
  // The record was closed after a death while the page was open: the message is cancelled, never recorded as sent
  if (isClosed(p)) {
    m.status = 'cancelled';
    m.error = CLOSED_MESSAGE_REASON;
    await m.save();
    throw new HttpError(409, 'This message is no longer to be sent (the record is closed).', 'RECORD_CLOSED');
  }
  m.status = 'sent_by_hand';
  m.handled = { by: req.user._id, byName: req.user.name, at: req.now };
  m.sentAt = req.now;
  await m.save();
  await audit(req, 'REMINDER_SENT_BY_HAND', { details: { patientId: String(p._id), mrn: p.mrn } });
  res.json({ ok: true });
});

// Run the round now (queue tomorrow's reminders and the general messages, send what is due), whatever the hour.
reminderOutboxRouter.post('/run', async (req, res) => {
  if (!hasRole(req.membership, 'doctor', 'admin')) throw forbidden('Doctors and the hospital admin can send the reminders now.');
  const tenant = await Tenant.findById(req.tenantId);
  if (!tenant?.messaging?.remindersEnabled) throw new HttpError(409, 'Automatic reminders are switched off for this hospital (Hospital admin → Patient messages).', 'REMINDERS_OFF');
  const result = await runForTenant(tenant, req.now);
  await audit(req, 'REMINDERS_RUN', { details: result });
  res.json(result);
});
