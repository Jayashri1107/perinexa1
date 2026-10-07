// Time slots and the waiting order (the same rules as Perinexa's appointments/slots.js). PURE – no database; the clock
// is passed in. Times of day are the hospital's clock as "HH:MM"; days are date-only values at midnight UTC
// ("2026-10-07" → 2026-10-07T00:00:00Z), the same as OPD leave days.
import { config } from '../../config/index.js';

const { slotMinutes: SLOT } = config.opd;
const DAY = 86400000;

/** "10:30" → 630, or null when it is not a time. */
export function minutesOf(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
/** 630 → "10:30". */
export const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** "2026-10-07" → the day as a date at midnight UTC; a Date → the same, cut to its UTC day. */
export const utcDay = (d) => (typeof d === 'string' ? new Date(`${d}T00:00:00.000Z`) : new Date(Math.floor(new Date(d).getTime() / DAY) * DAY));
/** A day → "2026-10-07". */
export const isoDay = (d) => utcDay(d).toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(utcDay(d).getTime() + n * DAY);

/** The hospital's clock at this moment, in minutes after midnight. */
export function hospitalMinutes(now = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: config.app.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return Number(p.hour) * 60 + Number(p.minute);
}

/** The sessions of a day in a doctor's timings ({ week: [{ day, sessions }] }). */
export function sessionsOn(schedule, day) {
  const dow = utcDay(day).getUTCDay();
  return schedule?.week?.find((w) => w.day === dow)?.sessions ?? [];
}

/** The leave period that covers this day, or null. */
export function leaveOn(schedule, day) {
  const t = utcDay(day).getTime();
  return schedule?.leave?.find((l) => utcDay(l.from).getTime() <= t && t <= utcDay(l.to).getTime()) ?? null;
}

/** Every slot start of a day's sessions, in order. A slot must end by the session's end. */
export function slotStarts(sessions) {
  const out = [];
  for (const s of sessions ?? []) {
    const from = minutesOf(s.from);
    const to = minutesOf(s.to);
    if (from == null || to == null) continue;
    for (let t = from; t + SLOT <= to; t += SLOT) out.push(hhmm(t));
  }
  return [...new Set(out)].sort();
}

/** Minutes a visit of this type takes with this doctor: the doctor's choice, else the setting's default. */
export function lengthFor(schedule, visitType) {
  const n = Number(schedule?.lengths?.[visitType] ?? config.opd.visitTypes.find((v) => v.key === visitType)?.defaultMinutes);
  return Number.isFinite(n) && n >= SLOT && n % SLOT === 0 ? n : SLOT;
}

/** The slot starts a booking takes: its own and those that follow while it lasts ("10:00", 20 → 10:00, 10:10). */
export function coveredStarts(start, minutes) {
  const from = minutesOf(start);
  if (from == null) return [];
  const out = [];
  for (let t = from; t < from + Math.max(minutes ?? SLOT, SLOT); t += SLOT) out.push(hhmm(t));
  return out;
}

/** 'ok', 'leave', 'off' (no session that day), 'outside' (not a slot start) or 'too_long' (runs past the session). */
export function slotCheck(schedule, day, start, minutes = SLOT) {
  if (leaveOn(schedule, day)) return 'leave';
  const sessions = sessionsOn(schedule, day);
  if (!sessions.length) return 'off';
  const starts = slotStarts(sessions);
  if (!starts.includes(start)) return 'outside';
  return coveredStarts(start, minutes).every((s) => starts.includes(s)) ? 'ok' : 'too_long';
}

/**
 * The order a doctor calls the patients who are waiting: booked patients whose time has come (earliest first), then
 * walk-ins by token, then booked patients who came early. entries: [{ kind, start, token, arrivedAt }].
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
