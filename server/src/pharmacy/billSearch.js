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
 *  - since, before: the first instant of the From day, and the instant after the To day
 *  - number: part of the sales number, or of a return's credit-note number (CN-…) – a regular expression
 *  - item: part of a medicine's name or generic name on the bill – a regular expression
 *  - person: { patientIds, parts, walkIns } – the registered patients a name or UHID means; parts: the name typed, as
 *    regular expressions, for walk-in customers (walkIns false with a UHID: a walk-in has none)
 */
export function billFilter({ tenantId, type = null, since = null, before = null, number = null, item = null, person = null }) {
  const and = [];
  if (type) and.push(BILL_TYPES[type]);
  if (since || before) and.push({ 'created.at': { ...(since ? { $gte: since } : {}), ...(before ? { $lt: before } : {}) } });
  if (number) and.push({ $or: [{ number }, { 'returns.number': number }] });
  if (item) and.push({ $or: [{ 'lines.name': item }, { 'lines.generic': item }] });
  if (person) {
    const who = [{ patientId: { $in: person.patientIds } }];
    if (person.walkIns && person.parts.length) who.push({ patientId: null, $and: person.parts.map((rx) => ({ $or: [{ 'customer.name': rx }, { 'buyer.name': rx }] })) });
    and.push({ $or: who });
  }
  return { tenantId, ...(and.length ? { $and: and } : {}) };
}

/**
 * One bill as the list shows it. t: the bill's sums (invoiceTotals in pharmacyService.js); patient: the registered
 * patient's { fullName, mrn }, or null for a walk-in.
 * Credit is counted as on the Credit report (misReports.js): what is still due at the counter, or the whole bill when it
 * went on the patient's hospital bill (paid at the billing desk).
 * patientId, doctorName, totalPaise and returns (25 Nov 2026, the pharmacy's request: an IP bill summary laid out as
 * the earlier software's) – totalPaise is the bill's own total before any return against it (t.netPaise already has
 * the return taken off); patientId is for looking up her advance (GET /pharmacy/settlement?patientId=…).
 */
export function billRow(inv, t, patient = null) {
  const counter = !inv.billId;
  return {
    id: String(inv._id),
    number: inv.number,
    date: inv.created?.at ?? inv.createdAt,
    type: inv.kind === 'issue' ? 'ipd' : inv.patientId ? 'opd' : 'external',
    mrn: patient?.mrn ?? '',
    name: patient ? patient.fullName : inv.patientId ? '' : inv.buyer?.name || inv.customer?.name || 'Walk-in customer',
    patientId: inv.patientId ? String(inv.patientId) : null,
    doctorName: inv.doctor?.name ?? '',
    totalPaise: t.totalPaise,
    discPaise: Math.max(0, t.grossPaise - t.totalPaise) + (t.settlementConcessionPaise ?? 0),
    netPaise: t.netPaise,
    paidPaise: counter ? (t.paidPaise ?? 0) : 0,
    balPaise: counter ? (t.balancePaise ?? 0) : t.netPaise,
    onHospitalBill: !counter,
    returns: (inv.returns ?? []).map((r) => ({ number: r.number, at: r.at, amountPaise: sum(r.lines).amountPaise })),
    lines: (inv.lines ?? []).map((l) => ({ id: String(l._id), name: l.name, batch: l.batch, expiry: isoDay(l.expiry), mrpPaise: l.mrpPaise, qty: l.qty, returnedQty: l.returnedQty ?? 0, amountPaise: l.amountPaise })),
  };
}

/** On credit: something still due at the counter, or on the hospital bill. Everything else was paid in full here. */
export const isCredit = (row) => row.onHospitalBill || row.balPaise > 0;
/** pay: 'cash' | 'credit' | nothing (both). */
export const payFits = (row, pay) => !pay || (pay === 'credit') === isCredit(row);

/**
 * The sums under the list: Total Sales Amt (after returns), Received Amt (at the counter) and Credit Amount – they
 * add up: sales = received + credit. hospitalPaise: how much of the credit is on hospital bills.
 */
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
