// Search bill (23 Nov 2026, the developer, after the "Browse Sales Bill" window of the pharmacy's earlier software):
// the bills that fit what the pharmacist ticked – patient type, name, UHID, sales number, dates, an item, cash or
// credit – each with its medicines, and the sums under the list. PURE: the route (routes/pharmacyBillSearch.js) reads
// the request, finds the patients a name or number means and loads the bills; these functions build the filter and lay
// the bills out.

import { isoDay } from '../careplans/dates.js';
import { sum } from './gst.js';

// The same three types as the Sales bill's search (BILL_TYPES in routes/pharmacy.js): OPD – a registered patient's
// counter sale; IPD – an issue to an admitted patient; External – a walk-in customer.
export const BILL_TYPES = { opd: { kind: 'sale', patientId: { $ne: null } }, ipd: { kind: 'issue' }, external: { patientId: null } };
export const PAY_CHOICES = ['cash', 'credit'];
// The newest bills that fit are listed and summed; when more fit, the page says so
export const BILL_SEARCH_LIMIT = 1000;

/**
 * The filter for PharmacyInvoice.find. Every part given must fit: they are joined with $and, so two parts that both
 * speak of patientId (External, and a patient's name) never overwrite each other.
 *  - type: 'opd' | 'ipd' | 'external'
 *  - since, before: the first instant of the From day, and the instant after the To day – a bill made then, or one
 *    with a return made then
 *  - number: part of the sales number, or of a return's credit-note number (CN-…) – a regular expression
 *  - item: part of a medicine's name or generic name on the bill – a regular expression
 *  - person: { patientIds, parts, walkIns } – the registered patients a name or UHID means; parts: the name typed, as
 *    regular expressions, for walk-in customers (walkIns false with a UHID: a walk-in has none)
 */
export function billFilter({ tenantId, type = null, since = null, before = null, number = null, item = null, person = null }) {
  const and = [];
  if (type) and.push(BILL_TYPES[type]);
  // The bills of those days, and (26 Nov 2026) those with a return on those days – the return is listed on its own day
  if (since || before) {
    const range = { ...(since ? { $gte: since } : {}), ...(before ? { $lt: before } : {}) };
    and.push({ $or: [{ 'created.at': range }, { returns: { $elemMatch: { at: range } } }] });
  }
  if (number) and.push({ $or: [{ number }, { 'returns.number': number }] });
  if (item) and.push({ $or: [{ 'lines.name': item }, { 'lines.generic': item }] });
  if (person) {
    const who = [{ patientId: { $in: person.patientIds } }];
    if (person.walkIns && person.parts.length) who.push({ patientId: null, $and: person.parts.map((rx) => ({ $or: [{ 'customer.name': rx }, { 'buyer.name': rx }] })) });
    and.push({ $or: who });
  }
  return { tenantId, ...(and.length ? { $and: and } : {}) };
}

/** Who a bill (and each of its returns) is for, as the list shows it. */
function whoOf(inv, patient) {
  return {
    type: inv.kind === 'issue' ? 'ipd' : inv.patientId ? 'opd' : 'external',
    mrn: patient?.mrn ?? '',
    name: patient ? patient.fullName : inv.patientId ? '' : inv.buyer?.name || inv.customer?.name || 'Walk-in customer',
    patientId: inv.patientId ? String(inv.patientId) : null,
    doctorName: inv.doctor?.name ?? '',
  };
}

/**
 * One bill as the list shows it. t: the bill's sums (invoiceTotals in pharmacyService.js); patient: the registered
 * patient's { fullName, mrn }, or null for a walk-in; made: asMade (pharmacyService.js) – what was taken for it and
 * whether it was made as cash, credit or on the hospital bill.
 * 26 Nov 2026 (the developer): the bill as it was made – a return is a row of its own (returnRows), so Net amt and
 * Paid amt never change after one; Bal amt is what is still due on it now (nothing, once she has settled), or for a
 * bill on the hospital bill the whole bill (its returns come off in their own rows).
 * patientId, doctorName, totalPaise and returns (25 Nov 2026, the IP bill summary): patientId is for looking up her
 * advance (GET /pharmacy/settlement?patientId=…).
 */
export function billRow(inv, t, patient = null, made = null) {
  const counter = !inv.billId;
  return {
    id: String(inv._id),
    number: inv.number,
    date: inv.created?.at ?? inv.createdAt,
    ...whoOf(inv, patient),
    totalPaise: t.totalPaise,
    discPaise: Math.max(0, t.grossPaise - t.totalPaise) + (t.settlementConcessionPaise ?? 0),
    netPaise: t.totalPaise,
    paidPaise: counter ? (made?.receivedPaise ?? t.paidPaise ?? 0) : 0,
    balPaise: counter ? (t.balancePaise ?? 0) : t.totalPaise,
    onHospitalBill: !counter,
    madeAs: made?.madeAs ?? (counter ? null : 'hospital'),
    isReturn: false,
    returns: (inv.returns ?? []).map((r) => ({ number: r.number, at: r.at, amountPaise: sum(r.lines).amountPaise })),
    lines: (inv.lines ?? []).map((l) => ({ id: String(l._id), name: l.name, batch: l.batch, expiry: isoDay(l.expiry), mrpPaise: l.mrpPaise, qty: l.qty, returnedQty: l.returnedQty ?? 0, amountPaise: l.amountPaise })),
  };
}

/**
 * The bill's returns as rows of their own (26 Nov 2026, the developer: a return is its own bill, the Sales Return Bill
 * with its CN number): dated the day of the return, the amount taken off as a minus – Net amt the medicines' worth,
 * Paid amt the money given back for it (a refund names its return; one saved before that is matched by its time), and
 * on a hospital bill the Bal amt it takes off that bill. Only those made between since and before, when given.
 * refundMode: how the money was given back; creditPaise: what came off what she owed (or off her hospital bill).
 */
export function returnRows(inv, patient = null, { since = null, before = null, number = null, item = null, made = null } = {}) {
  const counter = !inv.billId;
  const lineOf = new Map((inv.lines ?? []).map((l) => [String(l._id), l]));
  const refunds = (inv.payments ?? []).filter((p) => p.kind === 'refund');
  const hasItem = (r) => r.lines.some((x) => {
    const l = lineOf.get(String(x.lineId));
    return l && (item.test(l.name ?? '') || item.test(l.generic ?? ''));
  });
  return (inv.returns ?? [])
    .filter((r) => (!since || new Date(r.at) >= since) && (!before || new Date(r.at) < before))
    .filter((r) => !number || number.test(r.number) || number.test(inv.number))
    .filter((r) => !item || hasItem(r))
    .map((r) => {
      const amount = sum(r.lines).amountPaise;
      const at = new Date(r.at).getTime();
      const own = refunds.filter((p) => (p.creditNote ? p.creditNote === r.number : Math.abs(new Date(p.at).getTime() - at) < 2000));
      const refund = counter ? own.reduce((n, p) => n + p.amountPaise, 0) : 0;
      return {
        id: `${inv._id}:${r.number}`,
        invoiceId: String(inv._id),
        number: r.number,
        returnOf: inv.number,
        date: r.at,
        ...whoOf(inv, patient),
        totalPaise: -amount,
        discPaise: 0,
        netPaise: -amount,
        paidPaise: refund ? -refund : 0,
        balPaise: counter ? 0 : -amount,
        onHospitalBill: !counter,
        madeAs: made?.madeAs ?? (counter ? null : 'hospital'), // her bill's: the Cash or credit choice keeps them together
        isReturn: true,
        refundPaise: refund,
        refundMode: own[0]?.mode ?? null,
        creditPaise: amount - refund,
        returns: [],
        lines: r.lines.map((x) => {
          const l = lineOf.get(String(x.lineId));
          return { id: `${r.number}:${x.lineId}`, name: l?.name ?? '', batch: l?.batch ?? '', expiry: l?.expiry ? isoDay(l.expiry) : null, mrpPaise: l?.mrpPaise ?? 0, qty: x.qty, returnedQty: 0, amountPaise: x.amountPaise };
        }),
      };
    });
}

/**
 * On credit: made on credit (something left due when it was saved) or on the hospital bill; cash: paid in full when it
 * was saved. As the bill was made (26 Nov 2026, the developer) – a return or a later payment doesn't move it; a row
 * without madeAs: something still due, or on the hospital bill.
 */
export const isCredit = (row) => (row.madeAs ? row.madeAs !== 'cash' : row.onHospitalBill || row.balPaise > 0);
/** pay: 'cash' | 'credit' | nothing (both). */
export const payFits = (row, pay) => !pay || (pay === 'credit') === isCredit(row);

/**
 * The sums under the list: Total Sales Amt (after returns), Received Amt (at the counter) and Credit Amount – they
 * add up: sales = received + credit. hospitalPaise: how much of the credit is on hospital bills. The returns' own rows
 * (minus amounts) are in the sums, so the bills' rows can stay as they were made.
 */
/**
 * Search sale return (26 Nov 2026, the pharmacy's request): a return row fits Cash return when money was given back
 * for it, Credit return when (some of) it came off what she owed or her hospital bill – a return can be both.
 */
export const returnFits = (row, pay) => !pay || (pay === 'cash' ? row.refundPaise > 0 : row.creditPaise > 0);

/** The sums under the Search sale return list: the returns' worth, the money given back, and what came off credit. */
export function returnTotals(rows) {
  const add = (pick) => rows.reduce((n, r) => n + pick(r), 0);
  return { count: rows.length, returnPaise: add((r) => -r.netPaise), cashPaise: add((r) => r.refundPaise), creditPaise: add((r) => r.creditPaise) };
}

export function billTotals(rows) {
  const add = (pick) => rows.reduce((n, r) => n + pick(r), 0);
  return {
    count: rows.length,
    salesPaise: add((r) => r.netPaise),
    receivedPaise: add((r) => r.paidPaise),
    creditPaise: add((r) => r.balPaise),
    hospitalPaise: add((r) => (r.onHospitalBill ? r.netPaise : 0)),
  };
}
