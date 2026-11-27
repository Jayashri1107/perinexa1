// Pharmacy Daily Collection (24 Nov 2026, the developer, after the pharmacy's earlier software's printed report):
// four sections – Cash Sales, Cash Sales Return, Credit Sale, Due Collection – each row split by how it was paid,
// then the money by mode (Sales, Sales Return, Advance, Advance Refund), the net collection and the sale types.
// PURE: the route loads the period's invoices (made in it, or with a payment or return in it) and advance entries;
// this file only sorts them.
//
// Every sale is judged on its own hospital day, so a period's report is the sum of its days:
//  - Cash Sales: a counter sale's payments taken with the bill when it was saved (and advance used then).
//  - Credit Sale: what was left unpaid when the bill was saved – a hospital-bill sale is credit in full; returns of
//    that day lower it. A concession is not money received, so it is never in a payment column.
//  - Due Collection: a payment for a credit bill after it was saved – a Settlement, or Receive payment – with the date
//    it was paid, the same day or later (26 Nov 2026, the pharmacy's request: "the settlement amount should show in Due
//    Collection", as the earlier software; before, a payment on the day of the sale was counted as a cash sale).
//  - Cash Sales Return: money given back at the counter for returned medicines (shown as a positive amount and taken
//    away from the sales).
// Advance used moves no money (it was counted when it was deposited): it has its own column, never a payment column.
// Deposits and refunds of advance are money taken or given back, so they are in the net collection.

import { addDays, hospitalDayStart, isoDay, toHospitalDate } from '../careplans/dates.js';
import { sum } from './gst.js';

export const COLLECTION_MODES = ['cash', 'cheque', 'card', 'neft', 'upi'];
export const COLLECTION_SECTIONS = [
  { key: 'cash-sales', title: 'Cash Sales' },
  { key: 'cash-sales-return', title: 'Cash Sales Return' },
  { key: 'credit-sale', title: 'Credit Sale' },
  { key: 'due-collection', title: 'Due Collection' },
];
const COLUMNS = ['netPaise', 'cashPaise', 'chequePaise', 'cardPaise', 'neftPaise', 'upiPaise', 'advancePaise'];

const day = (at) => isoDay(toHospitalDate(at));
const inRange = (at, from, to) => Boolean(at) && new Date(at) >= from && new Date(at) < to;
const madeAt = (inv) => inv.created?.at ?? inv.createdAt;
// A payment saved with the bill: never a settlement's, and the bill's own time (a minute's leeway) or no time of its own
const atSale = (inv, p) => !p.settlementId && (!p.at || Math.abs(new Date(p.at).getTime() - new Date(madeAt(inv)).getTime()) < 60_000);

function personOf(inv, patients) {
  const patient = inv.patientId ? patients.get(String(inv.patientId)) : null;
  if (patient) return { mrn: patient.mrn ?? '', name: patient.fullName };
  if (inv.patientId) return { mrn: '', name: 'Patient' };
  return { mrn: '', name: inv.buyer?.name || inv.customer?.name || 'Walk-in customer' };
}

function rowOf(inv, patients, date, number, netPaise) {
  const who = personOf(inv, patients);
  return {
    invoiceId: String(inv._id),
    date,
    saleNumber: number,
    mrn: who.mrn,
    name: who.name,
    netPaise,
    cashPaise: 0,
    chequePaise: 0,
    cardPaise: 0,
    neftPaise: 0,
    upiPaise: 0,
    advancePaise: 0,
  };
}

/** Puts one payment's amount in its column: a payment mode, or the advance used. */
function put(row, mode, amountPaise) {
  const key = mode === 'advance' ? 'advancePaise' : `${mode}Paise`;
  if (key in row && key !== 'netPaise') row[key] += amountPaise;
}

const totalOf = (rows) => Object.fromEntries(COLUMNS.map((k) => [k, rows.reduce((n, r) => n + r[k], 0)]));

/** The credit note given back with this refund: the return saved with it (the same moment, give or take a little). */
function returnOf(inv, refund) {
  const at = new Date(refund.at).getTime();
  let best = null;
  for (const r of inv.returns ?? []) {
    const gap = Math.abs(new Date(r.at).getTime() - at);
    if (gap <= 120_000 && (!best || gap < best.gap)) best = { number: r.number, gap };
  }
  return best?.number ?? '';
}

/**
 * The Daily Collection of a period. data: { invoices, patients: Map, advances }. from, to: the period's first instant
 * and the instant after it.
 */
export function dailyCollection({ invoices = [], patients = new Map(), advances = [] }, { from, to }) {
  const sections = COLLECTION_SECTIONS.map((s) => ({ ...s, rows: [] }));
  const at = Object.fromEntries(sections.map((s) => [s.key, s.rows]));
  let saleCount = 0;
  let salesNetPaise = 0;

  for (const inv of invoices) {
    // A ward issue on the hospital bill is paid at the billing desk: never a counter collection. One paid at the counter
    // in part or put on credit there (27 Nov 2026) is counted as a counter sale is – its settlement is a due collection.
    if (inv.kind !== 'sale' && inv.billId) continue;
    const soldOn = day(madeAt(inv));
    const dayEnd = hospitalDayStart(addDays(soldOn, 1));

    if (inRange(madeAt(inv), from, to)) {
      // The bill as it stood at the end of the day it was sold: returns of that day lower it, later ones are later news
      const returned = sum((inv.returns ?? []).filter((r) => new Date(r.at) < dayEnd).flatMap((r) => r.lines)).amountPaise;
      const net = sum(inv.lines).amountPaise - returned;
      saleCount += 1;
      salesNetPaise += net;
      if (inv.billId) {
        if (net > 0) at['credit-sale'].push(rowOf(inv, patients, soldOn, inv.number, net));
      } else {
        const paid = (inv.payments ?? []).filter((p) => p.kind === 'payment' && atSale(inv, p));
        const paidPaise = paid.reduce((n, p) => n + p.amountPaise, 0);
        if (paid.length) {
          const row = rowOf(inv, patients, soldOn, inv.number, paidPaise);
          for (const p of paid) put(row, p.mode, p.amountPaise);
          at['cash-sales'].push(row);
        }
        const credit = Math.max(0, net - paidPaise);
        if (credit > 0) at['credit-sale'].push(rowOf(inv, patients, soldOn, inv.number, credit));
      }
    }

    if (inv.billId) continue; // a hospital bill is paid at the billing desk
    for (const p of inv.payments ?? []) {
      if (!inRange(p.at, from, to)) continue;
      if (p.kind === 'refund') {
        const row = rowOf(inv, patients, day(p.at), returnOf(inv, p) || inv.number, p.amountPaise);
        put(row, p.mode, p.amountPaise);
        at['cash-sales-return'].push(row);
      } else if (p.kind === 'payment' && !atSale(inv, p)) {
        const row = rowOf(inv, patients, day(p.at), inv.number, p.amountPaise);
        put(row, p.mode, p.amountPaise);
        at['due-collection'].push(row);
      }
    }
  }

  for (const s of sections) {
    s.rows.sort((a, b) => a.date.localeCompare(b.date) || a.saleNumber.localeCompare(b.saleNumber));
    s.total = totalOf(s.rows);
  }
  const by = Object.fromEntries(sections.map((s) => [s.key, s.total]));

  const entries = advances.filter((e) => inRange(e.created?.at ?? e.createdAt, from, to));
  const advanceOf = (kind, mode) => entries.filter((e) => e.kind === kind && (e.mode || 'cash') === mode).reduce((n, e) => n + e.amountPaise, 0);
  const modes = COLLECTION_MODES.map((mode) => {
    const k = `${mode}Paise`;
    const salesPaise = by['cash-sales'][k] + by['due-collection'][k];
    const returnPaise = by['cash-sales-return'][k];
    const advancePaise = advanceOf('deposit', mode);
    const advanceRefundPaise = advanceOf('refund', mode);
    return { mode, salesPaise, returnPaise, advancePaise, advanceRefundPaise, netPaise: salesPaise - returnPaise + advancePaise - advanceRefundPaise };
  });
  const add = (k) => modes.reduce((n, m) => n + m[k], 0);

  return {
    title: 'Pharmacy Daily Collection',
    sections,
    modes,
    saleTypes: sections.map((s) => ({ key: s.key, label: s.title, paise: s.total.netPaise })),
    summary: {
      saleCount,
      salesNetPaise,
      salesPaise: add('salesPaise'),
      returnPaise: add('returnPaise'),
      advancePaise: add('advancePaise'),
      advanceRefundPaise: add('advanceRefundPaise'),
      netCollectionPaise: add('netPaise'),
      advanceUsedPaise: by['cash-sales'].advancePaise + by['due-collection'].advancePaise,
    },
  };
}
