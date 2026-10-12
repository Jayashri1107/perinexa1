// Possible matches at registration, and marking a record as a duplicate of another (the rules and the words are in
// duplicateRules.js). Every query carries the hospital's tenantId; another hospital's records are never looked at.
//
// SAFETY: nothing is ever joined automatically, nothing is moved between records or deleted. The one thing that
// moves is her booked appointments from today on (she is expected under the main record); "Undo" brings back the
// ones that are still ahead. The registration warning never reads a matching record's clinical details; what an
// earlier record has that the main record lacks (duplicateCompare.js) goes only to those who may see the medical
// details of both records.

import { hospitalToday, sameDay } from '../careplans/dates.js';
import { Appointment } from '../models/Appointment.js';
import { Arrival } from '../models/Arrival.js';
import { Patient, currentAge } from '../models/Patient.js';
import { ReminderMessage } from '../models/ReminderMessage.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { leftBehind, markingCheck } from './duplicateCompare.js';
import { DUPLICATE_MESSAGE_REASON, isDuplicate, lastFourDigits, matchedOn, nameKey, namePattern, phoneKeys, phonePattern } from './duplicateRules.js';
import { CLOSED_CANCEL_REASON, isClosed } from './deathRules.js';
import { cancelAppointment } from '../appointments/appointmentService.js';

// ---------- Possible matches at registration ----------

// How many matching records the warning shows (the closest first), and how many the search reads at most.
export const MAX_MATCHES_SHOWN = 5;
const MAX_CANDIDATES = 200;
// What is read of a candidate: what the warning may show, and what the need-to-know rules look at. Nothing clinical.
const MATCH_FIELDS = 'mrn fullName phone ageYears ageRecordedOn createdAt careType newborn.birthAt assignedDoctor sensitive duplicateOf';

/**
 * Records of THIS hospital that may be the person being registered: the same phone number (digits compared, with or
 * without +91 or a leading 0) or the same name (capitals, spaces and dots ignored).
 * A baby is matched only against babies – never against the mother, who shares the phone number – and everyone else
 * never against a baby. A match that is itself marked as a duplicate is answered with its main record.
 * Returns { matches, total, ids }: `matches` are the closest MAX_MATCHES_SHOWN as the person registering may see
 * them (matchView); `ids` are the ids of all of them, for the audit log.
 */
export async function possibleMatches(req, { fullName, phone, careType }) {
  const keys = { phones: phoneKeys(phone), name: nameKey(fullName) };
  const or = [...keys.phones.map((k) => ({ phone: phonePattern(k) })), ...(keys.name ? [{ fullName: namePattern(keys.name) }] : [])];
  if (!or.length) return { matches: [], total: 0, ids: [] };
  const tenantId = req.tenantId;
  const sameKind = { careType: careType === 'newborn' ? 'newborn' : { $ne: 'newborn' } };
  const candidates = await Patient.find({ tenantId, ...sameKind, $or: or }).select(MATCH_FIELDS).sort({ createdAt: -1, _id: -1 }).limit(MAX_CANDIDATES).lean();
  // Compared again exactly (the patterns only narrow the search)
  const hits = candidates.map((p) => ({ p, on: matchedOn(p, keys) })).filter((h) => h.on.length);
  if (!hits.length) return { matches: [], total: 0, ids: [] };

  // A duplicate is answered with its main record (of the same kind: a baby's main record is a baby's)
  const mainIds = [...new Set(hits.filter((h) => isDuplicate(h.p)).map((h) => String(h.p.duplicateOf.patient)))];
  const mains = mainIds.length ? await Patient.find({ tenantId, _id: { $in: mainIds }, ...sameKind }).select(MATCH_FIELDS).lean() : [];
  const mainOf = new Map(mains.map((m) => [String(m._id), m]));
  const byId = new Map(); // id -> { p, on: Set }
  for (const h of hits) {
    const p = isDuplicate(h.p) ? mainOf.get(String(h.p.duplicateOf.patient)) : h.p;
    if (!p || isDuplicate(p)) continue;
    const id = String(p._id);
    if (!byId.has(id)) byId.set(id, { p, on: new Set() });
    h.on.forEach((k) => byId.get(id).on.add(k));
  }
  // The closest first: the same phone AND name, then the same phone, then the same name; the newest first in each
  const rank = (m) => (m.on.size === 2 ? 0 : m.on.has('phone') ? 1 : 2);
  const all = [...byId.values()].sort((a, b) => rank(a) - rank(b) || b.p.createdAt - a.p.createdAt);
  const shown = all.slice(0, MAX_MATCHES_SHOWN);
  const doctorIds = [...new Set(shown.map((m) => m.p.assignedDoctor && String(m.p.assignedDoctor)).filter(Boolean))];
  const doctors = new Map((doctorIds.length ? await User.find({ _id: { $in: doctorIds } }, { name: 1 }).lean() : []).map((u) => [String(u._id), u.name]));
  return {
    matches: shown.map((m) => matchView(req, m.p, [...m.on], doctors)).filter(Boolean),
    total: all.length,
    ids: all.map((m) => String(m.p._id)),
  };
}

/**
 * One matching record as the warning shows it: the name, patient number, age, doctor and the last four digits of
 * the phone – each only if the person registering may already see it on that record (need to know), and never a
 * clinical detail (not even the type of care). null when they may not see the record at all.
 */
function matchView(req, p, on, doctors) {
  const view = patientAccess(req, p).view;
  if (!view.has('fullName') || !view.has('mrn')) return null;
  const baby = p.careType === 'newborn';
  return {
    id: String(p._id),
    mrn: p.mrn,
    fullName: p.fullName,
    matchedOn: on,
    baby,
    ...(view.has('currentAge') && !baby ? { age: currentAge(p, req.now ?? new Date()) } : {}),
    ...(view.has('newborn') && baby ? { birthAt: p.newborn?.birthAt ?? null } : {}),
    ...(view.has('assignedDoctorName') ? { doctorName: p.assignedDoctor ? (doctors.get(String(p.assignedDoctor)) ?? null) : null } : {}),
    ...(view.has('phone') ? { phoneEnd: lastFourDigits(p.phone) } : {}),
  };
}

// ---------- The records marked as duplicates of a record ----------

// What is read of an earlier record: who may open it, and what detailsOnlyOn compares (medical details – they are
// sent only to those who may see them on BOTH records).
const EARLIER_FIELDS = 'mrn careType assignedDoctor sensitive duplicateOf createdAt medical obstetric pregnancy risk';

/** The records marked as duplicates of this one (lean, oldest first). */
export const duplicatesOf = (tenantId, patientId) => Patient.find({ tenantId, 'duplicateOf.patient': patientId }).select(EARLIER_FIELDS).sort({ createdAt: 1, _id: 1 }).lean();

/** The ids of the records marked as duplicates of this one (her earlier records). */
export const earlierRecordIds = async (tenantId, patientId) => (await Patient.find({ tenantId, 'duplicateOf.patient': patientId }, { _id: 1 }).lean()).map((r) => r._id);

/**
 * Every record of this hospital that is marked as a duplicate: Map "<its id>" → "<its main record's id>". For the
 * numbers that count what happened to a person (visits in Analytics and the monthly report): a visit made on a
 * duplicate record counts for her main record – it is not moved.
 */
export async function mainRecordOf(tenantId) {
  // ($type, as in the index of the records marked as duplicates: only those are read)
  const rows = await Patient.find({ tenantId, 'duplicateOf.patient': { $type: 'objectId' } }, { 'duplicateOf.patient': 1 }).lean();
  return new Map(rows.map((r) => [String(r._id), String(r.duplicateOf.patient)]));
}

/**
 * "Earlier record: P-…" on the main record. Returns { shown, ids, details }:
 *  - shown = [{ id, mrn }] of the records this person may open;
 *  - ids = the ids of all of them (to list the babies linked to an earlier record of the mother);
 *  - details = [{ id, mrn, details }] – what an earlier record has that this one does not (an allergy, a blood
 *    group, pregnancy dates, a care plan … – duplicateCompare.js), only for a person who may see the medical details
 *    of BOTH records, and only the records that have something.
 */
export async function earlierRecordsFor(req, patient) {
  const rows = await duplicatesOf(req.tenantId, patient._id);
  const details = [];
  if (rows.length && patientAccess(req, patient).view.has('medical')) {
    for (const r of rows) {
      if (!patientAccess(req, r).view.has('medical')) continue;
      const left = await leftBehind(req.tenantId, r, patient, req.now ?? new Date());
      if (left.length) details.push({ id: String(r._id), mrn: r.mrn, details: left });
    }
  }
  return {
    shown: rows.filter((r) => patientAccess(req, r).level !== 'none').map((r) => ({ id: String(r._id), mrn: r.mrn })),
    ids: rows.map((r) => r._id),
    details,
  };
}

// ---------- Marking and undoing ----------

const who = (req) => ({ by: req.user._id, byName: req.user.name, at: req.now ?? new Date() });
const WAITING_MESSAGES = ['queued', 'to_send', 'failed'];

/** Was a visit started on this record today? (her appointment of today then stays with that record) */
const seenToday = (tenantId, patientId, today) => Visit.exists({ tenantId, patientId, visitOn: today, status: 'active' });

/**
 * Today's visit on this record that is still open (not signed, not marked entered in error), if there is one. A
 * record with one cannot be marked as a duplicate: the visit could no longer be written in or signed, and she would
 * be on no list of today.
 */
export const openVisitToday = (tenantId, patientId, now) => Visit.exists({ tenantId, patientId, visitOn: hospitalToday(now), status: 'active', signed: null });

/**
 * Marks `dup` as a duplicate of `main` (both already checked: this hospital, allowed to change both, and
 * cannotBeDuplicate says it can be). Only the marking itself is saved here; settleDuplicate does the rest.
 */
export async function markDuplicate(req, dup, main, reason) {
  const tenantId = req.tenantId;
  dup.duplicateOf = { patient: main._id, mrn: main.mrn, reason, ...who(req) };
  await dup.save();
  // Two people marking at the same moment must not leave a duplicate of a duplicate: looked at again, now that
  // this marking is saved, and taken back if the other one got there first.
  const [mainNow, pointing] = await Promise.all([
    Patient.findOne({ tenantId, _id: main._id }, { duplicateOf: 1 }).lean(),
    Patient.exists({ tenantId, 'duplicateOf.patient': dup._id }),
  ]);
  if (isDuplicate(mainNow) || pointing) {
    await Patient.updateOne({ tenantId, _id: dup._id, 'duplicateOf.patient': main._id }, { $set: { duplicateOf: null } });
    throw new HttpError(409, 'One of these records was marked as a duplicate by someone else just now. Reload the page and check again.', 'CONFLICT');
  }
}

/**
 * What follows a marking – safe to run again (a marking that was cut off half-way is finished by pressing the
 * button again): her booked appointments from today on go to the main record, and reminders still waiting for the
 * duplicate are cancelled. `progress.appointmentsMoved` is kept up to date as it goes (for the audit entry, also
 * when a later step fails). Returns { appointmentsMoved, arrivedToday, ...markingCheck } – never anything about
 * her bills (billing is for reception and the hospital admin only).
 */
export async function settleDuplicate(req, dup, main, progress = { appointmentsMoved: 0 }) {
  const tenantId = req.tenantId;
  const today = hospitalToday(req.now);
  // Her booked appointments from today on: she is expected under the main record now. Today's stays where a
  // visit was already started on this record (that appointment was used here).
  const seen = await seenToday(tenantId, dup._id, today);
  const ahead = await Appointment.find({ tenantId, patientId: dup._id, status: 'booked', on: { $gte: today } }, { on: 1 }).lean();
  const moving = ahead.filter((a) => !(seen && sameDay(a.on, today))).map((a) => a._id);
  if (moving.length && isClosed(main)) {
    // The main record is closed after a death: her appointments are not moved onto it – they are cancelled, with no
    // message (as they were on the main record when it was closed)
    for (const appt of await Appointment.find({ tenantId, _id: { $in: moving }, patientId: dup._id, status: 'booked' })) {
      await cancelAppointment(req, appt, CLOSED_CANCEL_REASON, { message: false });
    }
  } else if (moving.length) {
    const moved = await Appointment.updateMany({ tenantId, _id: { $in: moving }, patientId: dup._id, status: 'booked' }, { $set: { patientId: main._id, movedFromPatientId: dup._id, updated: who(req) } });
    progress.appointmentsMoved += moved.modifiedCount ?? 0;
  }
  // Messages still waiting for this record are not sent (the outbox keeps them, cancelled, with the reason)
  await ReminderMessage.updateMany({ tenantId, patientId: dup._id, status: { $in: WAITING_MESSAGES } }, { $set: { status: 'cancelled', error: DUPLICATE_MESSAGE_REASON } });

  const [arrival, check] = await Promise.all([seen ? null : Arrival.exists({ tenantId, patientId: dup._id, on: today }), markingCheck(tenantId, dup, main, req.now ?? new Date())]);
  return {
    appointmentsMoved: progress.appointmentsMoved,
    // Marked as arrived today with no visit started: she must be marked arrived on the main record to stay on the waiting list
    arrivedToday: Boolean(arrival),
    // What this record has that the main record does not (said again after the marking)
    ...check,
  };
}

/**
 * Undoes the marking: the record is in use again. The marking is kept in the record's history. The appointments
 * that were moved to the main record and are still ahead come back, and the reminders that were cancelled because of
 * the marking and are not past wait again. Returns { appointmentsMoved, arrivedOnMain, main }.
 */
export async function undoDuplicate(req, dup) {
  const tenantId = req.tenantId;
  const today = hospitalToday(req.now);
  const was = dup.duplicateOf;
  const mainId = was.patient;
  dup.duplicateHistory.push({ patient: mainId, mrn: was.mrn, reason: was.reason ?? '', byName: was.byName, at: was.at, undoneByName: req.user.name, undoneAt: req.now ?? new Date() });
  dup.duplicateOf = null;
  await dup.save();
  const seen = await seenToday(tenantId, mainId, today);
  const ahead = await Appointment.find({ tenantId, patientId: mainId, movedFromPatientId: dup._id, status: 'booked', on: { $gte: today } }, { on: 1 }).lean();
  const back = ahead.filter((a) => !(seen && sameDay(a.on, today)));
  const moved = back.length
    ? await Appointment.updateMany({ tenantId, _id: { $in: back.map((a) => a._id) }, patientId: mainId, movedFromPatientId: dup._id }, { $set: { patientId: dup._id, movedFromPatientId: null, updated: who(req) } })
    : { modifiedCount: 0 };
  // Her reminders that were cancelled only because of the marking, and whose day has not passed, wait again (the
  // next round sends them, or cancels the ones that are no longer true)
  await ReminderMessage.updateMany({ tenantId, patientId: dup._id, status: 'cancelled', error: DUPLICATE_MESSAGE_REASON, dueOn: { $gte: today } }, { $set: { status: 'queued', error: '' } });
  // Today's appointment came back here while she was marked as arrived on the main record: she would drop from the
  // doctor's waiting list (arrival and appointment must be on the same record) – said in the answer
  const arrivedOnMain = back.some((a) => sameDay(a.on, today)) && Boolean(await Arrival.exists({ tenantId, patientId: mainId, on: today }));
  return { appointmentsMoved: moved.modifiedCount ?? 0, arrivedOnMain, main: { id: String(mainId), mrn: was.mrn } };
}
