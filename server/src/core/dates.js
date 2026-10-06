// Days and months on the hospitals' clock (config.app.timezone), not the server's.
import { config } from '../config/index.js';

const { timezone, utcOffset } = config.app;
export const TIMEZONE = timezone;

// "2026-10-06" on the hospital clock → [start, end) as real moments.
export function dayRange(date) {
  const start = new Date(`${date}T00:00:00${utcOffset}`);
  return [start, new Date(start.getTime() + 86400000)];
}

// Today's date ("YYYY-MM-DD") on the hospital clock.
export const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());

// The first moment of the month `monthsBack` months before this one, on the hospital clock.
export function monthStart(monthsBack = 0) {
  const [y, m] = todayLocal().split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - monthsBack, 1));
  return new Date(`${d.toISOString().slice(0, 7)}-01T00:00:00${utcOffset}`);
}

// The last `count` months as "YYYY-MM", oldest first.
export function lastMonths(count) {
  const [y, m] = todayLocal().split('-').map(Number);
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(y, m - count + i, 1)).toISOString().slice(0, 7));
}

// For $group: the month of a date on the hospital clock.
export const monthOf = (field) => ({ $dateToString: { format: '%Y-%m', date: field, timezone } });
export const dayOf = (field) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone } });
