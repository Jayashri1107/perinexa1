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
  // Cashless insurance (11 Nov 2026): the amount the insurer or TPA approved comes off what the patient pays at once;
  // money from the insurer is a payment by Insurance. The insurer's share is the approved amount, or what it has paid
  // when that is more; never more than the bill. balance = patientBalance + insuranceDue.
  const insurancePaid = (bill.payments ?? []).filter((p) => p.mode === 'insurance').reduce((s, p) => s + (p.kind === 'refund' ? -p.amountPaise : p.amountPaise), 0);
  const claimApproved = Math.max(0, bill.claim?.approvedPaise ?? 0);
  const insuranceShare = Math.max(0, Math.min(total, Math.max(claimApproved, insurancePaid)));
  const patientPaid = paid - insurancePaid;
  const patientBalance = total - insuranceShare - patientPaid;
  const insuranceDue = insuranceShare - insurancePaid;
  let status;
  if (bill.status === 'cancelled') status = 'cancelled';
  else if (balance < 0) status = 'refund_due';
  else if (total === 0 && paid === 0) status = 'no_charges';
  else if (balance === 0) status = 'paid';
  else status = paid > 0 ? 'part_paid' : 'unpaid';
  return { subtotal, discount, total, paid, balance, status, claimApproved, insuranceShare, insurancePaid, insuranceDue, patientPaid, patientBalance };
}

/**
 * A receipt's figures as they stood when it was taken (27 Nov 2026, reception: receipt R-000081 for ₹300 printed the
 * bill's later total and paid amount, ₹3,300): the items on the bill at that moment (added by then and not yet taken
 * off), the discount and the insurer's approved amount given by then, and the money in and out up to this receipt
 * (one taken at the same moment counts only when it comes before it on the bill). Worked out from what the bill keeps,
 * so it holds for the receipts already taken too; a rate changed later is not seen (the bill keeps no older rates).
 */
export function totalsAsOf(bill, payment) {
  const at = new Date(payment?.at ?? NaN).getTime();
  if (Number.isNaN(at)) return totals(bill);
  // a stamp without a time (none is made so) counts as before the receipt
  const by = (stamp) => stamp?.at == null || new Date(stamp.at).getTime() <= at;
  const all = bill.payments ?? [];
  const index = all.indexOf(payment);
  const lines = (bill.lines ?? []).filter((l) => by(l.added) && !(l.removed && by(l.removed))).map((l) => ({ ...l, removed: null }));
  const payments = all.filter((p, i) => {
    const t = new Date(p.at).getTime();
    return t < at || (t === at && i <= index);
  });
  return totals({ ...bill, status: 'open', lines, payments, discount: bill.discount && by(bill.discount) ? bill.discount : null, claim: bill.claim && by(bill.claim) ? bill.claim : null });
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
