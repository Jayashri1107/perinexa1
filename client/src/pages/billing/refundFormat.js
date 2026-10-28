// Refund of a bill and bill settlement (owner, 28 Oct 2026): what the screens show before anything is saved. The server
// (routes/billing.js, /refund and /settle) works the same out again and decides. Amounts are paise.

/** The services still on the bill. */
export const liveServices = (bill) => (bill?.lines ?? []).filter((l) => !l.removed);

/**
 * What is given back when these services are taken off: what was paid beyond the bill's new total (a percentage
 * discount follows the new subtotal; an amount discount stays, at most the new subtotal). 0 when nothing was paid.
 */
export function refundFor(bill, chosenIds) {
  if (!bill) return 0;
  const chosen = new Set(chosenIds);
  const subtotal = liveServices(bill)
    .filter((l) => !chosen.has(l.id))
    .reduce((s, l) => s + l.amountPaise, 0);
  const d = bill.discountInfo;
  const discount = !d ? 0 : Math.min(subtotal, d.mode === 'percent' ? Math.round((subtotal * d.value) / 100) : (bill.discount ?? 0));
  return Math.max(0, bill.paid - (subtotal - discount));
}

/** A credit bill: not cancelled, money still due. */
export const isCredit = (b) => b.status !== 'cancelled' && b.balance > 0;

/** What is still due after a concession, and what the amount received can be at most. */
export function settlementCheck(bill, { concessionPaise = 0, amountPaise = 0, concessionReason = '', mode = '' }) {
  const fields = {};
  const due = bill.balance;
  if (concessionPaise > due) fields.concessionPaise = 'More than is due.';
  if (concessionPaise > 0 && concessionReason.trim().length < 3) fields.concessionReason = 'Write why the concession is given.';
  if (amountPaise > due - concessionPaise) fields.amountPaise = 'More than is due after the concession.';
  if (amountPaise > 0 && !mode) fields.mode = 'Choose how it was paid.';
  if (!amountPaise && !concessionPaise) fields.amountPaise = 'Enter the amount received or a concession.';
  return { fields, left: Math.max(0, due - concessionPaise - amountPaise) };
}
