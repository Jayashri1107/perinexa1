// The two general messages (4 Oct 2026), queued by the hourly round (reminderService.js) next to the appointment
// reminders, so that staff do not have to spot overdue patients by hand:
//  - "A check-up or test is due at <hospital>. Please call <phone> to book." – when a care-plan item (a test, a scan,
//    a vaccination, a check-up) has become overdue and nothing is booked ahead;
//  - "<hospital>: we missed you at your appointment on <date> …" – the day after a booked appointment nobody came to,
//    once per appointment and day.
//
// Rules this file keeps:
//  - the same two switches as every automatic message: the hospital admin switched reminders on (the round checks
//    that; a message still waiting when the switch goes off is cancelled) and the record itself carries the
//    agreement and a mobile number. A baby's message goes to the number on the BABY's record under the agreement
//    recorded on the BABY's record – the mother's is never looked at;
//  - the wording is fixed and general (messages.js): it never names what is due and never says why;
//  - "something is due" goes out only from a care plan a doctor has APPROVED (the content it was built from, in
//    Clinic library → To approve): a plan built from a draft schedule sends nothing to a patient by itself. Staff
//    still see its overdue items on their own lists, marked as a draft;
//  - at most one general message in any GENERAL_EVERY_DAYS days, per patient and per mobile number (a mother and her
//    baby on one number get one, not two of the same words); none while she is in hospital (for a baby: nor while
//    the mother on the baby's record is); none when she is booked from today on; none for a record that is closed
//    (no current care plan for this pregnancy, delivery, birth or course of care – for "we missed you": closed after
//    the appointment was made, since a booking made later shows the record is in use again);
//  - "something is due": none for CARE_DUE_QUIET_AFTER_VISIT_DAYS days after she came (or went home from a stay in
//    hospital), and none for an antenatal record whose delivery is already recorded (the type of care was not
//    changed yet);
//  - "we missed you": none when she came that day after all (a scan or procedure recorded as done, or a lab sample
//    taken, also count – not only a visit or an arrival mark), has come since, was in hospital that day, was admitted
//    between the booking and its day (the stay overtook the appointment), or has delivered since it was made;
//  - a sensitive record is treated exactly as the appointment reminders treat it: the message goes like any other
//    (it says nothing medical). Who sees its row in the outbox is decided in routes/reminderOutbox.js;
//  - a message that is waiting and is no longer true (she booked, came, was admitted, nothing is overdue any more,
//    she withdrew her agreement, the appointment was cancelled or moved) is cancelled before anyone sends it; one
//    whose number, channel or language changed on the record is brought up to date; one past its last day is
//    cancelled as too old;
//  - none for a record marked as a duplicate of another (patients/duplicateRules.js): none is queued, and one still
//    waiting is cancelled;
//  - every query carries the hospital's tenantId; nothing is written to the log.

import mongoose from 'mongoose';
import { bookedAhead, statesFor, statusOf } from '../appointments/appointmentService.js';
import { addDays, dayZero, hospitalDayStart, hospitalToday, isoDay, sameDay, toHospitalDate, utcDay } from '../careplans/dates.js';
import { overduePlanItems } from '../careplans/overdue.js';
import { closedForPregnancy } from '../careplans/plansService.js';
import { Admission } from '../models/Admission.js';
import { Appointment } from '../models/Appointment.js';
import { Arrival } from '../models/Arrival.js';
import { CarePlan } from '../models/CarePlan.js';
import { LabOrder } from '../models/LabOrder.js';
import { Patient } from '../models/Patient.js';
import { ReminderMessage } from '../models/ReminderMessage.js';
import { Visit } from '../models/Visit.js';
import { WorkDone } from '../models/WorkDone.js';
import { careDueMessage, missedMessage } from './messages.js';
import { DUPLICATE_MESSAGE_REASON, isDuplicate } from '../patients/duplicateRules.js';
import { CLOSED_MESSAGE_REASON, IN_USE, isClosed } from '../patients/deathRules.js';
import { mobileNumber } from './phone.js';
import {
  CARE_DUE_KINDS,
  CARE_DUE_KINDS_BY_CARE,
  CARE_DUE_ONLY_FROM_APPROVED_PLANS,
  CARE_DUE_OVERDUE_DAYS,
  CARE_DUE_QUIET_AFTER_VISIT_DAYS,
  GENERAL_EVERY_DAYS,
  GENERAL_KINDS,
  GENERAL_MAX_PATIENTS,
  GENERAL_VALID_DAYS,
  MISSED_LOOKBACK_DAYS,
} from './reminderRules.js';

// What is read of a patient here: the number, her agreement, and what the rules above need – nothing medical is
// put into a message. (death.on: a record closed after a death gets no message of any kind – IN_USE leaves it out,
// and a message still waiting for it is cancelled.)
const PATIENT_FIELDS = { phone: 1, reminders: 1, careType: 1, 'newborn.mother': 1, 'pregnancy.effectiveEdd': 1, 'lastDelivery.at': 1, duplicateOf: 1, 'death.on': 1 };
// What is read of an appointment: its day, and when it was made or last changed – never the doctor or the visit type.
const APPOINTMENT_FIELDS = { patientId: 1, on: 1, kind: 1, status: 1, 'created.at': 1, 'updated.at': 1, createdAt: 1 };
const WAITING = ['queued', 'to_send', 'failed'];
const NO_LONGER_NEEDED = 'No longer needed';
const TOO_OLD = 'Too old to send';
const SWITCHED_OFF = 'Reminders switched off for the hospital';

/** The kinds of care-plan item that count as "something is due" for a plan of this type of care. */
export const careDueKinds = (careType) => CARE_DUE_KINDS_BY_CARE[careType] ?? CARE_DUE_KINDS;

const idOf = (x) => String(x._id ?? x);
const hospitalWords = (tenant) => ({ hospital: tenant.letterhead?.name || tenant.name, phone: tenant.letterhead?.phone ?? '' });
const lastDayToSend = (today) => addDays(today, GENERAL_VALID_DAYS - 1);
// May a message go to a patient from this plan (a row of overduePlanItems)?
const maySend = (row) => row.approved || !CARE_DUE_ONLY_FROM_APPROVED_PLANS;
// When the appointment was made for its day: booked, or last moved or changed by a person.
const madeAt = (appt) => appt.updated?.at ?? appt.created?.at ?? appt.createdAt ?? null;
// "Once per appointment and day": an appointment moved to another day (the same booking) counts as a new one.
const onceKey = (ref, day) => `${ref}:${isoDay(day) ?? ''}`;
// An antenatal record whose delivery in THIS pregnancy is recorded (the delivery note was signed, or the date was
// entered) while the type of care still says antenatal: the hospital knows she has delivered.
const deliveredThisPregnancy = (p) =>
  p.careType === 'antenatal' && Boolean(p.lastDelivery?.at && p.pregnancy?.effectiveEdd) && p.lastDelivery.at >= dayZero(p.pregnancy.effectiveEdd);

// ---------- The rules, each for many patients at once ----------

/**
 * Patients who already had a general message in the last GENERAL_EVERY_DAYS days (queued, waiting, sent or failed) –
 * on their own record, or on another record with the same mobile number (a mother and her baby, twins).
 */
async function recentlyMessaged(tenantId, patients, today) {
  if (!patients.length) return new Set();
  const since = addDays(today, -(GENERAL_EVERY_DAYS - 1));
  const numberOf = new Map(patients.map((p) => [idOf(p), mobileNumber(p.phone)]));
  const numbers = [...new Set([...numberOf.values()].filter(Boolean))];
  const rows = await ReminderMessage.find(
    {
      tenantId,
      kind: { $in: GENERAL_KINDS },
      status: { $ne: 'cancelled' },
      $and: [{ $or: [{ patientId: { $in: patients.map((p) => p._id) } }, { to: { $in: numbers } }] }, { $or: [{ sendOn: { $gte: since } }, { sentAt: { $gte: hospitalDayStart(since) } }] }],
    },
    { patientId: 1, to: 1 },
  ).lean();
  const ids = new Set(rows.map((m) => String(m.patientId)));
  const tos = new Set(rows.map((m) => m.to));
  return new Set(patients.map(idOf).filter((id) => ids.has(id) || tos.has(numberOf.get(id))));
}

/** Patients in hospital now – and babies whose mother (on the baby's own record) is. */
export async function inHospitalNow(tenantId, patients) {
  if (!patients.length) return new Set();
  const motherOf = new Map(patients.filter((p) => p.careType === 'newborn' && p.newborn?.mother).map((p) => [idOf(p), String(p.newborn.mother)]));
  const stays = await Admission.find({ tenantId, status: 'admitted', patientId: { $in: [...patients.map((p) => p._id), ...motherOf.values()] } }, { patientId: 1 }).lean();
  const admitted = new Set(stays.map((s) => String(s.patientId)));
  return new Set(patients.map(idOf).filter((id) => admitted.has(id) || admitted.has(motherOf.get(id))));
}

/**
 * The latest day (from `from` on) each patient came: a visit was started for her, she was marked arrived, a scan or
 * procedure was recorded as done for her, a lab sample was taken from her, or she went home from a stay in hospital.
 * Only the day is read – never what was done. (A payment does not count: it can be made on the phone.)
 */
async function lastCame(tenantId, ids, from) {
  const out = new Map();
  if (!ids.length) return out;
  const [visits, arrivals, work, samples, discharges] = await Promise.all([
    Visit.find({ tenantId, status: 'active', patientId: { $in: ids }, visitOn: { $gte: from } }, { patientId: 1, visitOn: 1 }).lean(),
    Arrival.find({ tenantId, patientId: { $in: ids }, on: { $gte: from } }, { patientId: 1, on: 1 }).lean(),
    WorkDone.find({ tenantId, patientId: { $in: ids }, on: { $gte: from }, cancelled: null }, { patientId: 1, on: 1 }).lean(),
    LabOrder.find({ tenantId, patientId: { $in: ids }, status: { $ne: 'cancelled' }, 'collected.at': { $gte: hospitalDayStart(from) } }, { patientId: 1, 'collected.at': 1 }).lean(),
    Admission.find({ tenantId, patientId: { $in: ids }, status: 'discharged', dischargedAt: { $gte: hospitalDayStart(from) } }, { patientId: 1, dischargedAt: 1 }).lean(),
  ]);
  const note = (id, day) => {
    const d = utcDay(day);
    if (!out.has(id) || out.get(id) < d) out.set(id, d);
  };
  for (const v of visits) note(String(v.patientId), v.visitOn);
  for (const a of arrivals) note(String(a.patientId), a.on);
  for (const w of work) note(String(w.patientId), w.on);
  for (const o of samples) note(String(o.patientId), toHospitalDate(o.collected.at));
  for (const a of discharges) note(String(a.patientId), toHospitalDate(a.dischargedAt));
  return out;
}

/**
 * Patients whose record is closed: no current care plan for her type of care, and one that a doctor (or a new
 * pregnancy) closed – for an antenatal record, one closed for THIS pregnancy (the rule of the calendar and
 * Analytics). A record with no care plan at all is not closed.
 * Returns Map "<patientId>" -> when it was closed (the latest closing; null when that was not recorded).
 */
async function closedRecords(tenantId, patients) {
  const closed = new Map();
  if (!patients.length) return closed;
  const plans = await CarePlan.find({ tenantId, patientId: { $in: patients.map((p) => p._id) } }, { patientId: 1, careType: 1, current: 1, 'basis.edd': 1, 'closed.reason': 1, 'closed.at': 1, eddReview: 1 }).lean();
  const byPatient = new Map();
  for (const pl of plans) byPatient.set(String(pl.patientId), [...(byPatient.get(String(pl.patientId)) ?? []), pl]);
  for (const p of patients) {
    const own = (byPatient.get(idOf(p)) ?? []).filter((pl) => pl.careType === p.careType);
    if (own.some((pl) => pl.current)) continue;
    const edd = p.pregnancy?.effectiveEdd ?? null;
    const earlier = own.filter((pl) => !pl.current && (p.careType !== 'antenatal' || (edd && closedForPregnancy([pl], edd))));
    if (!earlier.length) continue;
    const times = earlier.map((pl) => pl.closed?.at).filter(Boolean).map((t) => new Date(t).getTime());
    closed.set(idOf(p), times.length ? new Date(Math.max(...times)) : null);
  }
  return closed;
}

/**
 * Is the record closed as far as this appointment goes? Closed on or after the moment the appointment was made: a
 * booking made AFTER the closing (a new problem, a year later) shows the record is in use again.
 */
function closedSince(closed, id, made) {
  if (!closed.has(id)) return false;
  const at = closed.get(id);
  return at === null || !made || at >= made;
}

/**
 * The patients' stays in hospital that matter for appointments from `fromDay` on: current ones, those that ended
 * on or after that day, and those that began since `sinceMoment`. Returns Map "<patientId>" -> [stay].
 */
async function staysFor(tenantId, ids, fromDay, sinceMoment) {
  const out = new Map();
  if (!ids.length) return out;
  const stays = await Admission.find(
    { tenantId, patientId: { $in: ids }, $or: [{ status: 'admitted' }, { dischargedAt: { $gte: hospitalDayStart(fromDay) } }, ...(sinceMoment ? [{ admittedAt: { $gte: sinceMoment } }] : [])] },
    { patientId: 1, admittedAt: 1, dischargedAt: 1, status: 1 },
  ).lean();
  for (const s of stays) out.set(String(s.patientId), [...(out.get(String(s.patientId)) ?? []), s]);
  return out;
}

/** Was she in hospital on that day? stays: her admissions that were not over before the day began. */
const inHospitalOn = (stays, day) => stays.some((s) => s.admittedAt < hospitalDayStart(addDays(day, 1)) && (s.status === 'admitted' || !s.dischargedAt || s.dischargedAt >= hospitalDayStart(day)));

/**
 * "We missed you" must not go for this appointment (the same answer when it is queued and while it waits):
 * her record was closed after it was made; she came that day after all, or has come since; she was in hospital
 * that day, or was admitted between the booking and its day (a woman admitted in labour on Wednesday did not
 * "miss" the antenatal visit booked for the next Monday); or she has delivered since it was made.
 */
function missedOvertaken(p, appt, { closed, came, stays }) {
  const id = idOf(p);
  const day = utcDay(appt.on);
  const made = madeAt(appt);
  if (closedSince(closed, id, made)) return true;
  const cameOn = came.get(id);
  if (cameOn && cameOn >= day) return true;
  if (inHospitalOn(stays, day)) return true;
  if (made && stays.some((s) => s.admittedAt > made && s.admittedAt < hospitalDayStart(addDays(day, 1)))) return true;
  if (made && p.lastDelivery?.at && p.lastDelivery.at > made) return true;
  return false;
}

async function insertMessage(doc) {
  try {
    await ReminderMessage.create(doc);
    return true;
  } catch (e) {
    if (e?.code === 11000) return false; // queued by another round at the same moment
    throw e;
  }
}

// ---------- "We missed you" ----------

/**
 * Queues the "we missed you" message for booked appointments of the last MISSED_LOOKBACK_DAYS days that nobody came
 * to ("did not come": not cancelled, no arrival and no visit that day). Once per appointment and day; one per
 * patient and per mobile number per round. Returns how many were added.
 */
export async function queueMissedAppointments(tenant, now = new Date()) {
  const tenantId = tenant._id;
  const today = hospitalToday(now);
  const from = addDays(today, -MISSED_LOOKBACK_DAYS);
  const appts = await Appointment.find({ tenantId, on: { $gte: from, $lt: today }, status: 'booked', patientId: { $ne: null } }, APPOINTMENT_FIELDS)
    .sort({ on: -1, createdAt: -1 })
    .limit(GENERAL_MAX_PATIENTS)
    .lean();
  if (!appts.length) return 0;
  const states = await statesFor(tenantId, appts);
  const missed = appts.filter((a) => statusOf(a, states.get(`${String(a.patientId)}:${isoDay(a.on)}`), today) === 'no_show');
  if (!missed.length) return 0;
  // Once per appointment and day, whatever became of its message. (An appointment moved to another day after a
  // no-show keeps its id: the new day is a new "once".)
  const earlier = await ReminderMessage.find({ tenantId, kind: 'missed', ref: { $in: missed.map((a) => String(a._id)) } }, { ref: 1, aboutOn: 1 }).lean();
  const had = new Set(earlier.map((m) => onceKey(m.ref, m.aboutOn)));
  const latest = new Map(); // patientId -> her latest missed appointment that has no message yet
  for (const a of missed) if (!had.has(onceKey(String(a._id), a.on)) && !latest.has(String(a.patientId))) latest.set(String(a.patientId), a);
  if (!latest.size) return 0;

  const patients = (await Patient.find({ tenantId, _id: { $in: [...latest.keys()] }, 'reminders.consent': true, ...IN_USE }, PATIENT_FIELDS).lean()).filter((p) => mobileNumber(p.phone));
  if (!patients.length) return 0;
  const ids = patients.map((p) => p._id);
  const made = patients.map((p) => madeAt(latest.get(idOf(p)))).filter(Boolean);
  const [quiet, admitted, closed, booked, came, stays] = await Promise.all([
    recentlyMessaged(tenantId, patients, today),
    inHospitalNow(tenantId, patients),
    closedRecords(tenantId, patients),
    bookedAhead(tenantId, ids, today),
    lastCame(tenantId, ids, from),
    staysFor(tenantId, ids, from, made.length ? new Date(Math.min(...made.map((t) => new Date(t).getTime()))) : null),
  ]);
  const words = hospitalWords(tenant);
  const numbers = new Set(); // the numbers messaged in this round: one message per number
  let added = 0;
  for (const p of patients) {
    const id = idOf(p);
    const appt = latest.get(id);
    const to = mobileNumber(p.phone);
    if (quiet.has(id) || numbers.has(to) || admitted.has(id) || booked.has(id)) continue;
    if (missedOvertaken(p, appt, { closed, came, stays: stays.get(id) ?? [] })) continue;
    const day = utcDay(appt.on);
    const language = p.reminders.language ?? 'en';
    const ok = await insertMessage({
      tenantId,
      patientId: p._id,
      kind: 'missed',
      ref: String(appt._id),
      aboutOn: day,
      dueOn: lastDayToSend(today),
      sendOn: today,
      channel: p.reminders.channel ?? 'sms',
      language,
      to,
      text: missedMessage({ ...words, day, lang: language }),
    });
    if (!ok) continue;
    numbers.add(to);
    added += 1;
  }
  return added;
}

// ---------- "A check-up or test is due" ----------

/**
 * Queues the general "something is due" message for patients (mothers and babies alike, each under the agreement
 * on their own record) whose current, approved care plan has an item that became overdue in the last
 * CARE_DUE_OVERDUE_DAYS days, with nothing booked from today on.
 * Returns { added, heldBack }: heldBack = patients left out only because their care plan is still a draft.
 */
export async function queueCareDue(tenant, now = new Date()) {
  const tenantId = tenant._id;
  const today = hospitalToday(now);
  const agreed = (await Patient.find({ tenantId, 'reminders.consent': true, ...IN_USE }, PATIENT_FIELDS).limit(GENERAL_MAX_PATIENTS).lean()).filter((p) => mobileNumber(p.phone));
  if (!agreed.length) return { added: 0, heldBack: 0 };
  const { rows } = await overduePlanItems(tenantId, {
    now,
    kindsFor: careDueKinds,
    patientIds: agreed.map((p) => p._id),
    overdueSince: addDays(today, -CARE_DUE_OVERDUE_DAYS),
    skipPostDates: true,
    limit: GENERAL_MAX_PATIENTS,
  });
  const due = new Map(rows.map((r) => [idOf(r.patient), maySend(r)]));
  // Not a woman whose delivery is already recorded while her record still says antenatal
  const patients = agreed.filter((p) => due.has(idOf(p)) && !deliveredThisPregnancy(p));
  if (!patients.length) return { added: 0, heldBack: 0 };
  const ids = patients.map((p) => p._id);
  const [quiet, admitted, booked, came] = await Promise.all([
    recentlyMessaged(tenantId, patients, today),
    inHospitalNow(tenantId, patients),
    bookedAhead(tenantId, ids, today),
    lastCame(tenantId, ids, addDays(today, -CARE_DUE_QUIET_AFTER_VISIT_DAYS)),
  ]);
  const words = hospitalWords(tenant);
  const numbers = new Set(); // the numbers messaged in this round: one message per number
  let added = 0;
  let heldBack = 0;
  for (const p of patients) {
    const id = idOf(p);
    const to = mobileNumber(p.phone);
    // Already had one (she, or someone on the same number), in hospital, already coming, or here in the last days
    if (quiet.has(id) || numbers.has(to) || admitted.has(id) || booked.has(id) || came.has(id)) continue;
    if (!due.get(id)) {
      heldBack += 1; // her care plan is still a draft: nothing goes to her by itself
      continue;
    }
    const language = p.reminders.language ?? 'en';
    const ok = await insertMessage({
      tenantId,
      patientId: p._id,
      kind: 'care_due',
      ref: '',
      dueOn: lastDayToSend(today),
      sendOn: today,
      channel: p.reminders.channel ?? 'sms',
      language,
      to,
      text: careDueMessage({ ...words, lang: language }),
    });
    if (!ok) continue;
    numbers.add(to);
    added += 1;
  }
  return { added, heldBack };
}

// ---------- Messages that are no longer true ----------

/**
 * Brings the general messages still waiting (queued, to send by hand, or failed) up to date, so nobody sends one
 * that is out of date. Run before a round sends, before the outbox is shown and before one is marked sent by hand.
 *  - past its last day: cancelled as too old;
 *  - the hospital admin switched reminders off: every waiting one is cancelled;
 *  - no longer true – she withdrew her agreement, has no mobile number any more, is in hospital, is booked from
 *    today on, has come, her record was closed, the appointment was cancelled or moved, or (for "something is due")
 *    nothing is overdue any more: cancelled;
 *  - the number, the channel or the language on the record changed (a mistyped number was corrected): the waiting
 *    message takes the new ones – it never keeps a number that is no longer on the record.
 * tenant: the hospital (its switch, name and phone). Returns how many were cancelled as no longer true or switched
 * off (not the ones that were simply too old).
 */
export async function cancelStaleGeneral(tenant, now = new Date()) {
  const tenantId = tenant._id;
  const today = hospitalToday(now);
  const waiting = { tenantId, kind: { $in: GENERAL_KINDS }, status: { $in: WAITING } };
  // Too old: never sent, and past its last day. (One whose sending had failed keeps that in its words – the outbox is
  // also the record of what became of each message.)
  await ReminderMessage.updateMany({ ...waiting, status: 'failed', dueOn: { $lt: today } }, { $set: { status: 'cancelled', error: `${TOO_OLD} (sending had failed)` } });
  await ReminderMessage.updateMany({ ...waiting, dueOn: { $lt: today } }, { $set: { status: 'cancelled', error: TOO_OLD } });
  if (!tenant.messaging?.remindersEnabled) {
    const off = await ReminderMessage.updateMany(waiting, { $set: { status: 'cancelled', error: SWITCHED_OFF } });
    return off.modifiedCount ?? 0;
  }
  const open = await ReminderMessage.find({ ...waiting, dueOn: { $gte: today } }).limit(1000);
  if (!open.length) return 0;
  const ids = [...new Set(open.map((m) => String(m.patientId)))];
  const patients = await Patient.find({ tenantId, _id: { $in: ids } }, PATIENT_FIELDS).lean();
  const byId = new Map(patients.map((p) => [idOf(p), p]));
  const careDueIds = [...new Set(open.filter((m) => m.kind === 'care_due').map((m) => m.patientId))];
  const missedOpen = open.filter((m) => m.kind === 'missed');
  const refs = missedOpen.map((m) => m.ref).filter((ref) => mongoose.isValidObjectId(ref));
  const appts = refs.length ? await Appointment.find({ tenantId, _id: { $in: refs } }, APPOINTMENT_FIELDS).lean() : [];
  const apptOf = new Map(appts.map((a) => [String(a._id), a]));
  const made = appts.map(madeAt).filter(Boolean);
  const earliest = open.reduce((d, m) => (utcDay(m.aboutOn ?? m.sendOn) < d ? utcDay(m.aboutOn ?? m.sendOn) : d), today);
  const [admitted, closed, booked, came, stays, overdue] = await Promise.all([
    inHospitalNow(tenantId, patients),
    closedRecords(tenantId, patients),
    bookedAhead(tenantId, ids, today),
    lastCame(tenantId, patients.map((p) => p._id), addDays(earliest, -CARE_DUE_QUIET_AFTER_VISIT_DAYS)),
    staysFor(tenantId, [...new Set(missedOpen.map((m) => String(m.patientId)))], earliest, made.length ? new Date(Math.min(...made.map((t) => new Date(t).getTime()))) : null),
    overduePlanItems(tenantId, { now, kindsFor: careDueKinds, patientIds: careDueIds, skipPostDates: true, limit: GENERAL_MAX_PATIENTS }),
  ]);
  const stillDue = new Set(overdue.rows.filter(maySend).map((r) => idOf(r.patient)));
  const words = hospitalWords(tenant);
  let cancelled = 0;
  for (const m of open) {
    const id = String(m.patientId);
    const p = byId.get(id);
    const to = p ? mobileNumber(p.phone) : null;
    let reason = null;
    if (!p?.reminders?.consent) reason = 'Reminders switched off for this patient';
    else if (isDuplicate(p)) reason = DUPLICATE_MESSAGE_REASON;
    else if (isClosed(p)) reason = CLOSED_MESSAGE_REASON;
    else if (!to) reason = 'No mobile number on the record any more';
    else if (admitted.has(id) || booked.has(id)) reason = NO_LONGER_NEEDED;
    else if (m.kind === 'missed') {
      const appt = apptOf.get(m.ref);
      const gone = !appt || appt.status !== 'booked' || !sameDay(appt.on, m.aboutOn); // cancelled since, or moved to another day
      if (gone || missedOvertaken(p, appt, { closed, came, stays: stays.get(id) ?? [] })) reason = NO_LONGER_NEEDED;
    } else {
      const cameOn = came.get(id) ?? null;
      if (!stillDue.has(id) || deliveredThisPregnancy(p) || (cameOn && cameOn >= addDays(m.sendOn, -CARE_DUE_QUIET_AFTER_VISIT_DAYS))) reason = NO_LONGER_NEEDED;
    }
    if (reason) {
      m.status = 'cancelled';
      m.error = reason;
      await m.save();
      cancelled += 1;
      continue;
    }
    // Still true: it goes to the number, by the channel and in the language that are on the record NOW
    const channel = p.reminders.channel ?? 'sms';
    const language = p.reminders.language ?? 'en';
    const text = m.kind === 'missed' ? missedMessage({ ...words, day: utcDay(m.aboutOn), lang: language }) : careDueMessage({ ...words, lang: language });
    if (m.to !== to || m.channel !== channel || m.language !== language || m.text !== text) {
      m.to = to;
      m.channel = channel;
      m.language = language;
      m.text = text;
      await m.save();
    }
  }
  return cancelled;
}
