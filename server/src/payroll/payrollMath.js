// Payroll, Stage B (docs/PAYROLL_BUILD_NOTE.md section 5): all the arithmetic of the salary sheet, in one place.
//   pay for the month = monthly pay × paid days ÷ basis days, in whole paise, rounded as the settings say.
// The rules themselves – the basis, whether weekly offs and holidays are paid, the rounding – are the hospital's
// settings and are DRAFT until its accountant confirms them (payrollRules.js rulesAreDraft). Three rules below are
// written here because a sum needs them and nobody has decided them yet; each is marked on the row it touches, and
// each is a question for the accountant (section 8):
//   1. paid days above the basis (27 paid days on a basis of 26) pay the full monthly pay, not more;
//   2. a month with two pay entries uses the entry in force on the person's last working day of that month;
//   3. a half day is half a paid day.
// No database, no requests: every function here is PURE.
import { DAY_KINDS, countDays, monthDays } from './attendanceRead.js';
import { cleanParts, monthlyGross } from './payrollRules.js';

/** The days one month's pay is divided by, or null while the hospital has not chosen. */
export function basisDays(dayBasis, month) {
  if (dayBasis === 'calendar') return monthDays(month);
  if (dayBasis === 'thirty') return 30;
  if (dayBasis === 'twentySix') return 26;
  return null;
}

const day10 = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/**
 * The part of the month a person was employed: { from, to, days, whole } as day numbers, or null when they were not
 * employed in it at all (joined later, or left before it).
 */
export function employedIn(month, joinedOn, leftOn) {
  const last = monthDays(month);
  const first10 = `${month}-01`;
  const last10 = `${month}-${String(last).padStart(2, '0')}`;
  const joined = day10(joinedOn);
  const left = day10(leftOn);
  if ((joined && joined > last10) || (left && left < first10)) return null;
  const from = joined && joined > first10 ? Number(joined.slice(8, 10)) : 1;
  const to = left && left < last10 ? Number(left.slice(8, 10)) : last;
  return { from, to, days: to - from + 1, whole: from === 1 && to === last };
}

/** Paid days from the counts of a month: present, half days as halves, paid leave, and – as the settings say – weekly offs and holidays. */
export function paidDaysOf(counts, settings) {
  const c = counts ?? {};
  return (c.present ?? 0) + (c.half ?? 0) * 0.5 + (c.paidLeave ?? 0) + (settings.weeklyOffsPaid ? (c.weeklyOff ?? 0) : 0) + (settings.holidaysPaid ? (c.holiday ?? 0) : 0);
}

/** A month's pay rounded as the settings say: to the rupee (nearest, up, down) or kept in whole paise. */
export function roundPay(paise, rounding) {
  if (rounding === 'up') return Math.ceil(paise / 100 - 1e-9) * 100;
  if (rounding === 'down') return Math.floor(paise / 100 + 1e-9) * 100;
  if (rounding === 'paise') return Math.round(paise);
  return Math.round(paise / 100) * 100;
}

/** monthly pay × paid days ÷ basis days, never more than the monthly pay: { paise, capped }. */
export function payFor(monthlyPaise, paidDays, basis, rounding) {
  if (!basis || monthlyPaise == null) return { paise: null, capped: false };
  const capped = paidDays > basis;
  const days = capped ? basis : paidDays;
  return { paise: roundPay((monthlyPaise * days) / basis, rounding), capped };
}

/** The pay entry a month uses: the one in force on the person's last working day of that month (rule 2 above), or null. */
export function payEntryFor(pay, month, employed) {
  const on = `${month}-${String(employed?.to ?? monthDays(month)).padStart(2, '0')}`;
  const started = (pay ?? []).filter((e) => e?.from && day10(e.from) <= on);
  if (!started.length) return null;
  return started.reduce((best, e) => (day10(e.from) >= day10(best.from) ? e : best));
}

/**
 * One row of the salary sheet. staff: the staff member; read: their row from the attendance file (or null);
 * correction: { paidDays, reason … } typed by the accounts person (or null); settings: the hospital's.
 * A correction is shown beside the file's figure and used in its place for the sum – never written over it.
 * notes: 'joined' / 'left' (inside the month), 'capped' (rule 1), 'payChanged' (rule 2), 'noPay', 'noRow'.
 */
export function sheetRow({ staff, month, read, correction, settings }) {
  const basis = basisDays(settings.dayBasis, month);
  const employed = employedIn(month, staff.joinedOn, staff.leftOn);
  const notes = [];
  if (employed && employed.from > 1) notes.push('joined');
  if (employed && employed.to < monthDays(month)) notes.push('left');

  // What the file says, kept inside the days the person was employed
  let counts = null;
  let fileDays = null;
  if (read && employed) {
    counts = read.days ? countDays(read.days, employed.from, employed.to) : Object.fromEntries(DAY_KINDS.map((k) => [k, read.counts?.[k] ?? 0]));
    fileDays = read.paidDaysGiven ?? paidDaysOf(counts, settings);
    // a file of totals can't say which days: no more paid days than the person was employed
    if (!read.days && fileDays > employed.days) fileDays = employed.days;
  }
  if (!read) notes.push('noRow');

  const paidDays = correction ? correction.paidDays : fileDays;
  const entry = payEntryFor(staff.pay, month, employed);
  const monthlyPaise = entry ? monthlyGross(entry) : null;
  if (monthlyPaise == null) notes.push('noPay');
  // The pay started after the person's first day in this month: one part of the month had another pay (or none)
  const firstDay = `${month}-${String(employed?.from ?? 1).padStart(2, '0')}`;
  if (entry && day10(entry.from) > firstDay) notes.push('payChanged');

  const { paise, capped } = paidDays == null ? { paise: null, capped: false } : payFor(monthlyPaise, paidDays, basis, settings.rounding);
  if (capped) notes.push('capped');
  return {
    staffId: String(staff._id),
    staffNumber: staff.staffNumber,
    name: staff.name,
    designation: staff.designation ?? '',
    counts,
    fileDays,
    correction: correction ? { paidDays: correction.paidDays, reason: correction.reason, byName: correction.byName ?? '', at: correction.at ?? null } : null,
    paidDays,
    basis,
    monthlyPaise,
    parts: entry ? cleanParts(entry.parts) : [],
    payPaise: paise,
    notes,
  };
}
