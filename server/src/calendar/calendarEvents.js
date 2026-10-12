// Calendar entries built from patients, care plans and visits. PURE – no database, no clock: the caller
// passes the records, the hospital's today and the range. Every entry is built field by field for its
// detail level (never by spreading a record), so nothing else can slip into the answer.
//
// Entry shapes (dates are "YYYY-MM-DD"):
//   all:    id, type, date, patientId
//   lmp:    + edd, eddSource                                                      (clinical only)
//   edd:    + eddSource                                                           (clinical only)
//   plan:   clinical + itemId, name, due{from,to}, status, doneOn, doneElsewhere, ga; reception + due{from}
//   booked: clinical + visitId, visitOn, state, note, ga, (arrivedAt);           reception + state, (arrivedAt)
// arrivedAt (the time her visit was started that day) only when state is 'arrived'.
// Reception ids never hold an item id or a visit id (an id also carries the time it was made).

import { gaOn, isoDay, utcDay } from '../careplans/dates.js';
import { itemId, planStatuses } from '../careplans/planEngine.js';
import { daysOf } from './calendarRange.js';
import { BOOKING_KEPT_AFTER_VISIT, CLINICAL_PLAN_STATUSES, EVENT_TYPES, RECEPTION_PLAN_FOR_SENSITIVE, RECEPTION_PLAN_STATUSES, RECEPTION_WINDOW_FIRST_DAY_ONLY } from './calendarRules.js';

const time = (d) => utcDay(d).getTime();
const inRange = (day, [from, to]) => day != null && time(day) >= time(from) && time(day) <= time(to);

/** Weeks and days of pregnancy on a day ({ weeks, days }), or null (no EDD, or before day 0). */
export function gaWeeksDays(edd, day) {
  const g = edd && day ? gaOn(utcDay(edd), utcDay(day)) : null;
  return g ? { weeks: g.weeks, days: g.days } : null;
}

const eddSourceOf = (patient) => (patient.pregnancy?.scanEdd ? 'scan' : 'lmp');

/** The LMP entry of a current pregnancy (clinical level only; null when there is no LMP). */
export function lmpEvent(patient, level = 'clinical') {
  const lmp = utcDay(patient.pregnancy?.lmp);
  if (level !== 'clinical' || !lmp) return null;
  const pid = String(patient._id);
  return { id: `lmp:${pid}`, type: 'lmp', date: isoDay(lmp), patientId: pid, edd: isoDay(patient.pregnancy?.effectiveEdd), eddSource: eddSourceOf(patient) };
}

/** The EDD entry (the EDD in use: scan EDD when recorded, else LMP + 280 days). Clinical level only. */
export function eddEvent(patient, level = 'clinical') {
  const edd = utcDay(patient.pregnancy?.effectiveEdd);
  if (level !== 'clinical' || !edd) return null;
  const pid = String(patient._id);
  return { id: `edd:${pid}`, type: 'edd', date: isoDay(edd), patientId: pid, eddSource: eddSourceOf(patient) };
}

/**
 * The care-plan visits of one plan placed in the range: an open visit (due, upcoming, overdue, missed) on the
 * day its window opens, an attended one on the day it was done. Statuses as on the Care plan tab (the engine's
 * planStatuses, worked out once for the plan). Reception: due, upcoming and overdue only, as dates, and
 * nothing for sensitive records. Reception entries get their ids from receptionIds.
 */
export function planEvents(plan, today, range, level, { sensitive = false } = {}) {
  if (level !== 'clinical' && level !== 'reception') return [];
  if (level === 'reception' && sensitive && !RECEPTION_PLAN_FOR_SENSITIVE) return [];
  const shown = level === 'clinical' ? CLINICAL_PLAN_STATUSES : RECEPTION_PLAN_STATUSES;
  const statuses = planStatuses(plan, today);
  const pid = String(plan.patientId);
  const out = [];
  for (const it of plan.items ?? []) {
    if (it.kind !== 'visit') continue;
    const status = statuses.get(it)?.status;
    if (!shown.includes(status)) continue;
    const a = it.auto ?? {};
    let day;
    if (status === 'done') {
      if (!it.done?.on) continue; // never test `done` itself: an empty object is not a done date
      day = utcDay(it.done.on);
    } else {
      if (!a.dueFrom || !a.dueBy) continue;
      day = utcDay(a.dueFrom);
    }
    if (!inRange(day, range)) continue;
    const due = a.dueFrom && a.dueBy ? { from: isoDay(a.dueFrom), to: isoDay(a.dueBy) } : null;
    if (level === 'reception') {
      // The window's end orders two windows of one day (receptionIds), then goes (RECEPTION_WINDOW_FIRST_DAY_ONLY).
      out.push({ id: null, type: 'plan', date: isoDay(day), patientId: pid, due, ...(RECEPTION_WINDOW_FIRST_DAY_ONLY ? { firstDayOnly: true } : {}) });
      continue;
    }
    const iid = itemId(it);
    const done = status === 'done';
    out.push({
      id: `plan:${pid}:${iid}`,
      type: 'plan',
      date: isoDay(day),
      patientId: pid,
      itemId: iid,
      name: it.name,
      due,
      status,
      doneOn: done ? isoDay(it.done.on) : null,
      doneElsewhere: done && Boolean(it.done.elsewhere),
      ga: gaWeeksDays(plan.basis?.edd, day),
    });
  }
  return out;
}

/**
 * 'arrived' (a visit was started for her on the booked day), 'booked' (after today), 'today', or 'no_visit' (the day
 * has passed and no visit was recorded on it).
 */
export function bookedState(nextVisitOn, today, arrivedAt = null) {
  if (arrivedAt && BOOKING_KEPT_AFTER_VISIT) return 'arrived';
  const d = time(nextVisitOn);
  const t = time(today);
  if (d > t) return 'booked';
  return d === t ? 'today' : 'no_visit';
}

/**
 * A booked next visit. booking: { patientId, visitId, visitOn, nextVisitOn, note, arrivedAt }.
 * arrivedAt: when a visit was started for her on the booked day (BOOKING_KEPT_AFTER_VISIT), else null.
 * edd: the patient's EDD for the gestation (null if none).
 */
export function bookedEvent(booking, today, level, edd = null) {
  const day = utcDay(booking.nextVisitOn);
  const pid = String(booking.patientId);
  const state = bookedState(day, today, booking.arrivedAt);
  const arrived = state === 'arrived' ? { arrivedAt: new Date(booking.arrivedAt).toISOString() } : {};
  if (level === 'reception') return { id: `booked:${pid}`, type: 'booked', date: isoDay(day), patientId: pid, state, ...arrived };
  if (level !== 'clinical') return null;
  return {
    ...arrived,
    id: `booked:${pid}:${String(booking.visitId)}`,
    type: 'booked',
    date: isoDay(day),
    patientId: pid,
    visitId: String(booking.visitId),
    visitOn: isoDay(booking.visitOn),
    state,
    note: booking.note ?? '',
    ga: gaWeeksDays(edd, day),
  };
}

/**
 * A booked appointment (appointment booking): like a booked next visit, with the time and the doctor. appt: the
 * Appointment; arrivedAt as for bookedEvent; doctorName; visit: the visit whose next visit made it ({ _id, visitOn,
 * note }) or null. Reception ids are appt:<appointment id> (an appointment holds nothing clinical).
 */
export function appointmentEvent(appt, today, level, { arrivedAt = null, doctorName = null, visit = null, edd = null } = {}) {
  const day = utcDay(appt.on);
  const pid = String(appt.patientId);
  const state = bookedState(day, today, arrivedAt);
  const arrived = state === 'arrived' ? { arrivedAt: new Date(arrivedAt).toISOString() } : {};
  const booking = { appointmentId: String(appt._id), start: appt.start ?? null, needsTime: !appt.start, doctorName: doctorName ?? null };
  if (level === 'reception') return { id: `appt:${String(appt._id)}`, type: 'booked', date: isoDay(day), patientId: pid, state, ...arrived, ...booking };
  if (level !== 'clinical') return null;
  return {
    ...arrived,
    ...booking,
    id: `appt:${String(appt._id)}`,
    type: 'booked',
    date: isoDay(day),
    patientId: pid,
    visitId: visit ? String(visit._id) : null,
    visitOn: visit ? isoDay(visit.visitOn) : null,
    state,
    note: visit?.note ?? '',
    ga: gaWeeksDays(edd, day),
  };
}

/**
 * Gives reception entries their ids: booked:<patientId> and plan:<patientId>:<window start>, with :2, :3 …
 * when two windows of one patient open on the same day (ordered by the window end). Entries that already
 * have an id are left as they are. Returns the same array.
 */
export function receptionIds(events) {
  const groups = new Map();
  for (const e of events) {
    if (e.id) continue;
    if (e.type === 'booked') {
      e.id = `booked:${e.patientId}`;
      continue;
    }
    const key = `plan:${e.patientId}:${e.due?.from ?? e.date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  for (const [key, list] of groups) {
    list.sort((a, b) => String(a.due?.to ?? '').localeCompare(String(b.due?.to ?? '')));
    list.forEach((e, i) => {
      e.id = i === 0 ? key : `${key}:${i + 1}`;
      // Reception: only the window's first day leaves the server (RECEPTION_WINDOW_FIRST_DAY_ONLY).
      if (e.firstDayOnly) {
        e.due = e.due ? { from: e.due.from } : null;
        delete e.firstDayOnly;
      }
    });
  }
  return events;
}

const TYPE_ORDER = Object.fromEntries(EVENT_TYPES.map((t, i) => [t, i]));
const text = (s) => String(s ?? '').toLowerCase();
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Sorts entries in place: date; type (booked, plan, edd, lmp); for plan visits the window start; the patient's
 * name (ignoring case); id. patients: { [id]: { fullName } }.
 */
export function sortEvents(events, patients = {}) {
  return events.sort(
    (a, b) =>
      cmp(a.date, b.date) ||
      TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
      (a.type === 'plan' ? cmp(a.due?.from ?? '', b.due?.from ?? '') : 0) ||
      (a.type === 'booked' ? cmp(a.start ?? '99:99', b.start ?? '99:99') : 0) ||
      cmp(text(patients[a.patientId]?.fullName), text(patients[b.patientId]?.fullName)) ||
      cmp(a.id, b.id),
  );
}

/**
 * One count per day of the range: { date, booked, plan, attended, edd, lmp } – only the requested types, and
 * attended (care-plan visits done that day) at clinical level only. Counted before any per-day limit.
 */
export function countDays(events, range, types, level) {
  const days = daysOf(range).map((d) => {
    const row = { date: isoDay(d) };
    for (const t of EVENT_TYPES) {
      if (!types.includes(t)) continue;
      row[t] = 0;
      if (t === 'plan' && level === 'clinical') row.attended = 0;
    }
    return row;
  });
  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const e of events) {
    const row = byDate.get(e.date);
    if (!row) continue;
    const key = e.type === 'plan' && e.status === 'done' ? 'attended' : e.type;
    if (key in row) row[key] += 1;
  }
  return days;
}

/**
 * Keeps the first `max` entries of each day (entries already sorted) and sets days[i].more to the number left
 * out. Returns the entries kept.
 */
export function limitPerDay(events, days, max) {
  const seen = new Map();
  const kept = [];
  for (const e of events) {
    const n = (seen.get(e.date) ?? 0) + 1;
    seen.set(e.date, n);
    if (n <= max) kept.push(e);
  }
  for (const d of days) d.more = Math.max(0, (seen.get(d.date) ?? 0) - max);
  return kept;
}

/**
 * What the calendar sends about a patient. Clinical: id, mrn, fullName, phone, doctorName, level, careType,
 * gaToday; reception: the same without careType and gaToday. Never staff ids, the sensitive mark, risk,
 * address or age.
 */
export function projectPatient(p, level, doctorName, today) {
  const base = { id: String(p._id), mrn: p.mrn, fullName: p.fullName, phone: p.phone ?? '', doctorName: doctorName ?? null, level };
  if (level !== 'clinical') return base;
  const edd = p.careType === 'antenatal' ? p.pregnancy?.effectiveEdd : null;
  return { ...base, careType: p.careType, gaToday: gaWeeksDays(edd, today) };
}
