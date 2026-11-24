// Pharmacy MIS reports (13 Nov 2026, the developer, after the pharmacy's earlier software): one list of reports in
// three groups – sales and returns, GST, schedule drugs – each a table that can be printed. PURE: the route
// (routes/pharmacyMis.js) loads the period's bills, purchases and returns; these functions only lay them out.
//
// Every report is { key, title, columns, rows, total, summary, patients }:
//   columns  [{ k, label, type }] – type: 'text' | 'date' | 'money' (paise) | 'num'
//   total    one row of sums under the table (null: none)
//   summary  short figures above the table, e.g. what came in by each payment mode
//   patients true when it holds patient or customer names (then it is audited, and only the admin gets the Excel file)
// "Advance report": the pharmacy advance (18 Nov 2026 – before then the pharmacy took no advance in Perinexa).
// "Doctor wise sales" is the existing Sales by doctor report (the pharmacist only – owner's decision 5).

import { isoDay, timeIn, toHospitalDate } from '../careplans/dates.js';
import { dailyCollection } from './dailyCollection.js';
import { sum } from './gst.js';
import { returnTotals } from './supplierReturnsService.js';

// DRAFT – needs the owner's approval (clinical content): the anti-TB medicines, matched on the generic or brand name.
export const ANTI_TB_GENERICS = ['rifampicin', 'rifampin', 'rifabutin', 'rifapentine', 'isoniazid', 'pyrazinamide', 'ethambutol', 'streptomycin', 'ethionamide', 'prothionamide', 'cycloserine', 'terizidone', 'aminosalicylic', 'bedaquiline', 'delamanid', 'pretomanid', 'capreomycin'];
export const isAntiTb = (line) => {
  const t = `${line.generic ?? ''} ${line.name ?? ''}`.toLowerCase();
  return ANTI_TB_GENERICS.some((g) => t.includes(g));
};

export const MIS_GROUPS = [
  {
    title: 'Sales and returns',
    reports: [
      ['sales', 'Sales report'],
      ['sale-lines', 'Sales bill details'],
      ['collection', 'Sales collection'],
      ['card-collection', 'Card collection'],
      ['upi-collection', 'UPI collection'], // 18 Nov 2026, the pharmacy's request
      ['patient-collection', 'Patient-wise collection'],
      ['returns', 'Sales return report'],
      ['return-lines', 'Sales return details'],
      ['patient-returns', 'Sales return patient-wise'], // 18 Nov 2026, the pharmacy's request
      ['credit', 'Credit report'],
      ['patient-credit', 'Patient-wise credit'],
      ['advance', 'Advance amount report'], // 18 Nov 2026
      ['insurance', 'Insurance / cashless patients'], // 18 Nov 2026
    ],
  },
  {
    title: 'GST',
    reports: [
      ['grn-gst', 'GRN GST report'],
      ['sales-gst', 'Sales GST report'],
      ['grn-return-gst', 'GRN return GST report'],
      ['sales-return-gst', 'Sales return GST report'],
      ['gst-summary', 'GST summary by rate'],
    ],
  },
  {
    title: 'Schedule drugs',
    reports: [
      ['h1-sales', 'Sales – Schedule H1'],
      ['narcotic-sales', 'Sales – narcotic (NDPS)'],
      ['antitb-sales', 'Sales – anti-TB'],
      ['antitb-returns', 'Sales returns – anti-TB'],
      ['h1-returns', 'Sales returns – Schedule H1'],
    ],
  },
];
export const MIS_KEYS = MIS_GROUPS.flatMap((g) => g.reports.map(([k]) => k));
export const MIS_TITLES = Object.fromEntries(MIS_GROUPS.flatMap((g) => g.reports));
// The reports that hold no patient or customer names
const NO_NAMES = new Set(['grn-gst', 'grn-return-gst', 'gst-summary']);
// Which data each report needs (the route loads only that)
export const misNeeds = (key) => ({ bills: key === 'insurance', advances: ['advance', 'collection', 'card-collection', 'upi-collection'].includes(key), invoices: !['grn-gst', 'grn-return-gst', 'advance'].includes(key), purchases: ['grn-gst', 'gst-summary'].includes(key), supplierReturns: ['grn-return-gst', 'gst-summary'].includes(key) });

const MODE_LABELS = { cash: 'Cash', upi: 'UPI', card: 'Card', cheque: 'Cheque', neft: 'NEFT', advance: 'Advance' };
const day = (at) => isoDay(toHospitalDate(at));
const col = (k, label, type = 'text') => ({ k, label, type });
const totalOf = (rows, keys, first = {}) => ({ ...first, ...Object.fromEntries(keys.map((k) => [k, rows.reduce((s, r) => s + (r[k] ?? 0), 0)])) });

/** Who a bill is for: the patient (name and number), the walk-in customer, or the business. */
export function personOf(inv, patients) {
  const p = inv.patientId ? patients.get(String(inv.patientId)) : null;
  if (p) return { name: p.fullName, ref: p.mrn ?? '', key: `p:${p._id}` };
  if (inv.buyer?.name) return { name: inv.buyer.name, ref: inv.buyer.gstin ?? '', key: `b:${inv.buyer.gstin || inv.buyer.name}` };
  const c = inv.customer;
  if (c?.name || c?.phone) return { name: c.name || 'Walk-in customer', ref: c.phone ?? '', key: `c:${(c.phone || c.name).toLowerCase()}` };
  return { name: 'Walk-in customer', ref: '', key: 'c:' };
}

/** The bill's money: billed, returned, net and – for a walk-in who pays at the counter – paid and due. */
function billMoney(inv) {
  const sold = sum(inv.lines);
  const returned = sum((inv.returns ?? []).flatMap((r) => r.lines));
  const net = sold.amountPaise - returned.amountPaise;
  const counter = !inv.billId; // paid at the counter (a walk-in, or a patient who paid here); else on the hospital bill
  const paid = counter ? (inv.payments ?? []).reduce((s, x) => s + (x.kind === 'refund' ? -x.amountPaise : x.amountPaise), 0) : 0;
  const concession = (inv.concessions ?? []).reduce((s, x) => s + x.amountPaise, 0);
  return { sold, returned, net, counter, paid, concession, due: counter ? Math.max(0, net - paid - concession) : 0 };
}

/**
 * One report. data: { invoices, purchases, supplierReturns, patients: Map, suppliers: Map } – invoices made in the
 * period, or with a return or payment in it; purchases by invoice date in the period; supplier returns made in it.
 * from, to: the period's first instant and the instant after it.
 */
export function misReport(key, data, { from, to }) {
  const inRange = (t) => t && new Date(t) >= from && new Date(t) < to;
  const invoices = [...(data.invoices ?? [])].sort((a, b) => new Date(a.created.at) - new Date(b.created.at) || a.number.localeCompare(b.number));
  const made = invoices.filter((inv) => inRange(inv.created?.at));
  const patients = data.patients ?? new Map();
  const base = { key, title: MIS_TITLES[key], patients: !NO_NAMES.has(key), summary: [], total: null };
  const lineOf = (inv, id) => inv.lines.find((l) => String(l._id) === String(id));
  // Every return of the period, one entry per credit note
  const creditNotes = invoices.flatMap((inv) => (inv.returns ?? []).filter((r) => inRange(r.at)).map((r) => ({ inv, r })));
  // Every returned line of the period, with the line it came from
  const returnedLines = creditNotes.flatMap(({ inv, r }) => r.lines.map((x) => ({ inv, r, x, line: lineOf(inv, x.lineId) ?? {} })));

  if (key === 'sales') {
    const rows = made.map((inv) => {
      const who = personOf(inv, patients);
      const mny = billMoney(inv);
      const gross = inv.lines.reduce((s, l) => s + (l.grossPaise ?? l.qty * l.mrpPaise), 0);
      return { date: day(inv.created.at), bill: inv.number, type: inv.kind === 'issue' ? 'Ward issue' : 'Sale', name: who.name, ref: who.ref, doctor: inv.doctor?.name ?? '', items: inv.lines.length, gross, discount: gross - mny.sold.amountPaise + mny.concession, amount: mny.sold.amountPaise, returned: mny.returned.amountPaise, net: mny.net };
    });
    const keys = ['items', 'gross', 'discount', 'amount', 'returned', 'net'];
    return {
      ...base,
      columns: [col('date', 'Date', 'date'), col('bill', 'Bill no.'), col('type', 'Type'), col('name', 'Patient / customer'), col('ref', 'Number / phone'), col('doctor', 'Doctor'), col('items', 'Items', 'num'), col('gross', 'At MRP', 'money'), col('discount', 'Discount', 'money'), col('amount', 'Billed', 'money'), col('returned', 'Returned', 'money'), col('net', 'Net', 'money')],
      rows,
      total: totalOf(rows, keys, { date: `${rows.length} bill${rows.length === 1 ? '' : 's'}` }),
      summary: [
        { label: 'Sold at the counter', paise: rows.filter((r) => r.type === 'Sale').reduce((s, r) => s + r.amount, 0) },
        { label: 'Issued to wards', paise: rows.filter((r) => r.type === 'Ward issue').reduce((s, r) => s + r.amount, 0) },
      ],
    };
  }

  if (key === 'sale-lines' || key === 'h1-sales' || key === 'narcotic-sales' || key === 'antitb-sales') {
    const keep = { 'sale-lines': () => true, 'h1-sales': (l) => l.schedule === 'H1', 'narcotic-sales': (l) => l.schedule === 'narcotic', 'antitb-sales': isAntiTb }[key];
    const rows = made.flatMap((inv) => {
      const who = personOf(inv, patients);
      return inv.lines.filter(keep).map((l) => ({ date: day(inv.created.at), time: timeIn(inv.created.at), bill: inv.number, name: who.name, ref: who.ref, doctor: [inv.doctor?.name, inv.doctor?.reg && `Reg. ${inv.doctor.reg}`].filter(Boolean).join(', '), medicine: l.name, generic: l.generic ?? '', batch: l.batch, expiry: l.expiry ? isoDay(l.expiry).slice(0, 7) : '', qty: l.qty, returnedQty: l.returnedQty ?? 0, mrp: l.mrpPaise, gstRate: `${l.gstRate}%`, gst: l.gstPaise, amount: l.amountPaise }));
    });
    const schedule = key !== 'sale-lines';
    return {
      ...base,
      columns: schedule
        ? [col('date', 'Date', 'date'), col('time', 'Time'), col('bill', 'Bill no.'), col('name', 'Patient / customer'), col('ref', 'Number / phone'), col('doctor', 'Prescribing doctor'), col('medicine', 'Medicine'), col('generic', 'Generic'), col('batch', 'Batch'), col('expiry', 'Expiry'), col('qty', 'Qty', 'num'), col('returnedQty', 'Returned', 'num')]
        : [col('date', 'Date', 'date'), col('bill', 'Bill no.'), col('name', 'Patient / customer'), col('medicine', 'Medicine'), col('batch', 'Batch'), col('expiry', 'Expiry'), col('qty', 'Qty', 'num'), col('mrp', 'MRP / unit', 'money'), col('gstRate', 'GST'), col('gst', 'GST amount', 'money'), col('amount', 'Amount', 'money')],
      rows,
      total: totalOf(rows, schedule ? ['qty', 'returnedQty'] : ['qty', 'gst', 'amount'], { date: `${rows.length} line${rows.length === 1 ? '' : 's'}` }),
      note: key === 'antitb-sales' ? 'DRAFT list of anti-TB medicines, matched on the generic name – to be approved by the owner.' : undefined,
    };
  }

  if (key === 'collection' || key === 'card-collection' || key === 'upi-collection') {
    const rows = invoices.flatMap((inv) => {
      const who = personOf(inv, patients);
      return (inv.payments ?? [])
        // a bill paid from the advance moves no money: the advance was counted when it was deposited
        .filter((x) => inRange(x.at) && x.mode !== 'advance' && (key === 'collection' || x.mode === (key === 'upi-collection' ? 'upi' : 'card')))
        .map((x) => ({ at: new Date(x.at), date: day(x.at), time: timeIn(x.at), bill: inv.number, name: who.name, ref: who.ref, mode: MODE_LABELS[x.mode] ?? x.mode ?? '', reference: [x.reference, x.bank].filter(Boolean).join(' · '), received: x.kind === 'refund' ? 0 : x.amountPaise, refunded: x.kind === 'refund' ? x.amountPaise : 0, byName: x.byName ?? '' }));
    });
    // Advance deposits and refunds (18 Nov 2026) are money taken or given back at the counter
    for (const e of data.advances ?? []) {
      if (e.kind === 'used' || !inRange(e.created.at) || (key !== 'collection' && e.mode !== (key === 'upi-collection' ? 'upi' : 'card'))) continue;
      const who = personOf({ patientId: e.patientId }, patients);
      rows.push({ at: new Date(e.created.at), date: day(e.created.at), time: timeIn(e.created.at), bill: `Advance ${e.number}`, name: who.name, ref: who.ref, mode: MODE_LABELS[e.mode] ?? e.mode, reference: e.reference ?? '', received: e.kind === 'deposit' ? e.amountPaise : 0, refunded: e.kind === 'refund' ? e.amountPaise : 0, byName: e.created.byName ?? '' });
    }
    rows.sort((a, b) => a.at - b.at);
    const out = rows.map(({ at, ...r }) => ({ ...r, net: r.received - r.refunded }));
    const modes = [...new Set(out.map((r) => r.mode))].sort();
    return {
      ...base,
      columns: [col('date', 'Date', 'date'), col('time', 'Time'), col('bill', 'Bill no.'), col('name', 'Customer'), col('ref', 'Phone'), col('mode', 'Mode'), col('reference', key === 'card-collection' ? 'Card (last 4) / bank' : key === 'upi-collection' ? 'Transaction id / app' : 'Reference'), col('received', 'Received', 'money'), col('refunded', 'Refunded', 'money'), col('net', 'Net', 'money'), col('byName', 'Taken by')],
      rows: out,
      total: totalOf(out, ['received', 'refunded', 'net'], { date: `${out.length} payment${out.length === 1 ? '' : 's'}` }),
      summary: modes.map((m) => ({ label: m, paise: out.filter((r) => r.mode === m).reduce((s, r) => s + r.net, 0) })),
      note: 'Payments taken at the counter for walk-in sales. Bills of registered patients go on the hospital bill and are paid there.',
      // 24 Nov 2026: Sales collection also as the earlier software's printed Pharmacy Daily Collection (dailyCollection.js)
      ...(key === 'collection' ? { daily: dailyCollection({ invoices, patients, advances: data.advances ?? [] }, { from, to }) } : {}),
    };
  }

  // Insurance / cashless patients (18 Nov 2026, the pharmacy's request): the period's pharmacy bills that went on a
  // hospital bill with insurance or a cashless approval recorded – the medicines the claim covers. data.bills: those
  // hospital bills by id.
  if (key === 'insurance') {
    const bills = data.bills ?? new Map();
    const rows = made
      .filter((inv) => inv.billId && bills.has(String(inv.billId)))
      .map((inv) => {
        const hb = bills.get(String(inv.billId));
        const who = personOf(inv, patients);
        const ins = hb.insurance ?? {};
        return { date: day(inv.created.at), bill: inv.number, type: inv.kind === 'issue' ? 'IPD' : 'OPD', name: who.name, ref: who.ref, hospitalBill: hb.number, insurer: ins.insurer || ins.pmjayId ? ins.insurer || 'PM-JAY' : '', tpa: ins.tpa ?? '', preAuth: ins.preAuthNumber ?? '', claim: ins.claimNumber ?? '', approved: hb.claim?.approvedPaise ?? null, net: billMoney(inv).net };
      });
    return {
      ...base,
      columns: [col('date', 'Date', 'date'), col('bill', 'Bill no.'), col('type', 'Type'), col('name', 'Patient'), col('ref', 'Number'), col('hospitalBill', 'Hospital bill'), col('insurer', 'Insurer / scheme'), col('tpa', 'TPA'), col('preAuth', 'Pre-auth no.'), col('claim', 'Claim no.'), col('approved', 'Approved on the hospital bill', 'money'), col('net', 'Pharmacy net', 'money')],
      rows,
      total: totalOf(rows, ['net'], { date: `${rows.length} bill${rows.length === 1 ? '' : 's'}` }),
      note: 'Pharmacy bills on a hospital bill that has insurance or a cashless approval. The claim itself is made at the billing desk.',
    };
  }

  // Advance amount report (18 Nov 2026): every deposit, use and refund of the period, and each one's sums
  if (key === 'advance') {
    const KIND = { deposit: 'Deposit', used: 'Used on a bill', refund: 'Refund' };
    const rows = (data.advances ?? [])
      .filter((e) => inRange(e.created.at))
      .sort((a, b) => new Date(a.created.at) - new Date(b.created.at))
      .map((e) => {
        const who = personOf({ patientId: e.patientId }, patients);
        return { date: day(e.created.at), time: timeIn(e.created.at), number: e.kind === 'used' ? '' : e.number, name: who.name, ref: who.ref, kind: KIND[e.kind], mode: MODE_LABELS[e.mode] ?? '', bill: e.invoiceNumber ?? '', deposit: e.kind === 'deposit' ? e.amountPaise : 0, used: e.kind === 'used' ? e.amountPaise : 0, refund: e.kind === 'refund' ? e.amountPaise : 0, note: e.reason || e.reference || '', byName: e.created.byName ?? '' };
      });
    const total = totalOf(rows, ['deposit', 'used', 'refund'], { date: `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}` });
    return {
      ...base,
      columns: [col('date', 'Date', 'date'), col('time', 'Time'), col('number', 'Receipt no.'), col('name', 'Patient'), col('ref', 'Number'), col('kind', 'Entry'), col('mode', 'Mode'), col('bill', 'Bill no.'), col('deposit', 'Deposited', 'money'), col('used', 'Used', 'money'), col('refund', 'Refunded', 'money'), col('note', 'Reference / reason'), col('byName', 'By')],
      rows,
      total,
      summary: [{ label: 'Deposited', paise: total.deposit }, { label: 'Used on bills', paise: total.used }, { label: 'Refunded', paise: total.refund }],
      note: 'The balance a patient has left is on her bills on Sold (Advance).',
    };
  }

  if (key === 'patient-collection' || key === 'patient-credit' || key === 'credit') {
    const bills = made.map((inv) => ({ inv, who: personOf(inv, patients), m: billMoney(inv) }));
    // Credit: what was not taken at the counter – a registered patient's bill goes on her hospital bill (paid at the
    // billing desk), and a walk-in bill with something still due
    const onCredit = (b) => !b.m.counter || b.m.due > 0;
    const owed = (b) => (b.m.counter ? b.m.due : b.m.net);
    if (key === 'credit') {
      const rows = bills.filter(onCredit).map((b) => ({ date: day(b.inv.created.at), bill: b.inv.number, type: b.inv.kind === 'issue' ? 'Ward issue' : 'Sale', name: b.who.name, ref: b.who.ref, where: b.m.counter ? (b.inv.patientId ? 'Pharmacy credit' : 'Walk-in, not paid') : 'On the hospital bill', net: b.m.net, paid: b.m.paid, due: owed(b) }));
      return {
        ...base,
        columns: [col('date', 'Date', 'date'), col('bill', 'Bill no.'), col('type', 'Type'), col('name', 'Patient / customer'), col('ref', 'Number / phone'), col('where', 'To be paid'), col('net', 'Net', 'money'), col('paid', 'Paid at the counter', 'money'), col('due', 'Credit', 'money')],
        rows,
        total: totalOf(rows, ['net', 'paid', 'due'], { date: `${rows.length} bill${rows.length === 1 ? '' : 's'}` }),
        note: 'Bills of the period not paid at the counter, after returns: those of registered patients went on the hospital bill and are paid at the billing desk.',
      };
    }
    const by = new Map();
    for (const b of bills) {
      if (key === 'patient-credit' && !onCredit(b)) continue;
      const r = by.get(b.who.key) ?? { name: b.who.name, ref: b.who.ref, bills: 0, net: 0, paid: 0, hospital: 0, due: 0 };
      r.bills += 1;
      r.net += b.m.net;
      r.paid += b.m.paid;
      r.due += key === 'patient-credit' ? owed(b) : b.m.due;
      if (!b.m.counter) r.hospital += b.m.net;
      by.set(b.who.key, r);
    }
    const rows = [...by.values()].sort((a, b) => (key === 'patient-credit' ? b.due - a.due : b.net - a.net) || a.name.localeCompare(b.name));
    return {
      ...base,
      columns:
        key === 'patient-credit'
          ? [col('name', 'Patient / customer'), col('ref', 'Number / phone'), col('bills', 'Bills', 'num'), col('net', 'Net', 'money'), col('paid', 'Paid at the counter', 'money'), col('due', 'Credit', 'money')]
          : [col('name', 'Patient / customer'), col('ref', 'Number / phone'), col('bills', 'Bills', 'num'), col('net', 'Net billed', 'money'), col('paid', 'Paid at the counter', 'money'), col('hospital', 'On the hospital bill', 'money'), col('due', 'Due', 'money')],
      rows,
      total: totalOf(rows, ['bills', 'net', 'paid', 'hospital', 'due'], { name: `${rows.length} ${rows.length === 1 ? 'person' : 'people'}` }),
      note: key === 'patient-credit' ? 'Bills of the period not paid at the counter, by person: registered patients pay them on the hospital bill.' : 'Bills of the period by person, after returns.',
    };
  }

  // Patient-wise (18 Nov 2026): each patient's or customer's returns in the period, the most first
  if (key === 'patient-returns') {
    const by = new Map();
    for (const { inv, r } of creditNotes) {
      const who = personOf(inv, patients);
      const x = by.get(who.key) ?? { name: who.name, ref: who.ref, notes: [], bills: new Set(), items: 0, amount: 0 };
      x.notes.push(r.number);
      x.bills.add(inv.number);
      x.items += r.lines.length;
      x.amount += sum(r.lines).amountPaise;
      by.set(who.key, x);
    }
    const rows = [...by.values()].map(({ notes, bills, ...x }) => ({ ...x, count: notes.length, notes: notes.join(', '), bills: [...bills].join(', ') })).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
    return {
      ...base,
      columns: [col('name', 'Patient / customer'), col('ref', 'Number / phone'), col('count', 'Returns', 'num'), col('notes', 'Credit notes'), col('bills', 'Against bills'), col('items', 'Items', 'num'), col('amount', 'Amount', 'money')],
      rows,
      total: totalOf(rows, ['count', 'items', 'amount'], { name: `${rows.length} ${rows.length === 1 ? 'person' : 'people'}` }),
    };
  }

  if (key === 'returns' || key === 'sales-return-gst') {
    const rows = creditNotes.map(({ inv, r }) => {
      const who = personOf(inv, patients);
      const t = sum(r.lines);
      return { date: day(r.at), note: r.number, bill: inv.number, name: who.name, ref: who.ref, items: r.lines.length, taxable: t.taxablePaise, cgst: t.cgstPaise, sgst: t.sgstPaise, gst: t.gstPaise || t.cgstPaise + t.sgstPaise, amount: t.amountPaise, reason: r.reason ?? '', byName: r.byName ?? '' };
    });
    const gst = key === 'sales-return-gst';
    return {
      ...base,
      columns: gst
        ? [col('date', 'Date', 'date'), col('note', 'Credit note'), col('bill', 'Against bill'), col('name', 'Patient / customer'), col('taxable', 'Taxable', 'money'), col('cgst', 'CGST', 'money'), col('sgst', 'SGST', 'money'), col('amount', 'Total', 'money')]
        : [col('date', 'Date', 'date'), col('note', 'Credit note'), col('bill', 'Against bill'), col('name', 'Patient / customer'), col('ref', 'Number / phone'), col('items', 'Items', 'num'), col('amount', 'Amount', 'money'), col('reason', 'Reason'), col('byName', 'Taken back by')],
      rows,
      total: totalOf(rows, gst ? ['taxable', 'cgst', 'sgst', 'amount'] : ['items', 'amount'], { date: `${rows.length} credit note${rows.length === 1 ? '' : 's'}` }),
    };
  }

  if (key === 'return-lines' || key === 'antitb-returns' || key === 'h1-returns') {
    const keep = { 'return-lines': () => true, 'antitb-returns': isAntiTb, 'h1-returns': (l) => l.schedule === 'H1' }[key];
    const rows = returnedLines
      .filter(({ line }) => keep(line))
      .map(({ inv, r, x, line }) => {
        const who = personOf(inv, patients);
        return { date: day(r.at), note: r.number, bill: inv.number, name: who.name, ref: who.ref, doctor: inv.doctor?.name ?? '', medicine: line.name ?? '', batch: line.batch ?? '', qty: x.qty, amount: x.amountPaise, reason: r.reason ?? '' };
      });
    return {
      ...base,
      columns: [col('date', 'Date', 'date'), col('note', 'Credit note'), col('bill', 'Against bill'), col('name', 'Patient / customer'), col('ref', 'Number / phone'), ...(key === 'return-lines' ? [] : [col('doctor', 'Prescribing doctor')]), col('medicine', 'Medicine'), col('batch', 'Batch'), col('qty', 'Qty', 'num'), col('amount', 'Amount', 'money'), col('reason', 'Reason')],
      rows,
      total: totalOf(rows, ['qty', 'amount'], { date: `${rows.length} line${rows.length === 1 ? '' : 's'}` }),
      note: key === 'antitb-returns' ? 'DRAFT list of anti-TB medicines, matched on the generic name – to be approved by the owner.' : undefined,
    };
  }

  if (key === 'sales-gst') {
    const rows = made.map((inv) => {
      const who = personOf(inv, patients);
      const t = sum(inv.lines);
      const rates = [...new Set(inv.lines.map((l) => l.gstRate))].sort((a, b) => a - b);
      return { date: day(inv.created.at), bill: inv.number, name: who.name, gstin: inv.buyer?.gstin ?? '', rates: rates.map((r) => `${r}%`).join(', '), taxable: t.taxablePaise, cgst: t.cgstPaise, sgst: t.sgstPaise, amount: t.amountPaise };
    });
    return {
      ...base,
      columns: [col('date', 'Date', 'date'), col('bill', 'Bill no.'), col('name', 'Patient / customer'), col('gstin', 'Buyer GSTIN'), col('rates', 'GST rates'), col('taxable', 'Taxable', 'money'), col('cgst', 'CGST', 'money'), col('sgst', 'SGST', 'money'), col('amount', 'Total', 'money')],
      rows,
      total: totalOf(rows, ['taxable', 'cgst', 'sgst', 'amount'], { date: `${rows.length} bill${rows.length === 1 ? '' : 's'}` }),
      note: 'Bills as made, before returns – the returns are in the Sales return GST report.',
    };
  }

  const suppliers = data.suppliers ?? new Map();
  const purchases = [...(data.purchases ?? [])].sort((a, b) => new Date(a.invoiceDate) - new Date(b.invoiceDate) || a.number.localeCompare(b.number));
  const supplierReturns = [...(data.supplierReturns ?? [])].sort((a, b) => new Date(a.created.at) - new Date(b.created.at));
  const purchaseTax = (p) => {
    if (p.grn?.netPaise != null) return { taxable: p.grn.netPaise - (p.grn.gstPaise ?? 0) - (p.grn.roundingPaise ?? 0), cgst: p.grn.cgstPaise ?? 0, sgst: p.grn.sgstPaise ?? 0, igst: p.grn.igstPaise ?? 0, total: p.grn.netPaise, recorded: true };
    return { taxable: p.totalPaise, cgst: 0, sgst: 0, igst: 0, total: p.totalPaise, recorded: false };
  };

  if (key === 'grn-gst') {
    const rows = purchases.map((p) => {
      const s = suppliers.get(String(p.supplierId));
      const t = purchaseTax(p);
      return { date: isoDay(p.invoiceDate), invoiceNo: p.invoiceNo, grn: p.number, supplier: s?.name ?? '', gstin: s?.gstin ?? '', taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total, status: t.recorded ? '' : 'GST not recorded' };
    });
    return {
      ...base,
      columns: [col('date', 'Bill date', 'date'), col('invoiceNo', 'Supplier bill'), col('grn', 'GRN no.'), col('supplier', 'Supplier'), col('gstin', 'Supplier GSTIN'), col('taxable', 'Taxable', 'money'), col('cgst', 'CGST', 'money'), col('sgst', 'SGST', 'money'), col('igst', 'IGST', 'money'), col('total', 'Bill total', 'money'), col('status', 'Note')],
      rows,
      total: totalOf(rows, ['taxable', 'cgst', 'sgst', 'igst', 'total'], { date: `${rows.length} bill${rows.length === 1 ? '' : 's'}` }),
      note: 'Purchase bills by their date; cancelled bills are left out.',
    };
  }

  if (key === 'grn-return-gst') {
    const rows = supplierReturns.map((x) => {
      const s = suppliers.get(String(x.supplierId));
      const t = returnTotals(x);
      return { date: day(x.created.at), note: x.number, supplier: s?.name ?? '', gstin: s?.gstin ?? '', taxable: t.taxablePaise, cgst: t.cgstPaise, sgst: t.sgstPaise, igst: t.igstPaise, total: t.amountPaise, creditNote: x.creditNote?.number ?? '' };
    });
    return {
      ...base,
      columns: [col('date', 'Date', 'date'), col('note', 'Debit note'), col('supplier', 'Supplier'), col('gstin', 'Supplier GSTIN'), col('taxable', 'Taxable', 'money'), col('cgst', 'CGST', 'money'), col('sgst', 'SGST', 'money'), col('igst', 'IGST', 'money'), col('total', 'Total', 'money'), col('creditNote', "Supplier's credit note")],
      rows,
      total: totalOf(rows, ['taxable', 'cgst', 'sgst', 'igst', 'total'], { date: `${rows.length} return${rows.length === 1 ? '' : 's'}` }),
      note: 'Stock sent back to suppliers in the period; cancelled returns are left out.',
    };
  }

  if (key === 'gst-summary') {
    const rates = new Map();
    const at = (rate) => rates.get(rate) ?? rates.set(rate, { rate, salesTaxable: 0, salesGst: 0, returnsTaxable: 0, returnsGst: 0, buyTaxable: 0, buyGst: 0, sentTaxable: 0, sentGst: 0 }).get(rate);
    for (const inv of made) for (const l of inv.lines) {
      const r = at(l.gstRate ?? 0);
      r.salesTaxable += l.taxablePaise;
      r.salesGst += l.cgstPaise + l.sgstPaise;
    }
    for (const { x, line } of returnedLines) {
      const r = at(line.gstRate ?? 0);
      r.returnsTaxable += x.taxablePaise;
      r.returnsGst += x.cgstPaise + x.sgstPaise;
    }
    for (const p of purchases) {
      if (p.grn?.netPaise == null) continue; // GST not recorded on bills from before the GRN form
      for (const l of p.lines) {
        const r = at(l.gstRate ?? 0);
        r.buyTaxable += l.pack?.taxablePaise ?? 0;
        r.buyGst += l.pack?.gstPaise ?? 0;
      }
    }
    for (const x of supplierReturns) for (const l of x.lines) {
      const r = at(l.gstRate ?? 0);
      r.sentTaxable += l.taxablePaise;
      r.sentGst += l.gstPaise;
    }
    const rows = [...rates.values()].sort((a, b) => a.rate - b.rate).map((r) => ({ ...r, rateText: `${r.rate}%`, net: r.salesGst - r.returnsGst - (r.buyGst - r.sentGst) }));
    return {
      ...base,
      columns: [col('rateText', 'GST rate'), col('salesTaxable', 'Sales taxable', 'money'), col('salesGst', 'Sales GST', 'money'), col('returnsTaxable', 'Sales returns taxable', 'money'), col('returnsGst', 'Sales returns GST', 'money'), col('buyTaxable', 'Purchases taxable', 'money'), col('buyGst', 'Purchases GST', 'money'), col('sentTaxable', 'Purchase returns taxable', 'money'), col('sentGst', 'Purchase returns GST', 'money'), col('net', 'GST on sales less GST paid', 'money')],
      rows,
      total: totalOf(rows, ['salesTaxable', 'salesGst', 'returnsTaxable', 'returnsGst', 'buyTaxable', 'buyGst', 'sentTaxable', 'sentGst', 'net'], { rateText: 'All rates' }),
      note: 'For the accountant: a guide for the GST return, not the return itself. Purchase bills entered before GST was recorded are left out.',
    };
  }

  throw new Error(`Unknown report ${key}`);
}
