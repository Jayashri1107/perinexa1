// Date helpers for the calendar screen. PURE and UTC only: every date is a "YYYY-MM-DD" day (UTC midnight), so
// the computer's own time zone never shifts a day. The page never reads the computer's clock: the hospital's
// today, the range and the days all come from the server's answer; these helpers only step from a given day.
// The week start is set on the server only (the grid takes its first weekday from the days it gets).
import { windowText } from '../patients/carePlanFormat.js';

const DAY_MS = 86_400_000;
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-10-12" → a Date at UTC midnight (null when not a valid day). */
export function parseIso(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A Date → "2026-10-12" (its UTC day). */
export const toIso = (d) => d.toISOString().slice(0, 10);

/** The day n days later, as "YYYY-MM-DD". */
export const addDaysIso = (iso, n) => toIso(new Date(parseIso(iso).getTime() + n * DAY_MS));

const lastDayOfMonth = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/**
 * One step back (-1) or forward (+1): a day, a week (7 days), or a month (the same day number in the other month,
 * or that month's last day when it is shorter: 31 Oct → 30 Nov).
 */
export function stepDate(view, iso, dir) {
  const d = parseIso(iso);
  if (!d) return null;
  if (view === 'day') return addDaysIso(iso, dir);
  if (view === 'week') return addDaysIso(iso, 7 * dir);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + dir;
  const target = new Date(Date.UTC(y, m, 1));
  const day = Math.min(d.getUTCDate(), lastDayOfMonth(target.getUTCFullYear(), target.getUTCMonth()));
  return toIso(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), day)));
}

/** "Monday, 12 Oct 2026" */
export function longDay(iso) {
  const d = parseIso(iso);
  if (!d) return '';
  return `${WEEKDAYS_LONG[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Mon, 12 Oct 2026" (the chosen day in the month view). */
export function shortDay(iso) {
  const d = parseIso(iso);
  if (!d) return '';
  return `${WEEKDAYS_SHORT[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The chosen-day panel title: "Today · Wed, 30 Sep 2026" when the chosen day is the hospital's today (from the server). */
export function panelDayTitle(iso, today) {
  return iso === today ? `Today · ${shortDay(iso)}` : shortDay(iso);
}

/** "Monday 12 October 2026" (the words a screen reader hears for a month cell). */
export function spokenDay(iso) {
  const d = parseIso(iso);
  if (!d) return '';
  return `${WEEKDAYS_LONG[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "October 2026" */
export function monthTitle(iso) {
  const d = parseIso(iso);
  return d ? `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}` : '';
}

/** The title over the calendar: day "Monday, 12 Oct 2026", week "12–18 Oct 2026", month "October 2026". */
export function rangeTitle(view, from, to, date) {
  if (view === 'day') return longDay(date ?? from);
  if (view === 'week') return windowText(parseIso(from), parseIso(to));
  return monthTitle(date ?? from);
}

/** "Mon 12 Oct" – a day heading in the week view. */
export function weekdayLabel(iso) {
  const d = parseIso(iso);
  return d ? `${WEEKDAYS_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}` : '';
}

/** "Mon" – a column heading in the month grid. */
export const weekdayShort = (iso) => {
  const d = parseIso(iso);
  return d ? WEEKDAYS_SHORT[d.getUTCDay()] : '';
};
/** "Monday" */
export const weekdayLong = (iso) => {
  const d = parseIso(iso);
  return d ? WEEKDAYS_LONG[d.getUTCDay()] : '';
};

/** The weekday number (0 = Sunday) of a day – used for the grid's first column. */
export const weekdayOf = (iso) => parseIso(iso)?.getUTCDay() ?? null;

/** The day number of the month (12 for "2026-10-12"). */
export const dayOfMonth = (iso) => parseIso(iso)?.getUTCDate() ?? null;

/** The first day of the month of a day: "2026-10-12" → "2026-10-01". */
export const firstOfMonth = (iso) => (parseIso(iso) ? `${iso.slice(0, 7)}-01` : '');

/** Whether two days are in the same month. */
export const sameMonth = (a, b) => Boolean(a && b) && a.slice(0, 7) === b.slice(0, 7);

/**
 * The day the keyboard moves to in the month grid, or null for any other key. firstWeekday: the weekday of the
 * grid's first column (0 = Sunday, 1 = Monday).
 * Arrows: a day left or right, a week up or down; Home / End: the first / last day of that week;
 * Page Up / Page Down: the same day of the previous / next month.
 */
export function gridKeyMove(iso, key, firstWeekday) {
  if (!parseIso(iso)) return null;
  switch (key) {
    case 'ArrowRight':
      return addDaysIso(iso, 1);
    case 'ArrowLeft':
      return addDaysIso(iso, -1);
    case 'ArrowDown':
      return addDaysIso(iso, 7);
    case 'ArrowUp':
      return addDaysIso(iso, -7);
    case 'Home':
      return addDaysIso(iso, -((weekdayOf(iso) - firstWeekday + 7) % 7));
    case 'End':
      return addDaysIso(iso, 6 - ((weekdayOf(iso) - firstWeekday + 7) % 7));
    case 'PageUp':
      return stepDate('month', iso, -1);
    case 'PageDown':
      return stepDate('month', iso, 1);
    default:
      return null;
  }
}

/**
 * The month grid from the server's days (whole weeks): rows of seven, each day marked inMonth when it is in the
 * month of `date` (the chosen day).
 */
export function monthWeeks(days, date) {
  const rows = [];
  for (let i = 0; i < (days ?? []).length; i += 7) {
    rows.push(days.slice(i, i + 7).map((d) => ({ ...d, inMonth: sameMonth(d.date, date) })));
  }
  return rows;
}
