import { Router } from 'express';
import { z } from 'zod';
import { VISIT_TYPES } from '../appointments/appointmentRules.js';
import { bookSlot, hospitalDoctor, hospitalDoctors, linkPatient } from '../appointments/appointmentService.js';
import { DAY, addDays, hospitalDayStart, hospitalToday, isoDay } from '../careplans/dates.js';
import { Appointment } from '../models/Appointment.js';
import { nextNumber } from '../models/Counter.js';
import { hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { MAX_ATTACHMENTS, MESSAGE_KINDS, NOTE_FIELDS, REFERRAL_URGENCY, REFERRAL_VIA, RELEASE_KINDS, REVIEW_PROMISES, Referral, SENT_FIELDS, SHARING_ANSWERS } from '../models/Referral.js';
import { ReferringDoctor } from '../models/ReferringDoctor.js';
import { refuseNewOnDuplicate } from '../patients/duplicateRules.js';
import { refuseNewOnClosed } from '../patients/deathRules.js';
import { duesFor, isMissed, promisesFor } from '../referrals/clocks.js';
import { REASON_GROUPS, REASON_KEYS, REFERRAL_REASONS } from '../referrals/reasons.js';
import {
  REFERRAL_ROLES,
  appointmentBrief,
  clockFacts,
  currentRelease,
  filesJoinRecord,
  firstVisitOf,
  fullView,
  listView,
  noteFromVisit,
  noteSignerOf,
  patientOf,
  patientsOf,
  referralAccess,
  refreshFacts,
  replyText,
  sameWoman,
  settingsOf,
  viewContext,
  waitingOf,
  weekOf,
} from '../referrals/referralService.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { safeText } from '../utils/pcpndt.js';
import { fileEntry, fileUploadSchema, findFile, sendFile, storeFile } from '../utils/storedFiles.js';
import { objectId, parse, requiredDateOnly } from '../utils/validate.js';

// Referrals from other doctors (docs/REFERRALS_PLAN.md – the owner's decisions of 15 Oct 2026), /api/referrals:
//  - GET  /settings-view  the centres, desk number, consultants' direct lines, reasons and doctors (for the forms)
//  - GET  /               the desk's list (?list=open|late|closed|all, ?patientId, ?referringDoctorId)
//  - GET  /worklist       counts for Today; GET /review?week= the weekly review of missed promises
//  - POST /               log a referral; GET /:id, PUT /:id (open only)
//  - POST /:id/link, /:id/book, /:id/attachments (GET /:id/attachments/:fileId), /:id/sharing
//  - PUT  /:id/note, POST /:id/note/from-visit, /:id/note/sign, /:id/note/additions
//  - POST /:id/releases (GET /:id/releases/:fileId), /:id/messages, /:id/reviews, /:id/close, /:id/cancel
// Who may do what (referrals/referralService.js referralAccess): the referral desk – every referral of the hospital,
// never the medical record or the words of the consultant note; doctors and RMOs – the referrals they may open (no
// patient yet, or her medical details are theirs to see); the note – her doctor or an RMO writes it, a doctor signs
// it, they release it as a PDF. Messages are sent by the desk from its own WhatsApp and only marked sent here; the
// note and the discharge summary only after her recorded Yes. Nothing about her goes into a WhatsApp link (the
// website opens the chat with the doctor's number only). Free text is checked for words about the baby's sex; the
// audit log gets ids and plain words only.

export { REFERRAL_ROLES };
export const referralsRouter = Router();

const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const notFound = (message = 'This referral was not found.') => new HttpError(404, message, 'NOT_FOUND');
const badRequest = (message, code) => new HttpError(400, message, code);
const conflict = (message, code = 'CONFLICT') => new HttpError(409, message, code);
const invalid = (fields, message = 'Please check the highlighted fields.') => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields });
const rev = z.number('The version you edited is missing – please reload the page').int().min(0);
const stampOf = (req) => ({ by: req.user._id, byName: req.user.name, at: req.now ?? new Date() });
const ids = (r, patient, extra = {}) => ({ referralId: String(r._id), ...(r.patientId ? { patientId: String(r.patientId) } : {}), ...(patient?.mrn ? { mrn: patient.mrn } : {}), ...extra });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Please enter a time like 10:30.');
// When a referral reached the hospital may be typed in later, but not too far back (its clocks start then)
const MAX_RECEIVED_DAYS_AGO = 7;
const LIST_LIMIT = 500;
// The weekly review reads every open referral, those that came in this far back, and those whose first visit,
// discharge or closing fell just before the week (a note or a discharge summary falls due a day after them)
const LOOK_BACK_DAYS = 120;
const REVIEW_MARGIN_DAYS = 2;
const WIDE_LIMIT = 5000; // the worklist and the weekly review

referralsRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...REFERRAL_ROLES)) throw forbidden('Referrals are for the referral desk, doctors and RMOs.');
  next();
});

const SENT_LABELS = { lmpEdd: 'LMP or EDD', gravidaPara: 'Gravida and para', bp: 'BP', hb: 'Hb', sugar: 'Sugar', medicines: 'Medicines', scans: 'Scan reports' };
const NOTE_LABELS = {
  questionRestated: 'Your question',
  findings: 'Findings',
  diagnosis: 'Diagnosis',
  plan: 'Plan',
  needFromYou: 'We need from you',
  returnsToYouFor: 'Returns to you for',
  nextAtAnandi: 'Next at the hospital',
};
// What must be written before the note is signed (promise 5: "returns to you for" is never left out)
const NOTE_TO_SIGN = ['findings', 'diagnosis', 'plan', 'returnsToYouFor'];

// ---------- Loading one referral ----------

/** The referral in the URL, brought up to date, with her record and what this person may do (403 when not theirs). */
async function loadReferral(req) {
  const id = parse(objectId, req.params.referralId);
  const r = await Referral.findOne({ _id: id, tenantId: req.tenantId });
  if (!r) throw notFound();
  const facts = await refreshFacts(req.tenantId, [r]);
  const patient = await patientOf(req.tenantId, r.patientId);
  const access = referralAccess(req, r, patient);
  if (!access.view) throw forbidden("You can't open this referral: her medical details are for her doctor and the RMOs.");
  return { r, patient, access, facts };
}

/** Sends the whole referral (status 200 unless given), with anything extra the action returns. */
async function respond(req, res, { r, patient, access, facts }, { status = 200, extra = {} } = {}) {
  const ctx = await viewContext(req, [r], { patients: new Map(patient ? [[String(patient._id), patient]] : []), facts });
  const [appointment, signer] = await Promise.all([appointmentBrief(req.tenantId, r, ctx.now), noteSignerOf(r)]);
  res.status(status).json({ referral: fullView(r, ctx, access, { appointment, signer }), ...extra });
}

function checkRev(r, sent) {
  if (sent !== (r.rev ?? 0)) throw conflict('Someone changed this referral meanwhile. The latest version is shown – please check it and try again.', 'STALE');
}
function checkNoteRev(r, sent) {
  if (sent !== (r.note?.rev ?? 0)) throw conflict('Someone changed this note meanwhile. The latest version is shown – please check it and try again.', 'STALE');
}
function assertOpen(r) {
  if (r.status !== 'open') throw conflict(r.status === 'closed' ? 'This referral is closed.' : 'This referral was cancelled.', 'NOT_OPEN');
}
function assertLive(r) {
  if (r.status === 'cancelled') throw conflict('This referral was cancelled.', 'NOT_OPEN');
}
const assertManage = (access) => {
  if (!access.manage) throw forbidden('Only the referral desk, her doctor and the RMOs can change this referral.');
};

/** Its promises at this moment (referrals/clocks.js). */
async function promisesNow(req, r, facts) {
  const { settings } = await settingsOf(req.tenantId);
  return promisesFor(clockFacts(r, facts), req.now ?? new Date(), settings);
}
const replied = (r) => (r.messages ?? []).some((m) => m.what === 'reply');

// When it came and its urgency set the reply and seen clocks. Once the reply is sent, she has been seen or a promise
// is late, they stay as they are: changing them then would rewrite whether a promise was kept (a late reply turned
// into one on time).
async function assertClocksNotFrozen(req, r, facts) {
  if (replied(r) || r.firstSeen?.at || (await promisesNow(req, r, facts)).some((p) => isMissed(p.state))) {
    throw conflict('The time it came and its urgency are fixed once the reply is sent, she has been seen or a promise is late.', 'FROZEN');
  }
}

// ---------- Checks shared by logging and changing a referral ----------

const referringDoctorFor = async (req, id, { active = true } = {}) => {
  const doctor = await ReferringDoctor.findOne({ tenantId: req.tenantId, _id: id }, { _id: 1, isActive: 1 }).lean();
  if (!doctor || (active && !doctor.isActive)) throw invalid({ referringDoctorId: 'Choose a referring doctor from the list (or add them first).' });
  return doctor;
};
function checkCentre(settings, key) {
  if (!settings.centres.some((c) => c.key === key && c.active)) throw invalid({ centre: 'Choose one of the centres in use.' });
}
function checkReceivedAt(req, at) {
  const now = (req.now ?? new Date()).getTime();
  if (at.getTime() > now + 2 * 60_000) throw invalid({ receivedAt: 'When it reached the hospital cannot be in the future.' });
  if (at.getTime() < now - MAX_RECEIVED_DAYS_AGO * DAY) throw invalid({ receivedAt: `This is more than ${MAX_RECEIVED_DAYS_AGO} days ago – please check it.` });
}
async function checkConsultant(req, id) {
  if (!id) return null;
  try {
    return await hospitalDoctor(req.tenantId, id);
  } catch {
    throw invalid({ consultantId: 'Choose a doctor of this hospital.' });
  }
}

// ---------- The forms' lists ----------

referralsRouter.get('/settings-view', async (req, res) => {
  const [{ settings }, doctors] = await Promise.all([settingsOf(req.tenantId), hospitalDoctors(req.tenantId)]);
  const names = new Map(doctors.map((d) => [d.id, d.name]));
  res.json({
    centres: settings.centres,
    deskNumber: settings.deskNumber,
    // Only the lines of the hospital's doctors still working here
    consultantLines: settings.consultantLines.filter((l) => names.has(l.userId)).map((l) => ({ userId: l.userId, name: names.get(l.userId), phone: l.phone, note: l.note })),
    reasons: REFERRAL_REASONS.map(({ key, label, group }) => ({ key, label, group })),
    reasonGroups: REASON_GROUPS,
    doctors,
  });
});

// ---------- The desk's list ----------

const listQuery = z.object({
  list: z.enum(['open', 'late', 'closed', 'all']).default('open'),
  patientId: objectId.optional(),
  referringDoctorId: objectId.optional(),
});

/** The referrals of a query this person may open, brought up to date, as list rows (with the context and access). */
async function openable(req, filter, { sort = { receivedAt: -1 }, limit = LIST_LIMIT } = {}) {
  const refs = await Referral.find({ tenantId: req.tenantId, ...filter }).sort(sort).limit(limit);
  const facts = await refreshFacts(req.tenantId, refs.filter((r) => r.status === 'open'));
  const patients = await patientsOf(req.tenantId, refs);
  const rows = [];
  for (const r of refs) {
    const p = r.patientId ? patients.get(String(r.patientId)) : null;
    if (r.patientId && !p) continue;
    const access = referralAccess(req, r, p);
    if (access.view) rows.push({ r, patient: p, access });
  }
  const ctx = await viewContext(req, rows.map((x) => x.r), { patients, facts });
  return { rows, ctx, facts };
}

const byDue = (a, b) => {
  const da = a.next?.due ? new Date(a.next.due).getTime() : Infinity;
  const db = b.next?.due ? new Date(b.next.due).getTime() : Infinity;
  return da - db || new Date(b.receivedAt) - new Date(a.receivedAt);
};

referralsRouter.get('/', async (req, res) => {
  const q = parse(listQuery, req.query);
  const filter = {
    ...(q.list === 'open' || q.list === 'late' ? { status: 'open' } : q.list === 'closed' ? { status: { $in: ['closed', 'cancelled'] } } : {}),
    ...(q.patientId ? { patientId: q.patientId } : {}),
    ...(q.referringDoctorId ? { referringDoctorId: q.referringDoctorId } : {}),
  };
  const { rows, ctx } = await openable(req, filter);
  let referrals = rows.map(({ r }) => listView(r, ctx));
  if (q.list === 'late') referrals = referrals.filter((v) => v.promises.some((p) => p.state === 'late'));
  // Open referrals: the clock due first at the top; the others newest first
  if (q.list === 'open' || q.list === 'late') referrals.sort(byDue);
  res.json({ referrals });
});

// ---------- Today's counts ----------

// The desk: replies not yet sent, open referrals with a promise late, messages ready to send. Doctors and RMOs: notes
// to write and PDFs to release – an RMO for every referral whose note they may write; a doctor for her patients and
// the referrals they are the consultant of. Every open referral, whatever its age: a discharge summary can fall due
// months after an antenatal referral.
referralsRouter.get('/worklist', async (req, res) => {
  const { rows, ctx } = await openable(req, { status: 'open' }, { limit: WIDE_LIMIT });
  const desk = hasRole(req.membership, 'referral_desk');
  const rmo = hasRole(req.membership, 'rmo');
  const me = String(req.user._id);
  const counts = { replies: 0, late: 0, toSend: 0, notesToWrite: 0, toRelease: 0 };
  for (const { r, patient, access } of rows) {
    const promises = promisesFor(clockFacts(r, ctx.facts), ctx.now, ctx.settings);
    const waiting = waitingOf(r, promises);
    if (desk) {
      if (waiting.reply) counts.replies += 1;
      if (waiting.send) counts.toSend += 1;
      if (promises.some((p) => p.state === 'late')) counts.late += 1;
    }
    const theirs = rmo || String(r.consultantId ?? '') === me || String(patient?.assignedDoctor ?? '') === me;
    if (theirs && access.writeNote && waiting.note) counts.notesToWrite += 1;
    if (theirs && access.release && waiting.release) counts.toRelease += 1;
  }
  res.json(counts);
});

// ---------- The weekly review ----------

// Every promise due in the week (Monday to Sunday, hospital dates) that was missed – late, or met late – with what the
// consultants wrote about it. Everyone in Referrals reads it; doctors and RMOs write the review notes.
referralsRouter.get('/review', async (req, res) => {
  const q = parse(z.object({ week: requiredDateOnly('Week').optional() }), req.query);
  const { from, to } = weekOf(q.week ?? hospitalToday(req.now ?? new Date()));
  const start = hospitalDayStart(from).getTime();
  const end = hospitalDayStart(addDays(to, 1)).getTime();
  // Read by when a promise can fall due, not only by when the referral came: every open one (a discharge summary
  // months after an antenatal referral), the reply and seen clocks of those that came lately, and the note and
  // discharge clocks begun just before the week. Newest first, so a limit drops the oldest – then by due time.
  const before = (days) => new Date(start - days * DAY);
  const filter = {
    status: { $ne: 'cancelled' },
    $or: [
      { status: 'open' },
      { receivedAt: { $gte: before(LOOK_BACK_DAYS) } },
      { 'discharge.dischargedAt': { $gte: before(REVIEW_MARGIN_DAYS) } },
      { 'firstSeen.at': { $gte: before(REVIEW_MARGIN_DAYS) } },
      { 'closed.at': { $gte: before(REVIEW_MARGIN_DAYS) } },
    ],
  };
  const { rows, ctx } = await openable(req, filter, { sort: { receivedAt: -1 }, limit: WIDE_LIMIT });
  const items = [];
  for (const { r, access } of rows) {
    const view = listView(r, ctx);
    for (const p of view.promises) {
      const due = p.due ? new Date(p.due).getTime() : null;
      if (due == null || due < start || due >= end || !isMissed(p.state)) continue;
      items.push({
        referral: view,
        promise: p.key,
        due: p.due,
        doneAt: p.doneAt,
        state: p.state,
        reviews: (r.reviews ?? []).filter((x) => x.promise === p.key).map((x) => ({ promise: x.promise, wentWrong: x.wentWrong ?? '', changed: x.changed ?? '', byName: x.byName ?? '', at: x.at ?? null })),
        canReview: access.review,
      });
    }
  }
  items.sort((a, b) => new Date(a.due) - new Date(b.due));
  res.json({ week: { from: isoDay(from), to: isoDay(to) }, items });
});

// ---------- Logging a referral ----------

const guestSchema = z
  .object({
    name: z.string().trim().min(2, 'Please enter her name.').max(150),
    phone: z.string().trim().max(30).regex(/^[0-9+()\-\s]*$/, 'The phone number can only contain numbers, spaces, +, ( ) and -').default(''),
    ageYears: z.union([z.number().int('Age: whole years').min(0, 'Age: between 0 and 120').max(120, 'Age: between 0 and 120'), z.null()]).default(null),
  })
  .strict();
const sentSchema = z.object(Object.fromEntries(SENT_FIELDS.map((k) => [k, safeText(SENT_LABELS[k], 200).optional()]))).strict();
const intake = {
  referringDoctorId: objectId,
  receivedAt: z.iso.datetime('When it reached the hospital: please enter a valid date and time').transform((d) => new Date(d)),
  via: z.enum(REFERRAL_VIA, 'Choose how the referral came'),
  urgency: z.enum(REFERRAL_URGENCY, 'Choose urgent or routine'),
  centre: z.string().trim().min(1, 'Choose the centre').max(40),
  reasons: z.array(z.enum(REASON_KEYS, 'Choose the reasons from the list')).max(20, 'At most 20 reasons.'),
  otherReason: safeText('Other reason', 300),
  question: safeText('The question', 1000),
  sent: sentSchema,
  consultantId: z.union([objectId, z.null()]),
};
const emptySent = () => Object.fromEntries(SENT_FIELDS.map((k) => [k, '']));
const unique = (list) => [...new Set(list)];

const createSchema = z
  .object({
    clientRequestId: z.string().min(8).max(64),
    referringDoctorId: intake.referringDoctorId,
    receivedAt: intake.receivedAt.optional(),
    via: intake.via,
    urgency: intake.urgency,
    centre: intake.centre,
    patientId: objectId.optional(),
    guest: guestSchema.optional(),
    reasons: intake.reasons.default([]),
    otherReason: intake.otherReason.default(''),
    question: intake.question.default(''),
    sent: intake.sent.optional(),
    consultantId: intake.consultantId.default(null),
  })
  .strict()
  .refine((b) => Boolean(b.patientId) !== Boolean(b.guest), { message: 'Choose her record, or enter her name if she is not registered yet.', path: ['patientId'] })
  .refine((b) => b.reasons.length > 0 || b.otherReason.length > 0, { message: 'Choose at least one reason, or write the reason.', path: ['reasons'] });

referralsRouter.post('/', async (req, res) => {
  const body = parse(createSchema, req.body);
  const repeat = await Referral.findOne({ tenantId: req.tenantId, clientRequestId: body.clientRequestId });
  if (repeat) {
    // The same form sent twice (double click, retry): the first one stands
    const patient = await patientOf(req.tenantId, repeat.patientId);
    const access = referralAccess(req, repeat, patient);
    if (!access.view || String(repeat.created?.by) !== String(req.user._id)) throw conflict('This request was already used.');
    return respond(req, res, { r: repeat, patient, access, facts: await refreshFacts(req.tenantId, [repeat]) }, { status: 201 });
  }
  const { settings } = await settingsOf(req.tenantId);
  await referringDoctorFor(req, body.referringDoctorId);
  checkCentre(settings, body.centre);
  const receivedAt = body.receivedAt ?? req.now ?? new Date();
  checkReceivedAt(req, receivedAt);
  await checkConsultant(req, body.consultantId);
  let patient = null;
  if (body.patientId) {
    patient = await patientOf(req.tenantId, body.patientId);
    if (!patient) throw notFound('Patient not found.');
    refuseNewOnDuplicate(patient, 'referral');
    refuseNewOnClosed(patient, 'referral');
    if (!referralAccess(req, null, patient).view) throw forbidden("This is a sensitive record of another doctor's patient: her doctor, an RMO or the referral desk logs the referral.");
  }
  const number = `REF-${String(await nextNumber(req.tenantId, 'referral')).padStart(6, '0')}`;
  let r;
  try {
    r = await Referral.create({
      tenantId: req.tenantId,
      number,
      centre: body.centre,
      receivedAt,
      // (worked out now, with today's settings: a later change of the settings never moves them)
      dues: duesFor(receivedAt, body.urgency, settings),
      via: body.via,
      urgency: body.urgency,
      referringDoctorId: body.referringDoctorId,
      patientId: patient?._id ?? null,
      guest: patient ? null : body.guest,
      reasons: unique(body.reasons),
      otherReason: body.otherReason,
      question: body.question,
      sent: { ...emptySent(), ...(body.sent ?? {}) },
      consultantId: body.consultantId,
      clientRequestId: body.clientRequestId,
      created: stampOf(req),
    });
  } catch (e) {
    if (e?.code !== 11000) throw e;
    throw conflict('This referral was just logged. Reload the list.', 'DUPLICATE');
  }
  await audit(req, 'REFERRAL_CREATED', { details: ids(r, patient) });
  const facts = await refreshFacts(req.tenantId, [r]);
  return respond(req, res, { r, patient, access: referralAccess(req, r, patient), facts }, { status: 201 });
});

// ---------- One referral ----------

referralsRouter.get('/:referralId', async (req, res) => {
  const loaded = await loadReferral(req);
  await audit(req, 'REFERRAL_VIEWED', { details: ids(loaded.r, loaded.patient) });
  return respond(req, res, loaded);
});

const updateSchema = z
  .object({
    rev,
    ...Object.fromEntries(Object.entries(intake).map(([k, s]) => [k, s.optional()])),
    guest: guestSchema.optional(),
  })
  .strict();

referralsRouter.put('/:referralId', async (req, res) => {
  const loaded = await loadReferral(req);
  const { r, patient, access } = loaded;
  assertManage(access);
  assertOpen(r);
  const body = parse(updateSchema, req.body);
  checkRev(r, body.rev);
  const movesClocks = (body.receivedAt && body.receivedAt.getTime() !== new Date(r.receivedAt).getTime()) || (body.urgency !== undefined && body.urgency !== r.urgency);
  if (movesClocks) await assertClocksNotFrozen(req, r, loaded.facts);
  const before = JSON.stringify(r.toObject());
  const was = (k) => JSON.stringify(r.toObject()[k] ?? null);
  const changed = [];
  const set = (k, value) => {
    const old = was(k);
    r[k] = value;
    if (was(k) !== old) changed.push(k);
  };
  if (body.referringDoctorId && body.referringDoctorId !== String(r.referringDoctorId)) {
    await referringDoctorFor(req, body.referringDoctorId);
    set('referringDoctorId', body.referringDoctorId);
  }
  // Checked only when changed: an older open referral can still be corrected
  if (body.receivedAt && body.receivedAt.getTime() !== new Date(r.receivedAt).getTime()) {
    checkReceivedAt(req, body.receivedAt);
    set('receivedAt', body.receivedAt);
    // What was found from her record was found for the old time: it is found again for the new one (a discharge
    // summary already released stays with the stay it was released for)
    r.firstSeen = null;
    if (!r.releases.some((x) => x.kind === 'discharge')) r.discharge = null;
  }
  if (body.centre && body.centre !== r.centre) {
    checkCentre((await settingsOf(req.tenantId)).settings, body.centre);
    set('centre', body.centre);
  }
  if (body.consultantId !== undefined && String(body.consultantId ?? '') !== String(r.consultantId ?? '')) {
    await checkConsultant(req, body.consultantId);
    set('consultantId', body.consultantId);
  }
  for (const k of ['via', 'urgency', 'otherReason', 'question']) if (body[k] !== undefined) set(k, body[k]);
  if (body.reasons) set('reasons', unique(body.reasons));
  if (body.sent) set('sent', { ...emptySent(), ...(r.toObject().sent ?? {}), ...body.sent });
  if (body.guest) {
    if (r.patientId) throw invalid({ guest: 'Her record is linked: her name, age and phone are changed on her record.' });
    set('guest', body.guest);
  }
  if (!r.reasons.length && !r.otherReason) throw invalid({ reasons: 'Choose at least one reason, or write the reason.' });
  // Its reply and seen due times follow the corrected time or urgency (worked out with today's settings)
  if (changed.includes('receivedAt') || changed.includes('urgency')) r.dues = duesFor(r.receivedAt, r.urgency, (await settingsOf(req.tenantId)).settings);
  if (JSON.stringify(r.toObject()) !== before) {
    r.rev += 1;
    r.updated = stampOf(req);
    await r.save();
    await audit(req, 'REFERRAL_UPDATED', { details: ids(r, patient, { fields: changed }) });
  }
  return respond(req, res, { ...loaded, facts: await refreshFacts(req.tenantId, [r]) });
});

// Her record: the patient she was registered as (or found as) – her referral, its files and the booking made for her
// join it.
referralsRouter.post('/:referralId/link', async (req, res) => {
  const { r, access } = await loadReferral(req);
  assertManage(access);
  assertOpen(r);
  const { patientId } = parse(z.object({ patientId: objectId }).strict(), req.body);
  if (r.patientId) {
    if (String(r.patientId) !== patientId) throw conflict('This referral is already linked to another record.', 'LINKED');
  } else {
    const patient = await patientOf(req.tenantId, patientId);
    if (!patient) throw notFound('Patient not found.');
    refuseNewOnDuplicate(patient, 'referral');
    refuseNewOnClosed(patient, 'referral');
    if (!referralAccess(req, r, patient).view) throw forbidden("This is a sensitive record of another doctor's patient: her doctor, an RMO or the referral desk links it.");
    // The desk links only the record of the woman the doctor named (her phone or her name the same): once linked, the
    // referral shows when that record was seen or admitted. Her doctor or an RMO may link it anyway.
    if (r.guest && !hasRole(req.membership, 'doctor', 'rmo')) {
      const record = await Patient.findOne({ tenantId: req.tenantId, _id: patient._id }, { fullName: 1, phone: 1 }).lean();
      if (!sameWoman(r.guest, record)) throw conflict('Her name and phone do not match this record. Ask her doctor or an RMO to link it.', 'LINK_MISMATCH');
    }
    r.patientId = patient._id;
    r.guest = null;
    r.rev += 1;
    r.updated = stampOf(req);
    await r.save();
    await filesJoinRecord(req.tenantId, r._id, patient._id);
    // The booking made for her before she was registered joins her record too
    if (r.appointmentId) {
      const appt = await Appointment.findOne({ tenantId: req.tenantId, _id: r.appointmentId });
      if (appt && !appt.patientId && appt.status === 'booked') {
        await linkPatient(req, appt, patient._id);
        await audit(req, 'APPOINTMENT_LINKED', { details: { appointmentId: String(appt._id), patientId: String(patient._id), doctorId: String(appt.doctorId), date: isoDay(appt.on) } });
      }
    }
    await audit(req, 'REFERRAL_LINKED', { details: ids(r, patient) });
  }
  const patient = await patientOf(req.tenantId, r.patientId);
  return respond(req, res, { r, patient, access: referralAccess(req, r, patient), facts: await refreshFacts(req.tenantId, [r]) });
});

// Her appointment, booked through the Appointments rules (OPD timings, leave, a time already taken – 409 SLOT_TAKEN or
// ALREADY_BOOKED, booked anyway with confirm). Before she is registered the booking holds her name and phone, as a
// quick booking on the Appointments page does. The doctor booked becomes her consultant: the reply names the time and
// that doctor together. Not once she has been seen (her next visits are booked on the Appointments page).
const bookSchema = z
  .object({ doctorId: objectId, date: requiredDateOnly('Date'), start: time, visitType: z.enum(VISIT_TYPES).default('new'), confirm: z.boolean().default(false) })
  .strict();

referralsRouter.post('/:referralId/book', async (req, res) => {
  const loaded = await loadReferral(req);
  const { r, patient, access } = loaded;
  assertManage(access);
  if (!access.book) throw forbidden('Appointments are booked by reception, the referral desk and doctors.');
  assertOpen(r);
  const body = parse(bookSchema, req.body);
  if (r.firstSeen?.at) throw conflict('She has already been seen for this referral: book her next visit on the Appointments page.', 'ALREADY_SEEN');
  // A booking still ahead (or one she came to) is moved on the Appointments page; one cancelled, or one she did not
  // come to, can be booked again – by its status as the Appointments page shows it
  if (r.appointmentId) {
    const earlier = await appointmentBrief(req.tenantId, r, req.now ?? new Date());
    if (earlier && !['cancelled', 'no_show'].includes(earlier.status)) {
      throw conflict('This referral already has an appointment. To change it, move it on the Appointments page.', 'HAS_APPOINTMENT');
    }
  }
  let whom;
  if (r.patientId) whom = { patientId: String(r.patientId) };
  else {
    const noPhone = 'Enter her phone number first: the booking needs it.';
    if (String(r.guest?.phone ?? '').replace(/\D/g, '').length < 6) throw invalid({ 'guest.phone': noPhone }, noPhone);
    whom = { guest: { name: r.guest.name, phone: r.guest.phone } };
  }
  const appt = await bookSlot(req, { ...body, ...whom, source: 'booked' });
  await audit(req, 'APPOINTMENT_BOOKED', {
    details: { appointmentId: String(appt._id), ...(appt.patientId ? { patientId: String(appt.patientId) } : {}), doctorId: String(appt.doctorId), date: isoDay(appt.on), start: appt.start, quick: !appt.patientId },
  });
  r.appointmentId = appt._id;
  r.consultantId = appt.doctorId;
  r.rev += 1;
  r.updated = stampOf(req);
  await r.save();
  await audit(req, 'REFERRAL_BOOKED', { details: ids(r, patient) });
  return respond(req, res, loaded);
});

// ---------- Files the referring doctor sent ----------

referralsRouter.post('/:referralId/attachments', async (req, res) => {
  const loaded = await loadReferral(req);
  const { r, patient, access } = loaded;
  assertManage(access);
  assertOpen(r);
  const body = parse(fileUploadSchema, req.body);
  if (r.attachments.length >= MAX_ATTACHMENTS) throw conflict(`At most ${MAX_ATTACHMENTS} files per referral.`, 'TOO_MANY');
  // (no patient yet: the file joins her record when the referral is linked to it)
  const file = await storeFile(req, { patientId: r.patientId ?? null, kind: 'referral_attachment', ownerId: r._id, body });
  r.attachments.push(fileEntry(file, stampOf(req)));
  r.rev += 1;
  await r.save();
  await audit(req, 'REFERRAL_ATTACHMENT_ADDED', { details: ids(r, patient, { fileId: String(file._id) }) });
  return respond(req, res, loaded, { status: 201 });
});

referralsRouter.get('/:referralId/attachments/:fileId', async (req, res) => {
  const { r, patient } = await loadReferral(req);
  const fileId = parse(objectId, req.params.fileId);
  if (!r.attachments.some((a) => String(a.fileId) === fileId)) throw notFound('This file was not found.');
  const file = await findFile(req, { kind: 'referral_attachment', ownerId: r._id, fileId });
  await audit(req, 'REFERRAL_ATTACHMENT_OPENED', { details: ids(r, patient, { fileId: String(file._id) }) });
  sendFile(res, file);
});

// ---------- Her agreement ----------

// Her Yes or No to the consultant note and the discharge summary going to the referring doctor (asked at her first
// visit; the reply with her appointment goes without asking). Every answer is kept; the latest counts.
referralsRouter.post('/:referralId/sharing', async (req, res) => {
  const loaded = await loadReferral(req);
  const { r, patient, access } = loaded;
  assertManage(access);
  assertLive(r);
  const { answer } = parse(z.object({ answer: z.enum(SHARING_ANSWERS, 'Choose Yes or No') }).strict(), req.body);
  const entry = { answer, ...stampOf(req) };
  r.sharing = entry;
  r.sharingHistory.push(entry);
  r.rev += 1;
  await r.save();
  await audit(req, 'REFERRAL_SHARING_ANSWERED', { details: ids(r, patient, { answer }) });
  return respond(req, res, loaded);
});

// ---------- The consultant note ----------

const noteFields = Object.fromEntries(Object.entries(NOTE_FIELDS).map(([k, max]) => [k, safeText(NOTE_LABELS[k], max).optional()]));
const noteSchema = z.object({ rev, ...noteFields }).strict();

function assertNoteDraft(r) {
  if (r.note?.status === 'signed') throw conflict('The note is signed: write an addition below it instead.', 'SIGNED');
}
const assertWriteNote = (access) => {
  if (!access.writeNote) throw forbidden(access.seesNote ? "Her doctor (any doctor while she has none) or an RMO writes the consultant note." : 'The consultant note is written by her doctor or an RMO.');
};

referralsRouter.put('/:referralId/note', async (req, res) => {
  const loaded = await loadReferral(req);
  const { r, patient, access } = loaded;
  assertWriteNote(access);
  assertLive(r);
  assertNoteDraft(r);
  const body = parse(noteSchema, req.body);
  checkNoteRev(r, body.rev);
  if (!r.note) r.note = { status: 'draft' };
  const changed = Object.keys(NOTE_FIELDS).filter((k) => body[k] !== undefined && body[k] !== (r.note[k] ?? ''));
  for (const k of changed) r.note[k] = body[k];
  r.note.saved = stampOf(req);
  r.note.rev += 1;
  await r.save();
  await audit(req, 'REFERRAL_NOTE_SAVED', { details: ids(r, patient, { fields: changed }) });
  return respond(req, res, loaded);
});

// Starts the note from her first visit after the referral: only the fields still empty are filled (nothing typed is
// replaced); never the visit's private note. filled: the fields filled; left: those left out because the visit's
// words mention the baby's sex.
referralsRouter.post('/:referralId/note/from-visit', async (req, res) => {
  const loaded = await loadReferral(req);
  const { r, patient, access } = loaded;
  assertWriteNote(access);
  assertLive(r);
  assertNoteDraft(r);
  const body = parse(z.object({ rev: rev.optional() }).strict(), req.body);
  if (body.rev !== undefined) checkNoteRev(r, body.rev);
  const visit = await firstVisitOf(req.tenantId, r);
  if (!visit) {
    throw conflict(r.firstSeen?.at ? 'She was first seen on admission, not at a visit: write the note from her stay.' : 'She has not been seen yet: the note starts from her first visit after the referral.', 'NO_VISIT');
  }
  const { fields, left } = noteFromVisit(visit, r);
  if (!r.note) r.note = { status: 'draft' };
  const filled = Object.entries(fields)
    .filter(([k, v]) => v && !String(r.note[k] ?? '').trim())
    .map(([k, v]) => {
      r.note[k] = v;
      return k;
    });
  r.note.fromVisitId = visit._id;
  r.note.saved = stampOf(req);
  r.note.rev += 1;
  await r.save();
  await audit(req, 'REFERRAL_NOTE_SAVED', { details: ids(r, patient, { fields: filled }) });
  return respond(req, res, loaded, { extra: { filled, left } });
});

referralsRouter.post('/:referralId/note/sign', async (req, res) => {
  const loaded = await loadReferral(req);
  const { r, patient, access } = loaded;
  if (!access.signNote) throw forbidden(access.writeNote ? 'A doctor signs the consultant note (an RMO may write it).' : 'Only her doctor (any doctor while she has none) signs the consultant note.');
  assertLive(r);
  if (!r.note) throw conflict('Write the note first.', 'NO_NOTE');
  assertNoteDraft(r);
  const { rev: seen } = parse(z.object({ rev }).strict(), req.body);
  checkNoteRev(r, seen);
  const missing = Object.fromEntries(NOTE_TO_SIGN.filter((k) => !String(r.note[k] ?? '').trim()).map((k) => [k, `Write “${NOTE_LABELS[k]}”.`]));
  if (Object.keys(missing).length) throw invalid(missing, 'Fill in the findings, diagnosis, plan and what returns to the referring doctor before signing.');
  r.note.status = 'signed';
  r.note.signed = stampOf(req);
  r.note.rev += 1;
  await r.save();
  await audit(req, 'REFERRAL_NOTE_SIGNED', { details: ids(r, patient) });
  return respond(req, res, loaded);
});

// A signed note never changes: a correction or addition is added below it (who, when).
referralsRouter.post('/:referralId/note/additions', async (req, res) => {
  const loaded = await loadReferral(req);
  const { r, patient, access } = loaded;
  assertWriteNote(access);
  assertLive(r);
  if (r.note?.status !== 'signed') throw conflict('Only a signed note takes an addition – change the draft itself.', 'NOT_SIGNED');
  const { text } = parse(z.object({ text: safeText('Addition', 1000) }).strict(), req.body);
  if (text.length < 3) throw invalid({ text: 'Write the addition.' });
  r.note.additions.push({ text, ...stampOf(req) });
  r.note.rev += 1;
  await r.save();
  await audit(req, 'REFERRAL_NOTE_ADDITION_ADDED', { details: ids(r, patient) });
  return respond(req, res, loaded);
});

// ---------- PDFs released to the desk ----------

// The PDF of the signed consultant note, or of her confirmed discharge card (a stay after the referral), made by the
// website and released to the desk to send. A newer release of the same kind replaces the earlier one (kept, marked
// superseded). Not after her No – nothing is sent then.
const releaseSchema = z
  .object({
    kind: z.enum(RELEASE_KINDS, 'Choose the note or the discharge summary'),
    fileName: z.string().trim().min(1).max(200),
    mediaType: z.literal('application/pdf', 'Only a PDF is released.'),
    data: z.string().min(8).max(7_000_000, 'The file is too large (at most 5 MB).'),
  })
  .strict();

referralsRouter.post('/:referralId/releases', async (req, res) => {
  const loaded = await loadReferral(req);
  const { r, patient, access } = loaded;
  if (!access.release) throw forbidden('Her doctor or an RMO releases the PDF to the referral desk.');
  assertLive(r);
  const body = parse(releaseSchema, req.body);
  if (r.sharing?.answer === 'no') throw conflict('She did not agree to share: nothing is released to send.', 'NO_CONSENT');
  let documentId = null;
  if (body.kind === 'note') {
    if (r.note?.status !== 'signed') throw conflict('Sign the consultant note first.', 'NOT_SIGNED');
  } else {
    if (!r.discharge?.dischargedAt) throw conflict('The discharge summary is released once a doctor has confirmed her discharge card of a stay after the referral.', 'NO_DISCHARGE');
    documentId = r.discharge.documentId;
  }
  const file = await storeFile(req, { patientId: r.patientId, kind: 'referral_release', ownerId: r._id, body });
  const now = req.now ?? new Date();
  for (const x of r.releases) if (x.kind === body.kind && !x.supersededAt) x.supersededAt = now;
  r.releases.push({ kind: body.kind, fileId: file._id, fileName: file.fileName, size: file.size, documentId, ...stampOf(req) });
  r.rev += 1;
  await r.save();
  await audit(req, 'REFERRAL_PDF_RELEASED', { details: ids(r, patient, { kind: body.kind, fileId: String(file._id) }) });
  return respond(req, res, loaded, { status: 201 });
});

referralsRouter.get('/:referralId/releases/:fileId', async (req, res) => {
  const { r, patient, access } = await loadReferral(req);
  const fileId = parse(objectId, req.params.fileId);
  const release = r.releases.find((x) => String(x.fileId) === fileId);
  if (!release) throw notFound('This file was not found.');
  // The desk opens it only to send it, so only after her recorded Yes (it holds her medical details); her doctor and the
  // RMOs open it any time
  if (!access.seesNote && r.sharing?.answer !== 'yes') {
    throw forbidden(r.sharing?.answer === 'no' ? 'She did not agree to share: this PDF is not sent.' : 'Ask her first: the desk gets the PDF only after her recorded Yes.');
  }
  const file = await findFile(req, { kind: 'referral_release', ownerId: r._id, fileId });
  await audit(req, 'REFERRAL_PDF_OPENED', { details: ids(r, patient, { kind: release.kind, fileId }) });
  sendFile(res, file);
});

// ---------- Messages, marked sent by hand ----------

// The desk sends from its own WhatsApp, then marks here what it sent: the reply (only when there is one to send – she is
// booked, the booking not cancelled or missed, or she was seen and has a consultant), the note or the discharge summary
// (after her Yes, the PDF released last), or another message.
referralsRouter.post('/:referralId/messages', async (req, res) => {
  const loaded = await loadReferral(req);
  const { r, patient, access, facts } = loaded;
  assertManage(access);
  assertLive(r);
  const body = parse(z.object({ what: z.enum(MESSAGE_KINDS, 'Choose what was sent'), releaseFileId: objectId.optional() }).strict(), req.body);
  let releaseFileId = null;
  if (body.what === 'reply') {
    // The reply meets promise 1 only when it told the doctor when she is seen and by whom
    const ctx = await viewContext(req, [r], { patients: new Map(patient ? [[String(patient._id), patient]] : []), facts });
    const appointment = await appointmentBrief(req.tenantId, r, ctx.now);
    if (!replyText(r, ctx, appointment)) {
      const booked = appointment && !['cancelled', 'no_show'].includes(appointment.status);
      if (!booked && !r.firstSeen?.at) throw badRequest('Book her appointment first: the reply tells the doctor when she is seen and by whom.', 'NOT_BOOKED');
      throw badRequest('Choose her consultant first: the reply tells the doctor who saw her.', 'NO_CONSULTANT');
    }
  } else if (body.what === 'note' || body.what === 'discharge') {
    const words = body.what === 'note' ? 'consultant note' : 'discharge summary';
    if (r.sharing?.answer !== 'yes') throw conflict(r.sharing?.answer === 'no' ? `She did not agree: the ${words} is not sent.` : `Ask her first: the ${words} goes only after her recorded Yes.`, 'NO_CONSENT');
    const rel = currentRelease(r, body.what);
    if (!rel) throw conflict(`The ${words} is not released yet: her doctor or an RMO releases the PDF first.`, 'NOT_RELEASED');
    if (body.releaseFileId && body.releaseFileId !== String(rel.fileId)) throw conflict(`A newer PDF of the ${words} was released: send that one.`, 'SUPERSEDED');
    releaseFileId = rel.fileId;
  } else if (body.releaseFileId) throw invalid({ releaseFileId: 'Only the note or the discharge summary is sent with a PDF.' });
  r.messages.push({ what: body.what, releaseFileId, ...stampOf(req) });
  r.rev += 1;
  await r.save();
  await audit(req, 'REFERRAL_MESSAGE_SENT', { details: ids(r, patient, { what: body.what, ...(releaseFileId ? { fileId: String(releaseFileId) } : {}) }) });
  return respond(req, res, loaded);
});

// ---------- The weekly review notes ----------

// A missed promise is reviewed by the consultants within the week: what went wrong and what changed.
referralsRouter.post('/:referralId/reviews', async (req, res) => {
  const loaded = await loadReferral(req);
  const { r, patient, access, facts } = loaded;
  if (!access.review) throw forbidden('The weekly review notes are written by doctors and RMOs.');
  assertLive(r);
  const body = parse(z.object({ promise: z.enum(REVIEW_PROMISES, 'Choose the promise'), wentWrong: safeText('What went wrong', 1000), changed: safeText('What changed', 1000) }).strict(), req.body);
  // Both halves of the review: what went wrong, and what changed so it does not happen again
  const short = { ...(body.wentWrong.length < 3 ? { wentWrong: 'Write what went wrong.' } : {}), ...(body.changed.length < 3 ? { changed: 'Write what changed.' } : {}) };
  if (Object.keys(short).length) throw invalid(short);
  const p = (await promisesNow(req, r, facts)).find((x) => x.key === body.promise);
  if (!p || !isMissed(p.state)) throw conflict('This promise was not missed.', 'NOT_MISSED');
  r.reviews.push({ promise: body.promise, wentWrong: body.wentWrong, changed: body.changed, ...stampOf(req) });
  r.rev += 1;
  await r.save();
  await audit(req, 'REFERRAL_REVIEW_ADDED', { details: ids(r, patient, { promise: body.promise }) });
  return respond(req, res, loaded, { status: 201 });
});

// ---------- Closing and cancelling ----------

// Closed: done – a promise whose clock has begun still has to be kept (it runs on and stays a miss if it is not;
// referrals/clocks.js). Cancelled: logged by mistake, so no clocks – only before anything happened on it (no message
// sent, she has not been seen, no promise late), or a cancel would wipe a miss off the weekly review. Both with a
// reason, never deleted.
const reasonSchema = z.object({ reason: safeText('Reason', 300) }).strict();
for (const [path, status, action] of [
  ['close', 'closed', 'REFERRAL_CLOSED'],
  ['cancel', 'cancelled', 'REFERRAL_CANCELLED'],
]) {
  referralsRouter.post(`/:referralId/${path}`, async (req, res) => {
    const loaded = await loadReferral(req);
    const { r, patient, access, facts } = loaded;
    assertManage(access);
    assertOpen(r);
    const { reason } = parse(reasonSchema, req.body);
    if (reason.length < 3) throw invalid({ reason: `Write why the referral is ${status}.` });
    if (status === 'cancelled' && ((r.messages ?? []).length || r.firstSeen?.at || (await promisesNow(req, r, facts)).some((p) => isMissed(p.state)))) {
      throw conflict('Only a referral logged by mistake, before anything happened, is cancelled. Close it instead – any missed promise stays on record.', 'NOT_CANCELLABLE');
    }
    r.status = status;
    r[status] = { ...stampOf(req), reason };
    r.rev += 1;
    await r.save();
    await audit(req, action, { details: ids(r, patient) });
    return respond(req, res, loaded);
  });
}
