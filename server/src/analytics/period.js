// The period an Analytics page covers, and its buckets (weeks or months) for the trend columns.
// Pure: "today" (the hospital's date, midnight UTC) is always passed in. Which periods each audience may use is
// decided here, not by the page:
//  - doctors: up to today (this month, 3, 6 or 12 months, or their own dates of up to 24 months);
//  - hospital admins and the super admin: whole finished months only, so a number can't be compared with
//    yesterday's to work out what happened today (the super admin can also pick up to 24 whole months).

import { addDays, daysBetween, isoDay, utcDay } from '../careplans/dates.js';
import { HttpError } from '../utils/httpError.js';

export const PERIOD_KEYS = {
  doctor: ['this_month', '3m', '6m', '12m', 'custom'],
  admin: ['last_month', 'last_3m', 'last_6m', 'last_12m'],
  platform: ['last_month', 'last_3m', 'last_6m', 'last_12m', 'custom_months'],
};
export const DEFAULT_PERIOD = { doctor: '12m', admin: 'last_12m', platform: 'last_12m' };

export const PERIOD_MESSAGES = {
  doctor: 'Choose a period of up to 24 months, ending today or earlier.',
  admin: 'Hospital admins can choose last month or the last 3, 6 or 12 complete months.',
  platform: 'Choose whole months, up to 24, ending with last month.',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EARLIEST = new Date(Date.UTC(2020, 0, 1));
const MAX_DAYS = 731; // 24 months, inclusive
const MAX_MONTHS = 24;
const WEEKS_UP_TO_DAYS = 62; // a custom period this short gets weekly columns

const monthStart = (y, m) => new Date(Date.UTC(y, m, 1)); // m may be below 0 or above 11
const monthEnd = (y, m) => new Date(Date.UTC(y, m + 1, 0));

/** "12 Oct 2026" */
export const dateLabel = (d) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
/** "12 Oct" */
export const dayMonthLabel = (d) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
/** "Oct 2026" */
export const monthLabel = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

const bad = (audience) => new HttpError(400, PERIOD_MESSAGES[audience], 'BAD_PERIOD');

/** The Monday of the week of a date (weeks start on Monday). */
export const mondayOf = (date) => {
  const d = utcDay(date);
  return addDays(d, -((d.getUTCDay() + 6) % 7));
};

/** The bucket key of a date: 'm:2026-10' (month) or 'w:2026-10-12' (week, by its Monday). */
const bucketKeys = new Map(); // 'month|<time>' → key: the same few hundred days are asked for again and again
export function bucketKeyOfDate(date, kind) {
  if (date == null) return null;
  const t = date instanceof Date ? date.getTime() : new Date(date).getTime();
  const memo = `${kind}|${t}`;
  let key = bucketKeys.get(memo);
  if (key === undefined) {
    key = kind === 'month' ? `m:${isoDay(date).slice(0, 7)}` : `w:${isoDay(mondayOf(date))}`;
    if (bucketKeys.size >= 50_000) bucketKeys.clear();
    bucketKeys.set(memo, key);
  }
  return key;
}

function bucketLabel(kind, start, end, from, to, today) {
  const cutStart = start < from;
  const cutEnd = end > to;
  const first = cutStart ? from : start;
  const last = cutEnd ? to : end;
  const name = kind === 'month' ? monthLabel(start) : dayMonthLabel(start);
  const short = kind === 'month' ? MONTHS[start.getUTCMonth()] : dayMonthLabel(start);
  if (cutStart && cutEnd) return `${dayMonthLabel(first)} – ${dayMonthLabel(last)}`;
  if (cutStart) return `from ${dayMonthLabel(first)}`;
  if (cutEnd) return last.getTime() === today.getTime() ? `${short} (to date)` : `${short} (to ${dayMonthLabel(last)})`;
  return name;
}

/** The buckets of a period, in order: { key, label, partial, from, to } (dates as "2026-10-12"). */
export function periodBuckets(from, to, kind, today) {
  const out = [];
  let start = kind === 'month' ? monthStart(from.getUTCFullYear(), from.getUTCMonth()) : mondayOf(from);
  while (start <= to) {
    const end = kind === 'month' ? monthEnd(start.getUTCFullYear(), start.getUTCMonth()) : addDays(start, 6);
    const first = start < from ? from : start;
    const last = end > to ? to : end;
    out.push({
      key: bucketKeyOfDate(start, kind),
      label: bucketLabel(kind, start, end, from, to, today),
      partial: start < from || end > to,
      from: isoDay(first),
      to: isoDay(last),
    });
    start = kind === 'month' ? monthStart(start.getUTCFullYear(), start.getUTCMonth() + 1) : addDays(start, 7);
  }
  return out;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
function parseDay(v) {
  if (typeof v !== 'string' || !DAY_RE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || isoDay(d) !== v ? null : d;
}
function parseMonth(v) {
  if (typeof v !== 'string' || !MONTH_RE.test(v)) return null;
  const [y, m] = v.split('-').map(Number);
  return m >= 1 && m <= 12 ? monthStart(y, m - 1) : null;
}

/**
 * The period of a request: { key, from, to (dates, midnight UTC), label, kind ('week' | 'month'), buckets,
 * wholeMonths }. query: { period, from, to }. Throws 400 BAD_PERIOD for a key or dates this audience may not use.
 */
export function parsePeriod(query, { audience, today }) {
  const keys = PERIOD_KEYS[audience];
  if (!keys) throw new Error(`Unknown analytics audience ${audience}`);
  const key = query?.period || DEFAULT_PERIOD[audience];
  if (!keys.includes(key)) throw bad(audience);
  const custom = key === 'custom' || key === 'custom_months';
  if (!custom && (query?.from || query?.to)) throw bad(audience);
  const T = utcDay(today);
  const y = T.getUTCFullYear();
  const m = T.getUTCMonth();

  let from;
  let to;
  let kind = 'month';
  if (key === 'this_month') {
    from = monthStart(y, m);
    to = T;
    kind = 'week';
  } else if (key === '3m' || key === '6m' || key === '12m') {
    const back = { '3m': 2, '6m': 5, '12m': 11 }[key];
    from = monthStart(y, m - back);
    to = T;
  } else if (key === 'custom') {
    from = parseDay(query?.from);
    to = parseDay(query?.to);
    if (!from || !to || from < EARLIEST || from > to || to > T || daysBetween(from, to) + 1 > MAX_DAYS) throw bad(audience);
    kind = daysBetween(from, to) + 1 <= WEEKS_UP_TO_DAYS ? 'week' : 'month';
  } else if (key === 'custom_months') {
    const a = parseMonth(query?.from);
    const b = parseMonth(query?.to);
    const lastWhole = monthStart(y, m - 1);
    if (!a || !b || a < EARLIEST || a > b || b > lastWhole) throw bad(audience);
    const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1;
    if (months > MAX_MONTHS) throw bad(audience);
    from = a;
    to = monthEnd(b.getUTCFullYear(), b.getUTCMonth());
  } else {
    const n = { last_month: 1, last_3m: 3, last_6m: 6, last_12m: 12 }[key];
    from = monthStart(y, m - n);
    to = monthEnd(y, m - 1);
  }
  return {
    key,
    from,
    to,
    label: `${dateLabel(from)} – ${dateLabel(to)}`,
    kind,
    buckets: periodBuckets(from, to, kind, T),
    wholeMonths: audience !== 'doctor',
  };
}

/** The period as sent to the browser. */
export const periodJSON = (p) => ({ key: p.key, from: isoDay(p.from), to: isoDay(p.to), label: p.label, buckets: p.buckets });
