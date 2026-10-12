// The dates a calendar view covers. PURE. All dates are date-only values at midnight UTC.

import { addDays, daysBetween, utcDay } from '../careplans/dates.js';
import { MAX_RANGE_DAYS, WEEK_STARTS_ON } from './calendarRules.js';

/** The first day of the week that holds d. */
export const startOfWeek = (d) => addDays(d, -((utcDay(d).getUTCDay() - WEEK_STARTS_ON + 7) % 7));

const firstOfMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const lastOfMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));

/**
 * [from, to] (both inclusive) for a view around the date d: the day itself, its week, or its month as whole
 * weeks (28 to 42 days).
 */
export function rangeFor(view, date) {
  const d = utcDay(date);
  let range;
  if (view === 'day') range = [d, d];
  else if (view === 'week') range = [startOfWeek(d), addDays(startOfWeek(d), 6)];
  else if (view === 'month') range = [startOfWeek(firstOfMonth(d)), addDays(startOfWeek(lastOfMonth(d)), 6)];
  else throw new Error(`Unknown calendar view: ${view}`);
  if (daysBetween(range[0], range[1]) + 1 > MAX_RANGE_DAYS) throw new Error('Calendar range is too long');
  return range;
}

/** Every day of the range, in order. */
export function daysOf([from, to]) {
  const out = [];
  for (let d = utcDay(from); d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
