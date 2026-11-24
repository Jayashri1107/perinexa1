// Pharmacy → Sale return patient-wise (24 Nov 2026): what Search asks for, what each typed quantity is worth, and the
// figures under the list – the same rules as the server (server/src/pharmacy/patientReturn.js), kept apart from the
// screen so they can be tested.

export const RETURN_KINDS = [
  ['opd', 'OPD'],
  ['ipd', 'IPD'],
];

/** Why Search can't be pressed yet ('' when it can). */
export function findProblem(form) {
  return form.mrn.trim().length >= 2 || form.first.trim().length >= 2 ? '' : 'Type the registration number (UHID) or at least two letters of the first name.';
}

/** What Search asks the server for. */
export const findQuery = (form) => ({
  type: form.type,
  ...(form.mrn.trim() ? { mrn: form.mrn.trim() } : {}),
  ...(form.first.trim() ? { first: form.first.trim() } : {}),
  ...(form.doctor.trim() ? { doctor: form.doctor.trim() } : {}),
});

/** A quantity typed: a whole number from 0 to what can be taken back, or null when it isn't one. '' is 0. */
export function typedQty(text, max) {
  const t = String(text ?? '').trim();
  if (!t) return 0;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n <= max ? n : null;
}

/** What `qty` units of a line are worth, as its credit note will say: at MRP, the discount, after the discount. */
export function lineReturn(line, qty) {
  const gross = Math.round(line.unitGrossPaise * qty);
  const amount = Math.round((line.amountPaise * qty) / line.qty);
  return { grossPaise: gross, discountPaise: Math.max(0, gross - amount), amountPaise: amount };
}

/** A bill's money: given back only for what was paid beyond what is still owed after the return. */
export function returnSplit(bill, amountPaise) {
  if (bill.onHospitalBill) return { refundPaise: 0, creditPaise: amountPaise };
  const paid = Math.max(0, bill.paidPaise ?? 0);
  const owedAfter = Math.max(0, bill.netPaise - amountPaise - (bill.concessionPaise ?? 0));
  const refundPaise = Math.min(amountPaise, Math.max(0, paid - owedAfter));
  return { refundPaise, creditPaise: amountPaise - refundPaise };
}

/** Where a bill's return is counted on the screen: a bill paid in full is Cash; one with credit, or on the hospital bill, Credit. */
export const sideOf = (bill) => (bill.onHospitalBill || (bill.balancePaise ?? 0) > 0 ? 'credit' : 'cash');

/** The pay word of a bill in the list. */
export const payWord = (bill) => (!bill ? '' : bill.onHospitalBill ? 'Hospital bill' : (bill.balancePaise ?? 0) > 0 ? 'Credit' : 'Cash');

/**
 * The figures under the list, as on the earlier window. typed: { [line key]: text }. Returns
 * { cash: { gross, disc, net, money }, credit: { …, money }, total: { … }, chosen: [{ line, qty, …money }], problem }.
 * cash.money: money given back; credit.money: taken off what is owed (or off the hospital bill).
 */
export function returnFigures(data, typed) {
  const zero = () => ({ grossPaise: 0, discountPaise: 0, amountPaise: 0, moneyPaise: 0 });
  const out = { cash: zero(), credit: zero(), total: zero(), chosen: [], problem: '' };
  if (!data) return out;
  const bills = new Map((data.bills ?? []).map((b) => [b.invoiceId, b]));
  const byBill = new Map();
  for (const line of data.lines ?? []) {
    const qty = typedQty(typed[line.key], line.canReturnQty);
    if (qty === null) {
      out.problem = `${line.name} (bill ${line.number}): type a whole number from 0 to ${line.canReturnQty}.`;
      continue;
    }
    if (!qty) continue;
    const money = lineReturn(line, qty);
    out.chosen.push({ line, qty, ...money });
    const b = byBill.get(line.invoiceId) ?? { amountPaise: 0 };
    b.amountPaise += money.amountPaise;
    byBill.set(line.invoiceId, b);
    const side = out[sideOf(bills.get(line.invoiceId) ?? {})];
    side.grossPaise += money.grossPaise;
    side.discountPaise += money.discountPaise;
    side.amountPaise += money.amountPaise;
  }
  for (const [invoiceId, b] of byBill) {
    const split = returnSplit(bills.get(invoiceId) ?? { onHospitalBill: true }, b.amountPaise);
    out.cash.moneyPaise += split.refundPaise;
    out.credit.moneyPaise += split.creditPaise;
  }
  for (const k of ['grossPaise', 'discountPaise', 'amountPaise', 'moneyPaise']) out.total[k] = out.cash[k] + out.credit[k];
  return out;
}

/** What Save sends. */
export const returnBody = ({ patientId, type, chosen, reason, mode }) => ({
  patientId,
  type,
  items: chosen.map((c) => ({ invoiceId: c.line.invoiceId, lineId: c.line.lineId, qty: c.qty })),
  reason: reason.trim(),
  refund: { mode },
});

/** A barcode as typed or scanned: no spaces, capitals. */
export const cleanCode = (text) => String(text ?? '').replace(/\s+/g, '').toUpperCase();

/** The line a scanned barcode adds one to: the newest with that barcode that still has something to take back. */
export function lineForCode(lines, typed, code) {
  const c = cleanCode(code);
  return (lines ?? []).find((l) => (l.barcodes ?? []).includes(c) && (typedQty(typed[l.key], l.canReturnQty) ?? l.canReturnQty) < l.canReturnQty) ?? null;
}

/** The lines shown: those whose name or generic name has what is typed in Item name. */
export const linesShown = (lines, item) => {
  const t = item.trim().toLowerCase();
  return t ? (lines ?? []).filter((l) => `${l.name} ${l.generic ?? ''}`.toLowerCase().includes(t)) : (lines ?? []);
};
