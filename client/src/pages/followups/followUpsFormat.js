// Reception's Follow-ups page (26 Oct 2026): the words and groups of GET /api/follow-ups. No browser needed to test.
import { VISIT_TYPE_LABELS, addDaysIso, dayLabel, timeLabel } from '../appointments/appointmentFormat.js';

/** "Today", "Tomorrow", else the day ("Friday 2 Oct 2026"). */
export function comingDayLabel(iso, today) {
  if (iso === today) return 'Today';
  if (iso === addDaysIso(today, 1)) return 'Tomorrow';
  return dayLabel(iso);
}

/** Coming up, by day in order: [{ date, label, rows }]. */
export function comingUpGroups(rows = [], today) {
  const groups = [];
  for (const r of rows) {
    let g = groups.find((x) => x.date === r.date);
    if (!g) groups.push((g = { date: r.date, label: comingDayLabel(r.date, today), rows: [] }));
    g.rows.push(r);
  }
  return groups.sort((a, b) => a.date.localeCompare(b.date));
}

/** A booking's time: "10:30 AM", or "Needs a time". */
export const bookingTime = (r) => (r.start && !r.needsTime ? timeLabel(r.start) : 'Needs a time');

/** New / Follow-up / Scan / Other. */
export const visitTypeLabel = (r) => VISIT_TYPE_LABELS[r.visitType] ?? 'Follow-up';

/** The numbers at the top: patients to call, babies to call, booked today, booked for the coming days. */
export function followUpCounts(data) {
  return {
    toCall: (data?.dueNow?.length ?? 0) + (data?.overdue?.length ?? 0),
    babies: (data?.babiesDue?.length ?? 0) + (data?.babiesSoon?.length ?? 0),
    today: (data?.comingUp ?? []).filter((r) => r.date === data?.today).length,
    comingUp: data?.comingUp?.length ?? 0,
  };
}

/** The filter's choices: every patient, or OPD, IPD (a stay in the last 90 days) or day care only. */
export const SETTING_CHOICES = [
  ['', 'All'],
  ['opd', 'OPD'],
  ['ipd', 'IPD'],
  ['day_care', 'Day care'],
];
export const SETTING_LABELS = { opd: 'OPD', ipd: 'IPD', day_care: 'Day care' };
const digits = (s) => String(s ?? '').replace(/\D/g, '');

/**
 * Does a row match the filter? text: part of her name, patient number or doctor's name (any case), or of her phone
 * number (digits only, so "98765 43210" and "9876543210" both match); setting: '', 'opd', 'ipd' or 'day_care'.
 */
export function matchesFilter(row, { text = '', setting = '' } = {}) {
  const p = row.patient;
  if (setting && (p.setting ?? 'opd') !== setting) return false;
  const t = text.trim().toLowerCase();
  if (!t) return true;
  const words = [p.fullName, p.mrn, p.doctorName, row.doctorName].filter(Boolean).map((w) => w.toLowerCase());
  if (words.some((w) => w.includes(t))) return true;
  const d = digits(t);
  return d.length >= 3 && digits(p.phone).includes(d);
}

/** The answer of GET /api/follow-ups with only the rows that match the filter (every list). */
export function filterFollowUps(data, filter) {
  if (!data) return data;
  const keep = (rows) => rows?.filter((r) => matchesFilter(r, filter));
  return { ...data, comingUp: keep(data.comingUp), dueNow: keep(data.dueNow), overdue: keep(data.overdue), babiesDue: keep(data.babiesDue), babiesSoon: keep(data.babiesSoon) };
}

/** The patients to call, in one list: overdue first, then due now – each with why ({ ...row, id, why, late }). */
export function callRows(data, formatDate) {
  const overdue = (data?.overdue ?? []).map((r) => ({
    ...r,
    late: true,
    why: [r.bookedFor ? `Booked for ${formatDate(r.bookedFor)} – did not come` : '', r.dueFrom ? `Visit was due from ${formatDate(r.dueFrom)}` : ''].filter(Boolean).join(' · '),
  }));
  const due = (data?.dueNow ?? []).map((r) => ({ ...r, late: false, why: `Visit due from ${formatDate(r.dueFrom)}` }));
  return [...overdue, ...due].map((r) => ({ ...r, id: r.patient.id }));
}
