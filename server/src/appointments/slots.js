// Time slots and the waiting order. PURE – no database; the clock is passed in. Times of day are the hospital's
// own clock as "HH:MM" strings (e.g. "10:30"); days are date-only values at midnight UTC (careplans/dates.js).

import { config } from '../config.js';
import { utcDay } from '../careplans/dates.js';
import { SLOT_MINUTES } from './appointmentRules.js';

/** "10:30" → 630 (minutes after midnight), or null when it is not a time. */
export function minutesOf(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
/** 630 → "10:30". */
export const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** The hospital's clock at this moment, in minutes after midnight. */
export function hospitalMinutes(now = new Date(), timeZone = config.HOSPITAL_TIME_ZONE) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return Number(p.hour) * 60 + Number(p.minute);
}

/** The sessions of one day of the week (0 = Sunday) in a timetable ({ week: [{ day, sessions }] }). */
export function sessionsOn(schedule, day) {
  const dow = utcDay(day).getUTCDay();
  return schedule?.week?.find((w) => w.day === dow)?.sessions ?? [];
}

/** The leave entry that covers this day, or null. */
export function leaveOn(schedule, day) {
  const t = utcDay(day).getTime();
  return schedule?.leave?.find((l) => utcDay(l.from).getTime() <= t && t <= utcDay(l.to).getTime()) ?? null;
}

/** Every slot start ("HH:MM") of a day's sessions, in order. A slot must end by the session's end. */
export function slotStarts(sessions, slotMinutes = SLOT_MINUTES) {
  const out = [];
  for (const s of sessions ?? []) {
    const from = minutesOf(s.from);
    const to = minutesOf(s.to);
    if (from == null || to == null) continue;
    for (let t = from; t + slotMinutes <= to; t += slotMinutes) out.push(hhmm(t));
  }
  return [...new Set(out)].sort();
}

/** Minutes a visit of this type takes with this doctor: what the doctor chose, else one slot. */
export function lengthFor(schedule, visitType, slotMinutes = SLOT_MINUTES) {
  const n = Number(schedule?.lengths?.[visitType]);
  return Number.isFinite(n) && n >= slotMinutes && n % slotMinutes === 0 ? n : slotMinutes;
}

/** The slot starts a booking takes: its own and those that follow while it lasts ("10:00", 20 → 10:00, 10:10). */
export function coveredStarts(start, minutes, slotMinutes = SLOT_MINUTES) {
  const from = minutesOf(start);
  if (from == null) return [];
  const out = [];
  for (let t = from; t < from + Math.max(minutes ?? slotMinutes, slotMinutes); t += slotMinutes) out.push(hhmm(t));
  return out;
}

/**
 * Whether the doctor works at this time on this day: 'ok', 'leave', 'off' (no session that day), 'outside'
 * (not the start of a slot in a session), or 'too_long' (it starts in a session but would run past its end).
 */
export function slotCheck(schedule, day, start, minutes = SLOT_MINUTES) {
  if (leaveOn(schedule, day)) return 'leave';
  const sessions = sessionsOn(schedule, day);
  if (!sessions.length) return 'off';
  const starts = slotStarts(sessions);
  if (!starts.includes(start)) return 'outside';
  return coveredStarts(start, minutes).every((s) => starts.includes(s)) ? 'ok' : 'too_long';
}

/**
 * The first free time of a day for a visit of this length (every slot it takes is free and in a session, and it
 * has not already passed when the day is today), or null.
 */
export function firstFreeSlot(schedule, day, taken, { today = null, nowMinutes = null, minutes = SLOT_MINUTES } = {}) {
  if (leaveOn(schedule, day)) return null;
  const isToday = today && utcDay(day).getTime() === utcDay(today).getTime();
  const starts = slotStarts(sessionsOn(schedule, day));
  for (const start of starts) {
    if (coveredStarts(start, minutes).some((s) => taken.has(s) || !starts.includes(s))) continue;
    if (isToday && nowMinutes != null && minutesOf(start) < nowMinutes) continue;
    return start;
  }
  return null;
}

/**
 * A timetable's mistakes, or [] – sessions must start before they end, sit on the slot grid and not overlap;
 * leave must not end before it starts.
 */
export function timetableProblems(schedule, slotMinutes = SLOT_MINUTES) {
  const problems = [];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  for (const w of schedule.week ?? []) {
    const spans = (w.sessions ?? []).map((s) => [minutesOf(s.from), minutesOf(s.to), s]);
    for (const [from, to, s] of spans) {
      if (from == null || to == null) problems.push(`${DAYS[w.day]}: please enter times like 10:00.`);
      else if (to - from < slotMinutes) problems.push(`${DAYS[w.day]}: ${s.from}–${s.to} must be at least ${slotMinutes} minutes long.`);
      else if (from % slotMinutes || to % slotMinutes) problems.push(`${DAYS[w.day]}: ${s.from}–${s.to} – times must be on the ${slotMinutes}-minute grid (e.g. 10:00, 10:${String(slotMinutes).padStart(2, '0')}).`);
    }
    const sorted = spans.filter(([f, t]) => f != null && t != null).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i][0] < sorted[i - 1][1]) problems.push(`${DAYS[w.day]}: the sessions overlap.`);
    }
  }
  for (const l of schedule.leave ?? []) {
    if (utcDay(l.to) < utcDay(l.from)) problems.push('A leave ends before it starts.');
  }
  return problems;
}

/**
 * The order a doctor calls the patients who are waiting (owner: booked patients go in at their time, walk-ins
 * fill the gaps in token order). entries: [{ kind: 'slot' | 'token', start, token, arrivedAt }]. Booked patients
 * whose time has come go first (earliest slot first, then the one who came first); then walk-ins by token; then
 * booked patients who came early (their time not yet come) and bookings with no time. Returns a new array.
 */
export function waitingOrder(entries, nowMinutes) {
  const due = [];
  const walkIns = [];
  const early = [];
  for (const e of entries) {
    if (e.kind === 'token') walkIns.push(e);
    else if (e.start && minutesOf(e.start) <= nowMinutes) due.push(e);
    else early.push(e);
  }
  const byArrival = (a, b) => new Date(a.arrivedAt ?? 0) - new Date(b.arrivedAt ?? 0);
  due.sort((a, b) => a.start.localeCompare(b.start) || byArrival(a, b));
  walkIns.sort((a, b) => a.token - b.token);
  early.sort((a, b) => (a.start ?? '99:99').localeCompare(b.start ?? '99:99') || byArrival(a, b));
  return [...due, ...walkIns, ...early];
}
