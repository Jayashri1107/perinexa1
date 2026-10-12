// Money for billing. PURE. Every amount is a whole number of paise (₹1 = 100 paise), so sums are exact.

import { daysBetween, toHospitalDate } from '../careplans/dates.js';

/** ₹ text → paise ("1,250.50" → 125050), or null when it is not an amount. */
export function toPaise(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) : null;
  const text = String(value ?? '').replace(/[,₹\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

/** 125050 → "₹1,250.50" (Indian grouping; ".00" left out). */
export function rupees(paise) {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100).toLocaleString('en-IN');
  const part = abs % 100;
  return `${sign}₹${whole}${part ? `.${String(part).padStart(2, '0')}` : ''}`;
}

/** The lines that count (not taken off). */
export const liveLines = (bill) => (bill.lines ?? []).filter((l) => !l.removed);

/**
 * A bill's sums: subtotal (live lines), discount, total, paid (payments and deposits less refunds), balance (to pay;
 * below 0 = money to give back), and a status: cancelled, no_charges, unpaid, part_paid, paid, refund_due.
 */
export function totals(bill) {
  const subtotal = liveLines(bill).reduce((s, l) => s + l.amountPaise, 0);
  const discount = Math.min(bill.discount?.paise ?? 0, subtotal);
  const total = subtotal - discount;
  const paid = (bill.payments ?? []).reduce((s, p) => s + (p.kind === 'refund' ? -p.amountPaise : p.amountPaise), 0);
  const balance = total - paid;
  let status;
  if (bill.status === 'cancelled') status = 'cancelled';
  else if (balance < 0) status = 'refund_due';
  else if (total === 0 && paid === 0) status = 'no_charges';
  else if (balance === 0) status = 'paid';
  else status = paid > 0 ? 'part_paid' : 'unpaid';
  return { subtotal, discount, total, paid, balance, status };
}

/** A discount in paise: an amount, or a percentage of the subtotal (rounded to the paisa). */
export const discountPaise = ({ mode, value }, subtotal) => (mode === 'percent' ? Math.round((subtotal * value) / 100) : value);

/**
 * Bed days of a stay (owner's default): the day of admission counts, the day of discharge does not, at least 1.
 * Still in hospital: the days so far (until today).
 */
export function bedDays(admittedAt, dischargedAt, now = new Date()) {
  const from = toHospitalDate(admittedAt);
  const to = toHospitalDate(dischargedAt ?? now);
  return Math.max(1, daysBetween(from, to));
}
