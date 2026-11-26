// Sale return patient-wise (24 Nov 2026, the developer, after the "Sales Return" window of the pharmacy's earlier
// software): one patient's medicines from all her bills in one list – OPD her counter sales, IPD her ward issues – and
// the quantities taken back from several bills at once. Each bill gets its own GST credit note (returnItems), as when a
// bill is opened and its medicines are taken back.
// Money: a counter bill is credited first. Money is given back only for what was paid beyond what is still owed after
// the return – a bill on credit is not paid out in cash. A ward issue lowers its line on the hospital bill (never when
// that bill is final or cancelled).
// The pure parts (the list and the split) are here; the route is routes/pharmacyPatientReturn.js.

import { isoDay, utcDay } from '../careplans/dates.js';
import { partOf } from './gst.js';

export const RETURN_TYPES = { opd: 'sale', ipd: 'issue' };
export const RETURN_LINE_LIMIT = 500;

const expired = (line, today) => utcDay(line.expiry) < utcDay(today);
const unitGross = (l) => (l.grossPaise ?? l.qty * l.mrpPaise) / l.qty;

/**
 * Money of a return of `amountPaise` from one bill, from its totals before the return (invoiceTotals):
 * { refundPaise, creditPaise }. A hospital-bill line: all of it comes off the hospital bill.
 */
export function returnSplit(totals, amountPaise, { onHospitalBill = false } = {}) {
  if (onHospitalBill) return { refundPaise: 0, creditPaise: amountPaise };
  const paid = Math.max(0, totals.paidPaise ?? 0);
  const owedAfter = Math.max(0, totals.netPaise - amountPaise - (totals.settlementConcessionPaise ?? 0));
  const refundPaise = Math.min(amountPaise, Math.max(0, paid - owedAfter));
  return { refundPaise, creditPaise: amountPaise - refundPaise };
}

/**
 * The medicines that can be taken back, newest bill first: lines with something not yet returned and not expired.
 * bills: Map billId → hospital bill ({ final, status }) – a line on a final or cancelled hospital bill is left out
 * (closedLines counts them). barcodes: Map medicineId → [codes]. totalsOf: invoiceTotals.
 */
export function returnableLines(invoices, { today, bills = new Map(), barcodes = new Map(), totalsOf, madeOf = () => null }) {
  const rows = [];
  let closedLines = 0;
  let expiredLines = 0;
  const sorted = [...invoices].sort((a, b) => new Date(b.created?.at ?? b.createdAt) - new Date(a.created?.at ?? a.createdAt) || String(b.number).localeCompare(String(a.number)));
  const billsOut = [];
  for (const inv of sorted) {
    const hospital = Boolean(inv.billId);
    const bill = hospital ? bills.get(String(inv.billId)) : null;
    const closed = hospital && (!bill || bill.status !== 'open' || Boolean(bill.final));
    const t = totalsOf(inv);
    const left = inv.lines.filter((l) => (l.returnedQty ?? 0) < l.qty);
    if (!left.length) continue;
    if (closed) {
      closedLines += left.length;
      continue;
    }
    let shown = 0;
    for (const l of left) {
      if (expired(l, today)) {
        expiredLines += 1;
        continue;
      }
      shown += 1;
      rows.push({
        key: `${inv._id}:${l._id}`,
        invoiceId: String(inv._id),
        lineId: String(l._id),
        number: inv.number,
        date: inv.created?.at ?? inv.createdAt,
        name: l.name,
        generic: l.generic ?? '',
        batch: l.batch,
        expiry: l.expiry ? isoDay(l.expiry) : null,
        mrpPaise: l.mrpPaise,
        unitGrossPaise: unitGross(l),
        qty: l.qty,
        returnedQty: l.returnedQty ?? 0,
        canReturnQty: l.qty - (l.returnedQty ?? 0),
        discountPercent: l.discountPercent ?? inv.discountPercent ?? 0,
        gstRate: l.gstRate,
        amountPaise: l.amountPaise,
        barcodes: barcodes.get(String(l.medicineId)) ?? [],
      });
    }
    if (shown) {
      billsOut.push({
        invoiceId: String(inv._id),
        number: inv.number,
        date: inv.created?.at ?? inv.createdAt,
        onHospitalBill: hospital,
        netPaise: t.netPaise,
        paidPaise: hospital ? null : t.paidPaise,
        concessionPaise: t.settlementConcessionPaise ?? 0,
        balancePaise: hospital ? null : t.balancePaise,
        madeAs: madeOf(inv), // 'cash' | 'credit' | 'hospital' – as the bill was made, whatever was returned or paid since
        doctor: inv.doctor?.name ?? '',
      });
    }
  }
  return { lines: rows.slice(0, RETURN_LINE_LIMIT), more: rows.length > RETURN_LINE_LIMIT, bills: billsOut, closedLines, expiredLines };
}

/** What a returned quantity of one line is worth: at MRP, the discount on it, and the credit (after the discount). */
export function returnedMoney(line, qty) {
  const gross = Math.round(unitGross(line) * qty);
  const amount = partOf(line, qty).amountPaise;
  return { grossPaise: gross, discountPaise: Math.max(0, gross - amount), amountPaise: amount };
}
