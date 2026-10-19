// Referrals from other doctors (docs/REFERRALS_PLAN.md): who may do what with a referral, the facts the app finds by
// itself from her record (her first visit or admission after the referral, her discharge), and what the website
// gets – the list row, the whole referral, the reply text for the referring doctor and a consultant note started from
// her first visit. Used by routes/referrals.js and routes/referringDoctors.js.
//
// Rules this file keeps:
//  - every query starts with this hospital's tenantId;
//  - the referral desk sees the referral's own fields, the PDFs released to it and her appointment's day, time,
//    doctor and status – never a visit, a lab result, a care plan, or the words of the consultant note (it sends the
//    released PDF, not the text);
//  - doctors and RMOs see a referral only while it has no patient yet, or when they may see her medical details
//    (utils/patientAccess.js) – so never a sensitive record of another doctor's patient;
//  - a note started from a visit never takes the visit's private note, and nothing that mentions the baby's sex.

import { BOOKING_ROLES } from '../appointments/appointmentRules.js';
import { addDays, dateWords, hospitalToday, isoDay, timeIn, utcDay } from '../careplans/dates.js';
import { dayStates, statusOf } from '../appointments/appointmentService.js';
import { Admission } from '../models/Admission.js';
import { Appointment } from '../models/Appointment.js';
import { ClinicalDocument } from '../models/ClinicalDocument.js';
import { hasRole } from '../models/Membership.js';
import { Patient, currentAge } from '../models/Patient.js';
import { MAX_ATTACHMENTS, NOTE_FIELDS, Referral, SENT_FIELDS } from '../models/Referral.js';
import { ReferringDoctor } from '../models/ReferringDoctor.js';
import { StoredFile } from '../models/StoredFile.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { timeWords } from '../reminders/messages.js';
import { patientAccess } from '../utils/patientAccess.js';
import { mentionsFetalSex } from '../utils/pcpndt.js';
import { isRunning, nextPromise, promisesFor } from './clocks.js';
import { reasonByKey } from './reasons.js';
import { referralSettingsFor } from './settings.js';

// Who works with referrals (owner, 15 Oct 2026): the referral desk, doctors and RMOs. Nurses, reception, the lab, the
// pharmacist and the sonologist: nothing; the hospital admin keeps the settings only (referrals are patient data).
export const REFERRAL_ROLES = ['referral_desk', 'doctor', 'rmo'];

// ---------- Who may do what ----------

/**
 * What this person may do with this referral (patient: her record, or null before she is linked).
 *  - the desk: everything but the consultant note and the weekly review notes, on every referral of the hospital;
 *  - doctors and RMOs: the same, for referrals they may open (no patient yet, or her medical details are theirs to
 *    see); the note – written by her doctor (any doctor while she has none) or an RMO, signed by a doctor among them,
 *    released as a PDF by those who may write it; the weekly review notes.
 */
export function referralAccess(req, referral, patient) {
  const desk = hasRole(req.membership, 'referral_desk');
  const clinician = hasRole(req.membership, 'doctor', 'rmo');
  const a = patient ? patientAccess(req, patient) : null;
  const clinicalView = clinician && (!patient || a.view.has('pregnancy'));
  const writeNote = Boolean(patient) && clinician && a.editClinical === true;
  return {
    view: desk || clinicalView,
    manage: desk || clinicalView, // edit, link, attach, her answer, mark sent, close
    // Booking follows the Appointments rules (owner, 3 Oct 2026: reception and doctors book, not RMOs) – the desk too
    book: (desk || clinicalView) && hasRole(req.membership, ...BOOKING_ROLES),
    seesNote: clinicalView, // the words of the consultant note (the desk gets the released PDF)
    writeNote,
    signNote: writeNote && hasRole(req.membership, 'doctor'),
    release: writeNote,
    review: clinicalView,
    desk,
  };
}

// ---------- The hospital's settings ----------

/** The referral settings (defaults filled in) and the hospital's name as printed. */
export async function settingsOf(tenantId) {
  const tenant = await Tenant.findById(tenantId, { name: 1, letterhead: 1, referrals: 1 }).lean();
  return { settings: referralSettingsFor(tenant), hospitalName: tenant?.letterhead?.name || tenant?.name || 'the hospital' };
}

export const centreName = (settings, key) => settings.centres.find((c) => c.key === key)?.name ?? key;

// ---------- Facts found from her record ----------

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Brings what the app finds by itself up to date, for these referrals (documents), and stores what changed:
 *  - a booking made for her before she was registered, then linked to her record on the Appointments page: the
 *    referral learns her record too (routes/appointments.js does it at the link; this catches any left over);
 *  - firstSeen: her earliest visit (not entered in error) started at or after the referral reached the hospital – or
 *    on the same hospital day, even a little before it was logged (she walked in with the letter and was seen before
 *    the desk typed it in) – or her earliest stay from then, or the stay she was already in when it came (admitted at
 *    22:00, the unit line logged at 22:30) – whichever came first. firstSeen.at is that visit's start or that stay's
 *    admission, so it can be before receivedAt: the 'seen' promise is then met. Kept once found; found again only if
 *    that visit is later marked entered in error;
 *  - discharge: the first of those stays whose discharge card a doctor confirmed.
 * Only while the referral is open: once it is closed nothing found later changes its clocks (a visit months later
 * for something else is not this referral's), and a cancelled one has none.
 * Returns Map "<referralId>" → { inHospital } (one of those stays still open: her discharge clock is to come).
 */
export async function refreshFacts(tenantId, referrals) {
  const facts = new Map();
  const live = referrals.filter((r) => r.status !== 'cancelled');

  // 1. Her record, from the booking
  const unlinked = live.filter((r) => !r.patientId && r.appointmentId);
  if (unlinked.length) {
    const appts = await Appointment.find({ tenantId, _id: { $in: unlinked.map((r) => r.appointmentId) }, patientId: { $ne: null } }, { patientId: 1 }).lean();
    const patientOf = new Map(appts.map((a) => [String(a._id), a.patientId]));
    for (const r of unlinked) {
      const pid = patientOf.get(String(r.appointmentId));
      if (!pid) continue;
      const done = await Referral.updateOne({ _id: r._id, tenantId, patientId: null }, { $set: { patientId: pid, guest: null } });
      if (done.modifiedCount) {
        r.patientId = pid;
        r.guest = null;
        await filesJoinRecord(tenantId, r._id, pid);
      }
    }
  }

  // 2. Her first visit or admission, her discharge – open referrals only
  const linked = live.filter((r) => r.status === 'open' && r.patientId);
  if (!linked.length) return facts;
  const seenVisitIds = linked.map((r) => r.firstSeen?.visitId).filter(Boolean);
  const enteredInError = seenVisitIds.length ? new Set((await Visit.find({ tenantId, _id: { $in: seenVisitIds }, status: 'cancelled' }, { _id: 1 }).lean()).map((v) => String(v._id))) : new Set();
  const seek = linked.filter((r) => !r.firstSeen?.at || (r.firstSeen.visitId && enteredInError.has(String(r.firstSeen.visitId))));
  const pids = [...new Set(linked.map((r) => String(r.patientId)))];
  const since = new Date(Math.min(...linked.map((r) => new Date(r.receivedAt).getTime())));
  const seekPids = [...new Set(seek.map((r) => String(r.patientId)))];
  const seekDays = [...new Set(seek.map((r) => isoDay(hospitalToday(new Date(r.receivedAt)))))].map((d) => utcDay(d));
  const [visits, stays] = await Promise.all([
    seekPids.length
      ? Visit.find({ tenantId, patientId: { $in: seekPids }, status: 'active', $or: [{ createdAt: { $gte: since } }, { visitOn: { $in: seekDays } }] }, { patientId: 1, createdAt: 1, visitOn: 1 })
          .sort({ createdAt: 1 })
          .lean()
      : [],
    // (with the stays that were still going on then: not discharged, or discharged since)
    Admission.find({ tenantId, patientId: { $in: pids }, $or: [{ admittedAt: { $gte: since } }, { dischargedAt: null }, { dischargedAt: { $gte: since } }] }, { patientId: 1, admittedAt: 1, status: 1, dischargedAt: 1 })
      .sort({ admittedAt: 1 })
      .lean(),
  ]);
  const discharged = stays.filter((s) => s.status === 'discharged');
  const cards = discharged.length
    ? await ClinicalDocument.find({ tenantId, admissionId: { $in: discharged.map((s) => s._id) }, kind: 'discharge', status: 'signed' }, { admissionId: 1, 'content.dischargedAt': 1 }).lean()
    : [];
  const cardOf = new Map(cards.map((c) => [String(c.admissionId), c]));

  for (const r of linked) {
    const pid = String(r.patientId);
    const from = new Date(r.receivedAt).getTime();
    const day = isoDay(hospitalToday(new Date(r.receivedAt)));
    const after = (t) => t && new Date(t).getTime() >= from;
    // Her stays for this referral: begun since it came, or the one she was in when it came
    const inProgress = (s) => !after(s.admittedAt) && (!s.dischargedAt || after(s.dischargedAt));
    const mine = stays.filter((s) => String(s.patientId) === pid && (after(s.admittedAt) || inProgress(s)));
    const set = {};
    if (seek.includes(r)) {
      const visit = visits.find((v) => String(v.patientId) === pid && (after(v.createdAt) || (v.visitOn && isoDay(v.visitOn) === day)));
      const stay = mine[0];
      let firstSeen = null;
      if (visit && (!stay || visit.createdAt <= stay.admittedAt)) firstSeen = { at: visit.createdAt, visitId: visit._id, admissionId: null };
      else if (stay) firstSeen = { at: stay.admittedAt, visitId: null, admissionId: stay._id };
      if (!sameJson(firstSeen, r.firstSeen?.toObject?.() ?? r.firstSeen)) set.firstSeen = firstSeen;
    }
    if (!r.discharge?.dischargedAt) {
      const stay = mine.find((s) => s.status === 'discharged' && cardOf.has(String(s._id)));
      if (stay) {
        const card = cardOf.get(String(stay._id));
        set.discharge = { admissionId: stay._id, documentId: card._id, dischargedAt: stay.dischargedAt ?? new Date(card.content?.dischargedAt) };
      }
    }
    facts.set(String(r._id), { inHospital: mine.some((s) => s.status === 'admitted') });
    if (Object.keys(set).length) {
      await Referral.updateOne({ _id: r._id, tenantId }, { $set: set });
      for (const [k, v] of Object.entries(set)) r[k] = v;
    }
  }
  return facts;
}

/**
 * The referral's attached files belong to her record once the referral knows it (they came before she was
 * registered). Only the files' owner record is filled in – a file is never changed.
 */
export async function filesJoinRecord(tenantId, referralId, patientId) {
  await StoredFile.updateMany({ tenantId, kind: { $in: ['referral_attachment', 'referral_release'] }, ownerId: referralId, patientId: null }, { $set: { patientId } });
}

/**
 * A booking made for a referral before she was registered was linked to her record (routes/appointments.js POST
 * /:id/link): the referral joins her record at once – so it is on her record's Referrals tab straight away – and its
 * files with it.
 */
export async function bookingJoinsRecord(tenantId, appointmentId, patientId) {
  const refs = await Referral.find({ tenantId, appointmentId, patientId: null }, { _id: 1 }).lean();
  if (!refs.length) return;
  await Referral.updateMany({ tenantId, appointmentId, patientId: null }, { $set: { patientId, guest: null } });
  for (const r of refs) await filesJoinRecord(tenantId, r._id, patientId);
}

// ---------- Linking her record ----------

const phoneTail = (v) => String(v ?? '').replace(/\D/g, '').slice(-10);
const nameKey = (v) => String(v ?? '').toLowerCase().replace(/[\s.]/g, '');

/**
 * Whether a record (fullName, phone) is the woman the referring doctor named (the referral's guest): the same phone
 * (its last 10 digits) or the same name (case, spaces and dots aside). The desk links a referral only to such a
 * record – otherwise it could join a referral to any woman's record and read when she was seen or admitted; her doctor
 * or an RMO may link it anyway (a new phone, a name spelt otherwise). True when there is no guest to compare.
 */
export function sameWoman(guest, record) {
  if (!guest) return true;
  const phone = phoneTail(guest.phone);
  if (phone.length === 10 && phone === phoneTail(record?.phone)) return true;
  const name = nameKey(guest.name);
  return name.length > 0 && name === nameKey(record?.fullName);
}

// ---------- What the website gets ----------

const PATIENT_FIELDS = { fullName: 1, mrn: 1, ageYears: 1, ageRecordedOn: 1, createdAt: 1, assignedDoctor: 1, sensitive: 1, careType: 1, duplicateOf: 1, 'death.on': 1 };

/** The patients of these referrals (enough to check access, and name, number and age): Map "<id>" → patient. */
export async function patientsOf(tenantId, referrals) {
  const ids = [...new Set(referrals.map((r) => r.patientId && String(r.patientId)).filter(Boolean))];
  const rows = ids.length ? await Patient.find({ tenantId, _id: { $in: ids } }, PATIENT_FIELDS).lean() : [];
  return new Map(rows.map((p) => [String(p._id), p]));
}
export const patientOf = (tenantId, id) => (id ? Patient.findOne({ tenantId, _id: id }, PATIENT_FIELDS).lean() : null);

/**
 * Everything the views of these referrals need, in a few queries: the settings, the referring doctors, the hospital's
 * doctors named on them, and (given) the patients and the facts from refreshFacts.
 */
export async function viewContext(req, referrals, { patients, facts = new Map() } = {}) {
  const tenantId = req.tenantId;
  const rdIds = [...new Set(referrals.map((r) => String(r.referringDoctorId)))];
  const userIds = [...new Set(referrals.map((r) => r.consultantId && String(r.consultantId)).filter(Boolean))];
  const [{ settings, hospitalName }, doctors, users] = await Promise.all([
    settingsOf(tenantId),
    rdIds.length ? ReferringDoctor.find({ tenantId, _id: { $in: rdIds } }).lean() : [],
    userIds.length ? User.find({ _id: { $in: userIds } }, { name: 1 }).lean() : [],
  ]);
  return {
    now: req.now ?? new Date(),
    settings,
    hospitalName,
    patients: patients ?? (await patientsOf(tenantId, referrals)),
    referringDoctors: new Map(doctors.map((d) => [String(d._id), d])),
    users: new Map(users.map((u) => [String(u._id), u])),
    facts,
  };
}

const stampView = (s) => (s ? { byName: s.byName ?? '', at: s.at ?? null } : null);
const idOf = (v) => (v ? String(v) : null);

/** What the clocks need of a referral (referrals/clocks.js). */
export const clockFacts = (r, facts) => ({
  status: r.status,
  urgency: r.urgency,
  receivedAt: r.receivedAt,
  closed: r.closed,
  firstSeen: r.firstSeen,
  discharge: r.discharge,
  inHospital: facts?.get(String(r._id))?.inHospital ?? false,
  dues: r.dues ?? null,
  sharing: r.sharing,
  note: r.note,
  messages: r.messages,
});

/** The released PDF of this kind that is current (not replaced by a newer one), or null. */
export const currentRelease = (r, kind) => (r.releases ?? []).find((x) => x.kind === kind && !x.supersededAt) ?? null;
const sentRelease = (r, rel) => Boolean(rel) && (r.messages ?? []).some((m) => m.releaseFileId && String(m.releaseFileId) === String(rel.fileId));

/**
 * What is waiting on this referral: reply – the reply to the referring doctor is not sent yet; note – she was seen
 * and her consultant note is not signed; release – a signed note or a confirmed discharge card is not yet released
 * as a PDF (unless she said No); send – a message is ready for the desk to send (a released PDF not yet sent, after
 * her Yes; the reply is `reply`).
 * promises: its promises now (promisesFor). Once closed, the work of a promise counts only while that promise still
 * runs (waiting, soon or late) – so the Today tiles agree with the clocks – and the reply no longer counts.
 */
export function waitingOf(r, promises = []) {
  const open = r.status === 'open';
  const live = r.status !== 'cancelled';
  const said = r.sharing?.answer ?? null;
  const running = (key) => open || promises.some((p) => p.key === key && isRunning(p.state));
  const replied = (r.messages ?? []).some((m) => m.what === 'reply');
  const toRelease = (kind) => (kind === 'note' ? r.note?.status === 'signed' : Boolean(r.discharge?.dischargedAt)) && !currentRelease(r, kind);
  const toSend = (kind) => currentRelease(r, kind) && !sentRelease(r, currentRelease(r, kind));
  return {
    reply: open && !replied,
    note: live && running('note') && Boolean(r.patientId) && Boolean(r.firstSeen?.at) && r.note?.status !== 'signed',
    release: live && said !== 'no' && ['note', 'discharge'].some((k) => running(k) && toRelease(k)),
    send: live && said === 'yes' && ['note', 'discharge'].some((k) => running(k) && toSend(k)), // a released note or discharge card to send
  };
}

/** One row of the desk's list. */
export function listView(r, ctx) {
  const p = r.patientId ? ctx.patients.get(String(r.patientId)) : null;
  const rd = ctx.referringDoctors.get(String(r.referringDoctorId));
  const consultant = r.consultantId ? ctx.users.get(String(r.consultantId)) : null;
  const promises = promisesFor(clockFacts(r, ctx.facts), ctx.now, ctx.settings);
  return {
    id: String(r._id),
    number: r.number,
    centre: r.centre,
    centreName: centreName(ctx.settings, r.centre),
    status: r.status,
    urgency: r.urgency,
    receivedAt: r.receivedAt,
    via: r.via,
    referringDoctor: { id: String(r.referringDoctorId), name: rd?.name ?? '', clinic: rd?.clinic ?? '' },
    patient: p ? { id: String(p._id), fullName: p.fullName, mrn: p.mrn, ageYears: currentAge(p, ctx.now) } : null,
    guest: !r.patientId && r.guest ? { name: r.guest.name, phone: r.guest.phone ?? '', ageYears: r.guest.ageYears ?? null } : null,
    consultant: consultant ? { id: String(consultant._id), name: consultant.name } : null,
    promises,
    next: nextPromise(promises),
    sharing: r.sharing ? { answer: r.sharing.answer, byName: r.sharing.byName ?? '', at: r.sharing.at ?? null } : null,
    waiting: waitingOf(r, promises),
  };
}

/** The appointment booked for the referral: { id, date, start, doctorName, status } (status as the Appointments page). */
export async function appointmentBrief(tenantId, r, now) {
  if (!r.appointmentId) return null;
  const a = await Appointment.findOne({ tenantId, _id: r.appointmentId }).lean();
  if (!a) return null;
  const [doctor, states] = await Promise.all([User.findById(a.doctorId, { name: 1 }).lean(), a.patientId ? dayStates(tenantId, [a.patientId], a.on) : new Map()]);
  return {
    id: String(a._id),
    date: isoDay(a.on),
    start: a.start ?? null,
    doctorName: doctor?.name ?? 'Doctor',
    status: statusOf(a, a.patientId ? states.get(String(a.patientId)) : null, hospitalToday(now)),
  };
}

/** The doctor who signed the note, with what is printed under the signature. */
export const noteSignerOf = async (r) => (r.note?.signed?.by ? User.findById(r.note.signed.by, { name: 1, professional: 1 }).lean() : null);

/** The consultant note. Its words only for those who may see her medical details (null for the desk). */
function noteView(note, seesNote, signer) {
  if (!note) return null;
  const words = (k) => (seesNote ? (note[k] ?? '') : null);
  return {
    status: note.status,
    fromVisitId: seesNote ? idOf(note.fromVisitId) : null,
    ...Object.fromEntries(Object.keys(NOTE_FIELDS).map((k) => [k, words(k)])),
    saved: stampView(note.saved),
    signed: note.signed
      ? { ...stampView(note.signed), qualification: signer?.professional?.qualification ?? '', registrationNumber: signer?.professional?.registrationNumber ?? '', council: signer?.professional?.council ?? '' }
      : null,
    additions: seesNote ? (note.additions ?? []).map((x) => ({ text: x.text, byName: x.byName ?? '', at: x.at ?? null })) : [],
    rev: note.rev ?? 0,
  };
}

/** The whole referral, for its page. extra: { appointment (appointmentBrief), signer (noteSignerOf) }. */
export function fullView(r, ctx, access, { appointment = null, signer = null } = {}) {
  const base = listView(r, ctx);
  const rd = ctx.referringDoctors.get(String(r.referringDoctorId));
  const consultant = r.consultantId ? ctx.users.get(String(r.consultantId)) : null;
  const open = r.status === 'open';
  const live = r.status !== 'cancelled';
  const said = r.sharing?.answer ?? null;
  // (a booking cancelled, or one she did not come to, can be made again – until she has been seen)
  const booked = appointment && !['cancelled', 'no_show'].includes(appointment.status);
  return {
    ...base,
    reasons: (r.reasons ?? []).map((key) => ({ key, label: reasonByKey.get(key)?.label ?? key, group: reasonByKey.get(key)?.group ?? null })),
    otherReason: r.otherReason ?? '',
    question: r.question ?? '',
    sent: Object.fromEntries(SENT_FIELDS.map((k) => [k, r.sent?.[k] ?? ''])),
    attachments: (r.attachments ?? []).map((a) => ({ id: String(a.fileId), fileName: a.fileName, mediaType: a.mediaType, size: a.size, byName: a.byName ?? '', at: a.at ?? null })),
    appointment,
    // onAdmission: first seen on a stay, not at a visit (the note is not started from a visit then)
    firstSeen: r.firstSeen?.at ? { at: r.firstSeen.at, onAdmission: !r.firstSeen.visitId && Boolean(r.firstSeen.admissionId) } : null,
    // The desk gets only when she was discharged (for the clock) – never which stay or which card
    discharge: r.discharge?.dischargedAt
      ? { dischargedAt: r.discharge.dischargedAt, ...(access.seesNote ? { admissionId: idOf(r.discharge.admissionId), documentId: idOf(r.discharge.documentId) } : {}) }
      : null,
    note: noteView(r.note, access.seesNote, signer),
    releases: (r.releases ?? []).map((x) => ({ id: String(x.fileId), kind: x.kind, fileName: x.fileName, size: x.size, byName: x.byName ?? '', at: x.at ?? null, superseded: Boolean(x.supersededAt) })),
    messages: (r.messages ?? []).map((m) => ({ what: m.what, releaseFileId: idOf(m.releaseFileId), byName: m.byName ?? '', at: m.at ?? null })),
    reviews: (r.reviews ?? []).map((x) => ({ promise: x.promise, wentWrong: x.wentWrong ?? '', changed: x.changed ?? '', byName: x.byName ?? '', at: x.at ?? null })),
    referringDoctor: { id: String(r.referringDoctorId), name: rd?.name ?? '', clinic: rd?.clinic ?? '', qualification: rd?.qualification ?? '', phone: rd?.phone ?? '' },
    consultant: consultant ? { id: String(consultant._id), name: consultant.name, directLine: ctx.settings.consultantLines.find((l) => l.userId === String(consultant._id))?.phone ?? '' } : null,
    replyText: replyText(r, ctx, appointment),
    closed: r.closed ? { ...stampView(r.closed), reason: r.closed.reason ?? '' } : null,
    cancelled: r.cancelled ? { ...stampView(r.cancelled), reason: r.cancelled.reason ?? '' } : null,
    created: stampView(r.created),
    rev: r.rev ?? 0,
    access: {
      canEdit: access.manage && open,
      canLink: access.manage && open && !r.patientId,
      canBook: access.book && open && !booked && !r.firstSeen?.at,
      canAttach: access.manage && open && (r.attachments ?? []).length < MAX_ATTACHMENTS,
      canAnswerSharing: access.manage && live,
      canWriteNote: access.writeNote && live && r.note?.status !== 'signed',
      canSignNote: access.signNote && live && r.note?.status !== 'signed', // (an unsaved note is saved, then signed)
      canAddToNote: access.writeNote && live && r.note?.status === 'signed', // a correction or addition below it
      canRelease: access.release && live && said !== 'no' && (r.note?.status === 'signed' || Boolean(r.discharge?.dischargedAt)),
      canMarkSent: access.manage && live,
      canReview: access.review && live,
      canClose: access.manage && open,
    },
  };
}

// ---------- The reply to the referring doctor ----------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayWords = (iso) => {
  const d = utcDay(iso);
  return `${WEEKDAYS[d.getUTCDay()]} ${dateWords(d)}`;
};
const doctorWords = (name) => (/^dr\b\.?/i.test(String(name ?? '').trim()) ? String(name).trim() : `Dr ${String(name ?? '').trim()}`);

/**
 * The reply the desk copies into its own WhatsApp (promise 1: the appointment time and the consultant who will see
 * her). Plain text: a greeting, her first name and age, the day and time, the consultant and the centre, the referral
 * number and the desk's number – never anything clinical (a phone is often shared, and the reply goes without asking
 * her). null while there is nothing true to tell: she is not booked (a booking cancelled, or one she did not come to,
 * does not count) and not seen yet – or she was seen and no consultant is chosen. The reply cannot be marked sent
 * while it is null (routes/referrals.js).
 */
export function replyText(r, ctx, appointment) {
  const rd = ctx.referringDoctors.get(String(r.referringDoctorId));
  const p = r.patientId ? ctx.patients.get(String(r.patientId)) : null;
  const name = p?.fullName ?? r.guest?.name ?? '';
  const age = p ? currentAge(p, ctx.now) : (r.guest?.ageYears ?? null);
  const centre = centreName(ctx.settings, r.centre);
  const firstName = name.trim().split(/\s+/)[0] || 'your patient';
  const lines = [`Dear ${doctorWords(rd?.name)},`, `Thank you for referring ${firstName}${age != null ? ` (${age} years)` : ''} to ${ctx.hospitalName}.`];
  if (appointment && !['cancelled', 'no_show'].includes(appointment.status) && appointment.start) {
    // The appointment is with the doctor booked: named as such, so the time and the doctor always go together
    lines.push(`Her appointment: ${dayWords(appointment.date)} at ${timeWords(appointment.start)} with ${appointment.doctorName}, ${centre}.`);
  } else if (r.firstSeen?.at) {
    const consultant = r.consultantId ? ctx.users.get(String(r.consultantId))?.name : null;
    if (!consultant) return null;
    lines.push(`She was seen on ${dateWords(hospitalToday(r.firstSeen.at))} at ${timeIn(r.firstSeen.at)}, ${centre}. Her consultant: ${consultant}.`);
  } else return null;
  lines.push(`Referral number: ${r.number}.`);
  if (ctx.settings.deskNumber) lines.push(`Referral desk (WhatsApp): ${ctx.settings.deskNumber}`);
  lines.push(ctx.hospitalName);
  return lines.join('\n');
}

// ---------- A consultant note started from her first visit ----------

const FREQUENCY_WORDS = { sos: 'when needed', stat: 'once, now', weekly: 'weekly', alternate: 'alternate days' };
const DURATION_WORDS = { till_delivery: 'till delivery', continue: 'continue' };

/** One medicine as a line: "TAB. Iron 100 mg 1-0-1 for 30 days" (the dose and timing stay on her prescription). */
function medicineLine(it) {
  const frequency = it.frequency === 'custom' ? it.frequencyText : (FREQUENCY_WORDS[it.frequency] ?? it.frequency);
  const duration = DURATION_WORDS[it.durationUnit] ?? (it.durationValue && it.durationUnit ? `for ${it.durationValue} ${it.durationUnit}` : '');
  return [it.form && it.form !== 'other' ? `${it.form.toUpperCase()}.` : '', it.drug, it.strength, frequency, duration].filter(Boolean).join(' ');
}

/**
 * The note's fields from her visit (the visit is read WITHOUT its private note): her complaints, the examination and
 * the measurements → findings; the diagnosis; the tests, advice and medicines → plan; the next visit → next at the
 * hospital; the referring doctor's question → restated (the consultant rewrites it in one line). A part that
 * mentions the baby's sex is left out (returned in `left`), so the note never carries it.
 */
export function noteFromVisit(visit, referral) {
  const v = visit.vitals ?? {};
  const d = visit.details ?? {};
  const items = visit.prescription?.items ?? [];
  const measured = [
    v.bpSystolic != null && v.bpDiastolic != null ? `BP ${v.bpSystolic}/${v.bpDiastolic} mmHg` : null,
    v.pulse != null ? `pulse ${v.pulse}/min` : null,
    v.temperatureF != null ? `temperature ${v.temperatureF} °F` : null,
    v.spo2 != null ? `SpO2 ${v.spo2}%` : null,
    v.weightKg != null ? `weight ${v.weightKg} kg` : null,
    v.hb != null ? `Hb ${v.hb} g/dL` : null,
    v.urineAlbumin ? `urine albumin ${v.urineAlbumin}` : null,
    v.urineSugar ? `urine sugar ${v.urineSugar}` : null,
  ].filter(Boolean);
  const pregnancyCheck = [
    d.fundalHeightCm != null ? `fundal height ${d.fundalHeightCm} cm` : null,
    d.fetalHeartRate != null ? `fetal heart ${d.fetalHeartRate}/min` : null,
    d.presentation ? `presentation ${d.presentation}` : null,
    d.fetalMovements ? `fetal movements ${d.fetalMovements}` : null,
    d.oedema ? `oedema ${d.oedema}` : null,
  ].filter(Boolean);
  const medicines = items.map(medicineLine).filter(Boolean);
  const lines = (parts) => parts.filter(Boolean).join('\n');
  const fields = {
    questionRestated: String(referral.question ?? '').split('\n')[0].trim(),
    findings: lines([
      d.complaints && `Complaints: ${d.complaints}`,
      d.examination && `Examination: ${d.examination}`,
      pregnancyCheck.length && `Pregnancy check: ${pregnancyCheck.join(', ')}`,
      measured.length && `Measurements: ${measured.join(', ')}`,
    ]),
    diagnosis: d.diagnosis ?? '',
    plan: lines([d.investigations && `Tests: ${d.investigations}`, d.advice && `Advice: ${d.advice}`, medicines.length && `Medicines: ${medicines.join('; ')}`]),
    nextAtAnandi: d.nextVisitOn ? [dateWords(d.nextVisitOn), d.nextVisitNote].filter(Boolean).join(' – ') : '',
  };
  const out = {};
  const left = [];
  for (const [k, value] of Object.entries(fields)) {
    const text = String(value ?? '').trim().slice(0, NOTE_FIELDS[k]);
    if (mentionsFetalSex(text)) left.push(k);
    else out[k] = text;
  }
  return { fields: out, left };
}

/** Her first visit for the referral, without the private note (null when she was first seen on admission). */
export const firstVisitOf = (tenantId, r) =>
  r.firstSeen?.visitId ? Visit.findOne({ tenantId, _id: r.firstSeen.visitId, status: 'active' }, { 'details.privateNote': 0, aiCheck: 0 }).lean() : null;

// ---------- Weeks and quarters ----------

/** The Monday-to-Sunday week of a hospital date: { from, to } as date-only values. */
export function weekOf(day) {
  const d = utcDay(day);
  const from = addDays(d, -((d.getUTCDay() + 6) % 7));
  return { from, to: addDays(from, 6) };
}

/** A quarter ("2026-Q4") as hospital dates: { key, from, to }; null when the text is not a quarter. */
export function quarterOf(key) {
  const m = /^(\d{4})-Q([1-4])$/.exec(String(key ?? ''));
  if (!m) return null;
  const year = Number(m[1]);
  const q = Number(m[2]);
  const from = new Date(Date.UTC(year, (q - 1) * 3, 1));
  const to = addDays(new Date(Date.UTC(year, q * 3, 1)), -1);
  return { key, from, to };
}
/** The quarter of a hospital date ("2026-Q4"). */
export const quarterKey = (day) => `${utcDay(day).getUTCFullYear()}-Q${Math.floor(utcDay(day).getUTCMonth() / 3) + 1}`;
