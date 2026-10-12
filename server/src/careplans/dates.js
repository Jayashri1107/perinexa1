// Dates for pregnancy care. Every plan date is a DATE ONLY, stored as midnight UTC (so "12 Oct 2026" is
// 2026-10-12T00:00:00Z whatever the computer's own time zone). "Today" is the hospital's calendar date
// (HOSPITAL_TIME_ZONE, India by default), so a test done at 00:30 in the hospital counts for the new day.
//
// Pure except for reading the hospital time zone from the settings.

import { config } from '../config.js';

export const DAY = 86_400_000;
export const PREGNANCY_DAYS = 280; // Naegele's rule: EDD = LMP + 280 days

// Building a date formatter is slow, so one is kept per time zone.
const formatters = new Map();
function ymdIn(timeZone, instant) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' });
    formatters.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  return [Number(p.year), Number(p.month), Number(p.day)];
}

/** The hospital's calendar date at this moment, as midnight UTC. */
export function hospitalToday(now = new Date(), timeZone = config.HOSPITAL_TIME_ZONE) {
  const [y, m, d] = ymdIn(timeZone, now);
  return new Date(Date.UTC(y, m - 1, d));
}
/** The hospital's calendar date of any moment (e.g. when something was saved). */
export const toHospitalDate = (instant, tz) => hospitalToday(new Date(instant), tz);

// How far the hospital's clock is ahead of UTC at this moment, in milliseconds (IST: +5 h 30 min).
const offsetFormatters = new Map();
function offsetMs(timeZone, instant) {
  let f = offsetFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    offsetFormatters.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, Number(x.value)]));
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - (instant.getTime() - instant.getUTCMilliseconds());
}

/** The moment the hospital's day D begins (00:00 there). For India: 18:30 UTC on the day before. */
export function hospitalDayStart(date, timeZone = config.HOSPITAL_TIME_ZONE) {
  const day = utcDay(date).getTime();
  let t = day - offsetMs(timeZone, new Date(day));
  const again = day - offsetMs(timeZone, new Date(t)); // a clock change between the two guesses
  if (again !== t) t = again;
  return new Date(t);
}

/** Drops any time of day: the UTC calendar date as midnight UTC (null stays null). */
export const utcDay = (v) => {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return new Date(t - (((t % DAY) + DAY) % DAY)); // midnight UTC of that day (an invalid date stays invalid)
};
export const addDays = (d, n) => new Date(utcDay(d).getTime() + n * DAY);
export const daysBetween = (a, b) => Math.round((utcDay(b) - utcDay(a)) / DAY);
export const sameDay = (a, b) => (a == null || b == null ? a == null && b == null : utcDay(a).getTime() === utcDay(b).getTime());
/** "2026-10-12" (null if no date). */
export const isoDay = (d) => (d == null ? null : utcDay(d).toISOString().slice(0, 10));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A date in words, "12 Oct 2026" ('' if no date). */
export function dateWords(d) {
  if (d == null) return '';
  const x = utcDay(d);
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
}

export const dayZero = (edd) => addDays(edd, -PREGNANCY_DAYS); // LMP-equivalent of the EDD in use
export const weekStart = (edd, w) => addDays(dayZero(edd), 7 * w); // w w 0 d
export const weekEnd = (edd, w) => addDays(dayZero(edd), 7 * w + 6); // w w 6 d (completed weeks, inclusive)

/** Weeks and days of pregnancy on a date, e.g. { weeks: 18, days: 0, totalDays: 126 } (null before day 0). */
export function gaOn(edd, date) {
  const t = daysBetween(dayZero(edd), date);
  return t < 0 ? null : { weeks: Math.floor(t / 7), days: t % 7, totalDays: t };
}

/** "09:15" in the hospital's time zone (for messages such as "Dr Rao changed this item at 09:15"). */
export const timeIn = (instant, tz = config.HOSPITAL_TIME_ZONE) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(instant);
