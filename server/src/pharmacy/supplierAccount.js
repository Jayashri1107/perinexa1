// PH11 (docs/PHARMACY_BUILD_NOTE.md): what each supplier is owed. A supplier's account = its bills WITH tax (the GRN's
// net; a bill entered before the GRN form only has its value before tax and is marked so) − the debit notes of stock
// sent back − the payments entered in Perinexa (the accountant's answer through the owner, 10 Nov 2026). Cancelled
// bills, returns and payments do not count. A bill is due on its date + the supplier's credit days; what was paid and
// sent back settles the oldest bills first (or the bills a payment names), and what is left of a bill past its due date
// is overdue. PURE.

import { addDays, isoDay, utcDay } from '../careplans/dates.js';

const billAmount = (p) => (p.grn && p.grn.netPaise != null ? p.grn.netPaise : p.totalPaise);

/**
 * purchases, returns (with totals.amountPaise or lines), payments: lean documents of ONE supplier. supplier: { creditDays }.
 * Returns { bills, payments, returns, totals: { billedPaise, returnedPaise, paidPaise, owedPaise, overduePaise }, taxMissing }.
 */
export function supplierAccount({ supplier, purchases, returns, payments, today }) {
  const days = supplier?.creditDays ?? 0;
  const t = utcDay(today);
  const bills = purchases
    .filter((p) => p.status !== 'cancelled')
    .map((p) => {
      const due = addDays(utcDay(p.invoiceDate), days);
      return { id: String(p._id), number: p.number, invoiceNo: p.invoiceNo, invoiceDate: isoDay(p.invoiceDate), dueDate: isoDay(due), due, amountPaise: billAmount(p), taxRecorded: Boolean(p.grn && p.grn.netPaise != null), leftPaise: billAmount(p) };
    })
    .sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.number.localeCompare(b.number));
  const activeReturns = returns.filter((r) => r.status !== 'cancelled');
  const returnAmount = (r) => (r.lines ?? []).reduce((s, l) => s + (l.amountPaise ?? 0), 0);
  const activePayments = payments.filter((p) => !p.cancelled);
  // Settle: a payment that names bills settles those first; the rest (and the debit notes) the oldest bills
  const byId = new Map(bills.map((b) => [b.id, b]));
  let loose = activeReturns.reduce((s, r) => s + returnAmount(r), 0);
  for (const p of activePayments) {
    let left = p.amountPaise;
    for (const id of (p.purchaseIds ?? []).map(String)) {
      const b = byId.get(id);
      if (!b || !left) continue;
      const take = Math.min(left, b.leftPaise);
      b.leftPaise -= take;
      left -= take;
    }
    loose += left;
  }
  for (const b of bills) {
    if (!loose) break;
    const take = Math.min(loose, b.leftPaise);
    b.leftPaise -= take;
    loose -= take;
  }
  const billedPaise = bills.reduce((s, b) => s + b.amountPaise, 0);
  const returnedPaise = activeReturns.reduce((s, r) => s + returnAmount(r), 0);
  const paidPaise = activePayments.reduce((s, p) => s + p.amountPaise, 0);
  const out = bills.map(({ due, ...b }) => ({ ...b, paidPaise: b.amountPaise - b.leftPaise, overdue: b.leftPaise > 0 && due < t }));
  return {
    bills: out,
    payments: payments.map((p) => ({ id: String(p._id), number: p.number, on: isoDay(p.on), amountPaise: p.amountPaise, mode: p.mode, reference: p.reference ?? '', byName: p.created?.byName ?? '', cancelled: p.cancelled ? { byName: p.cancelled.byName, at: p.cancelled.at, reason: p.cancelled.reason } : null })),
    returns: activeReturns.map((r) => ({ id: String(r._id), number: r.number, on: isoDay(r.created?.at ?? r.createdAt), amountPaise: returnAmount(r) })),
    totals: { billedPaise, returnedPaise, paidPaise, owedPaise: billedPaise - returnedPaise - paidPaise, overduePaise: out.filter((b) => b.overdue).reduce((s, b) => s + b.leftPaise, 0) },
    taxMissing: out.filter((b) => !b.taxRecorded).length,
  };
}
