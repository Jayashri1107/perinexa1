// Inventory MIS (13 Nov 2026, the developer, after the pharmacy's earlier software): purchase reports (indents – the
// wards' requests –, GRN, GRN returns, purchase orders, item-wise and supplier-wise GRN) and stock reports (current
// stock, stock date-wise, non-moving items). Each answers { key, title, columns, rows, total, summary, patients, note }
// like the pharmacy MIS (pharmacy/misReports.js), filtered by the form of the earlier software: supplier, item, batch,
// expiry up to a month, detail or summary, and the days for non-moving.
// Every query carries the hospital's tenantId. Indents show the patient's name to the pharmacist only (the hospital
// admin sees the ward and bed).

import { hospitalDayStart, addDays, isoDay, toHospitalDate, utcDay } from '../careplans/dates.js';
import { Admission } from '../models/Admission.js';
import { Patient } from '../models/Patient.js';
import { Medicine, Purchase, PurchaseOrder, StockBatch, StockLocation, StockMove, Supplier, SupplierReturn } from '../models/Pharmacy.js';
import { WardRequest } from '../models/WardRequest.js';
import { isExpired } from './pharmacyService.js';
import { NOT_CANCELLED, returnTotals } from './supplierReturnsService.js';

// [key, title, the filters its form uses]
export const INVENTORY_GROUPS = [
  {
    title: 'Purchase MIS',
    reports: [
      ['indent', 'Indent report', ['item', 'detail']],
      ['indent-datewise', 'Indent date-wise', []],
      ['grn', 'GRN report', ['supplier', 'item', 'batch', 'detail']],
      ['grn-return', 'GRN return report', ['supplier', 'item', 'batch', 'detail']],
      ['purchase-order', 'Purchase order', ['supplier', 'item', 'detail']],
      ['item-grn', 'Item-wise GRN list', ['supplier', 'item']],
      ['supplier-grn', 'Supplier-wise GRN list', ['supplier']],
    ],
  },
  {
    title: 'Stock MIS',
    reports: [
      ['current-stock', 'Current stock report', ['supplier', 'item', 'batch', 'expiry', 'detail']],
      ['stock-datewise', 'Current stock date-wise', ['item']],
      ['non-moving', 'Non-moving item list', ['item', 'days']],
    ],
  },
];
export const INVENTORY_KEYS = INVENTORY_GROUPS.flatMap((g) => g.reports.map(([k]) => k));
const TITLES = Object.fromEntries(INVENTORY_GROUPS.flatMap((g) => g.reports.map(([k, t]) => [k, t])));

const col = (k, label, type = 'text') => ({ k, label, type });
const totalOf = (rows, keys, first) => ({ ...first, ...Object.fromEntries(keys.map((k) => [k, rows.reduce((s, r) => s + (r[k] ?? 0), 0)])) });
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const day = (at) => isoDay(toHospitalDate(at));
const STATUS_WORDS = { draft: 'Draft', sent: 'Sent', part_received: 'Part received', received: 'Received', cancelled: 'Cancelled', requested: 'Asked', part_issued: 'Part issued', issued: 'Issued', refused: 'Refused', active: 'Active' };
const batchMatch = (text) => (b) => !text || String(b ?? '').toLowerCase().includes(text.toLowerCase());

/**
 * One inventory report. q: { report, from, to (dates), supplierId, medicineId, batch, expiryBy ('YYYY-MM'), detail,
 * days }. seesPatients: the pharmacist (names on indents).
 */
export async function inventoryReport(tenantId, q, { now = new Date(), seesPatients = false } = {}) {
  const key = q.report;
  const from = hospitalDayStart(q.from);
  const to = hospitalDayStart(addDays(q.to, 1));
  const base = { key, title: TITLES[key], patients: false, summary: [], total: null, detail: Boolean(q.detail) };
  const sameMed = (id) => !q.medicineId || String(id) === String(q.medicineId);
  const sameSup = (id) => !q.supplierId || String(id) === String(q.supplierId);
  const batchOk = batchMatch(q.batch);
  const supplierNames = async () => new Map((await Supplier.find({ tenantId }, { name: 1, gstin: 1 }).lean()).map((s) => [String(s._id), s]));

  if (key === 'indent' || key === 'indent-datewise') {
    const list = await WardRequest.find({ tenantId, 'requested.at': { $gte: from, $lt: to } }).sort({ 'requested.at': 1 }).lean();
    if (key === 'indent-datewise') {
      const by = new Map();
      for (const r of list) {
        const d = day(r.requested.at);
        const x = by.get(d) ?? { date: d, requests: 0, urgent: 0, lines: 0, asked: 0, issued: 0, refused: 0, cancelled: 0 };
        x.requests += 1;
        x.urgent += r.urgent ? 1 : 0;
        x.lines += r.lines.length;
        x.asked += r.lines.reduce((s, l) => s + l.qty, 0);
        x.issued += r.lines.reduce((s, l) => s + (l.issuedQty ?? 0), 0);
        x.refused += r.status === 'refused' ? 1 : 0;
        x.cancelled += r.status === 'cancelled' ? 1 : 0;
        by.set(d, x);
      }
      const rows = [...by.values()];
      return {
        ...base,
        columns: [col('date', 'Date', 'date'), col('requests', 'Indents', 'num'), col('urgent', 'Urgent', 'num'), col('lines', 'Items', 'num'), col('asked', 'Qty asked', 'num'), col('issued', 'Qty issued', 'num'), col('refused', 'Refused', 'num'), col('cancelled', 'Cancelled', 'num')],
        rows,
        total: totalOf(rows, ['requests', 'urgent', 'lines', 'asked', 'issued', 'refused', 'cancelled'], { date: count(rows.length, 'day') }),
        note: 'Indents are the medicines the wards ask the pharmacy for (Ward requests).',
      };
    }
    const stays = new Map((await Admission.find({ tenantId, _id: { $in: list.map((r) => r.admissionId) } }, { ward: 1, bed: 1 }).lean()).map((a) => [String(a._id), a]));
    const patients = seesPatients ? new Map((await Patient.find({ tenantId, _id: { $in: list.map((r) => r.patientId) } }, { fullName: 1, mrn: 1 }).lean()).map((p) => [String(p._id), p])) : new Map();
    const head = (r) => {
      const a = stays.get(String(r.admissionId));
      const p = patients.get(String(r.patientId));
      return { date: day(r.requested.at), number: r.number, ward: [a?.ward, a?.bed && `bed ${a.bed}`].filter(Boolean).join(', '), patient: p ? `${p.fullName} (${p.mrn})` : '', by: r.orderedBy?.name ?? '', status: STATUS_WORDS[r.status] ?? r.status, urgent: r.urgent ? 'Urgent' : '' };
    };
    const patientCol = seesPatients ? [col('patient', 'Patient')] : [];
    if (q.detail) {
      const rows = list.flatMap((r) => r.lines.filter((l) => sameMed(l.medicineId)).map((l) => ({ ...head(r), medicine: l.name ?? '', asked: l.qty, issued: l.issuedQty ?? 0, pending: l.refused ? 0 : Math.max(0, l.qty - (l.issuedQty ?? 0)), line: l.refused ? 'Refused' : '' })));
      return {
        ...base,
        patients: seesPatients,
        columns: [col('date', 'Date', 'date'), col('number', 'Indent no.'), col('ward', 'Ward / bed'), ...patientCol, col('by', 'Asked by'), col('medicine', 'Item'), col('asked', 'Asked', 'num'), col('issued', 'Issued', 'num'), col('pending', 'Pending', 'num'), col('line', 'Note')],
        rows,
        total: totalOf(rows, ['asked', 'issued', 'pending'], { date: count(rows.length, 'line') }),
      };
    }
    const rows = list
      .filter((r) => !q.medicineId || r.lines.some((l) => sameMed(l.medicineId)))
      .map((r) => ({ ...head(r), items: r.lines.length, asked: r.lines.reduce((s, l) => s + l.qty, 0), issued: r.lines.reduce((s, l) => s + (l.issuedQty ?? 0), 0) }));
    return {
      ...base,
      patients: seesPatients,
      columns: [col('date', 'Date', 'date'), col('number', 'Indent no.'), col('ward', 'Ward / bed'), ...patientCol, col('by', 'Asked by'), col('urgent', 'Urgent'), col('items', 'Items', 'num'), col('asked', 'Qty asked', 'num'), col('issued', 'Qty issued', 'num'), col('status', 'Status')],
      rows,
      total: totalOf(rows, ['items', 'asked', 'issued'], { date: count(rows.length, 'indent') }),
    };
  }

  if (key === 'grn' || key === 'item-grn' || key === 'supplier-grn') {
    const list = (await Purchase.find({ tenantId, status: 'active', invoiceDate: { $gte: q.from, $lte: q.to } }).sort({ invoiceDate: 1, number: 1 }).lean()).filter((p) => sameSup(p.supplierId));
    const sups = await supplierNames();
    const lineValue = (l) => l.pack?.taxablePaise ?? Math.round(l.qty * l.ratePaise);
    const lineGst = (l) => l.pack?.gstPaise ?? 0;
    const lines = list.flatMap((p) => p.lines.filter((l) => sameMed(l.medicineId) && batchOk(l.batch)).map((l) => ({ p, l })));
    if (key === 'item-grn') {
      const by = new Map();
      for (const { p, l } of lines) {
        const k = String(l.medicineId);
        const x = by.get(k) ?? { medicine: l.name, bills: new Set(), qty: 0, free: 0, value: 0, gst: 0, lastDate: '', lastRate: 0, lastSupplier: '' };
        x.bills.add(String(p._id));
        x.qty += l.qty;
        x.free += l.freeQty ?? 0;
        x.value += lineValue(l);
        x.gst += lineGst(l);
        const d = isoDay(p.invoiceDate);
        if (d >= x.lastDate) Object.assign(x, { lastDate: d, lastRate: l.ratePaise, lastSupplier: sups.get(String(p.supplierId))?.name ?? '' });
        by.set(k, x);
      }
      const rows = [...by.values()].map(({ bills, ...x }) => ({ ...x, bills: bills.size, avgRate: x.qty ? Math.round(x.value / x.qty) : 0 })).sort((a, b) => a.medicine.localeCompare(b.medicine));
      return {
        ...base,
        columns: [col('medicine', 'Item'), col('bills', 'GRNs', 'num'), col('qty', 'Qty (units)', 'num'), col('free', 'Free', 'num'), col('value', 'Value before GST', 'money'), col('gst', 'GST', 'money'), col('avgRate', 'Average rate / unit', 'money'), col('lastRate', 'Last rate / unit', 'money'), col('lastDate', 'Last bought', 'date'), col('lastSupplier', 'Last supplier')],
        rows,
        total: totalOf(rows, ['qty', 'free', 'value', 'gst'], { medicine: count(rows.length, 'item') }),
      };
    }
    const billRow = (p) => {
      const s = sups.get(String(p.supplierId));
      const net = p.grn?.netPaise ?? p.totalPaise;
      const gst = p.grn?.gstPaise ?? 0;
      return { date: isoDay(p.invoiceDate), invoiceNo: p.invoiceNo, grn: p.number, supplier: s?.name ?? '', items: p.lines.length, qty: p.lines.reduce((t, l) => t + l.qty, 0), free: p.lines.reduce((t, l) => t + (l.freeQty ?? 0), 0), taxable: net - gst - (p.grn?.roundingPaise ?? 0), gst, net, payment: p.grn?.payment === 'cash' ? 'Cash' : p.grn ? 'Credit' : '', by: p.created?.byName ?? '' };
    };
    if (key === 'supplier-grn') {
      const by = new Map();
      for (const p of list) {
        const r = billRow(p);
        const x = by.get(String(p.supplierId)) ?? { supplier: r.supplier, gstin: sups.get(String(p.supplierId))?.gstin ?? '', bills: 0, items: 0, taxable: 0, gst: 0, net: 0, credit: 0, cash: 0 };
        x.bills += 1;
        x.items += r.items;
        x.taxable += r.taxable;
        x.gst += r.gst;
        x.net += r.net;
        x[r.payment === 'Cash' ? 'cash' : 'credit'] += r.net;
        by.set(String(p.supplierId), x);
      }
      const rows = [...by.values()].sort((a, b) => b.net - a.net || a.supplier.localeCompare(b.supplier));
      return {
        ...base,
        columns: [col('supplier', 'Supplier'), col('gstin', 'GSTIN'), col('bills', 'GRNs', 'num'), col('items', 'Items', 'num'), col('taxable', 'Taxable', 'money'), col('gst', 'GST', 'money'), col('net', 'Net', 'money'), col('credit', 'On credit', 'money'), col('cash', 'Paid cash', 'money')],
        rows,
        total: totalOf(rows, ['bills', 'items', 'taxable', 'gst', 'net', 'credit', 'cash'], { supplier: count(rows.length, 'supplier') }),
      };
    }
    if (q.detail) {
      const rows = lines.map(({ p, l }) => ({ date: isoDay(p.invoiceDate), grn: p.number, invoiceNo: p.invoiceNo, supplier: sups.get(String(p.supplierId))?.name ?? '', medicine: l.name, batch: l.batch, expiry: isoDay(l.expiry).slice(0, 7), qty: l.qty, free: l.freeQty ?? 0, rate: l.ratePaise, mrp: l.mrpPaise, gstRate: l.gstRate == null ? '' : `${l.gstRate}%`, value: lineValue(l), gst: lineGst(l) }));
      return {
        ...base,
        columns: [col('date', 'Bill date', 'date'), col('grn', 'GRN no.'), col('invoiceNo', 'Supplier bill'), col('supplier', 'Supplier'), col('medicine', 'Item'), col('batch', 'Batch'), col('expiry', 'Expiry'), col('qty', 'Qty', 'num'), col('free', 'Free', 'num'), col('rate', 'Rate / unit', 'money'), col('mrp', 'MRP / unit', 'money'), col('gstRate', 'GST'), col('value', 'Value', 'money'), col('gst', 'GST amt', 'money')],
        rows,
        total: totalOf(rows, ['qty', 'free', 'value', 'gst'], { date: count(rows.length, 'line') }),
        note: 'Quantities in units of sale (tablets, bottles …).',
      };
    }
    const rows = list.filter((p) => (!q.medicineId && !q.batch) || p.lines.some((l) => sameMed(l.medicineId) && batchOk(l.batch))).map(billRow);
    return {
      ...base,
      columns: [col('date', 'Bill date', 'date'), col('grn', 'GRN no.'), col('invoiceNo', 'Supplier bill'), col('supplier', 'Supplier'), col('items', 'Items', 'num'), col('qty', 'Qty', 'num'), col('free', 'Free', 'num'), col('taxable', 'Taxable', 'money'), col('gst', 'GST', 'money'), col('net', 'Net', 'money'), col('payment', 'Payment'), col('by', 'Entered by')],
      rows,
      total: totalOf(rows, ['items', 'qty', 'free', 'taxable', 'gst', 'net'], { date: count(rows.length, 'GRN') }),
    };
  }

  if (key === 'grn-return') {
    const list = (await SupplierReturn.find({ tenantId, ...NOT_CANCELLED, 'created.at': { $gte: from, $lt: to } }).sort({ 'created.at': 1 }).lean()).filter((x) => sameSup(x.supplierId));
    const sups = await supplierNames();
    if (q.detail) {
      const rows = list.flatMap((x) => x.lines.filter((l) => sameMed(l.medicineId) && batchOk(l.batch)).map((l) => ({ date: day(x.created.at), number: x.number, supplier: sups.get(String(x.supplierId))?.name ?? '', medicine: l.name, batch: l.batch, expiry: isoDay(l.expiry).slice(0, 7), qty: l.qty, rate: l.ratePaise, taxable: l.taxablePaise, gst: l.gstPaise, amount: l.amountPaise, bill: l.invoiceNo ?? '' })));
      return {
        ...base,
        columns: [col('date', 'Date', 'date'), col('number', 'Debit note'), col('supplier', 'Supplier'), col('medicine', 'Item'), col('batch', 'Batch'), col('expiry', 'Expiry'), col('qty', 'Qty', 'num'), col('rate', 'Rate / unit', 'money'), col('taxable', 'Taxable', 'money'), col('gst', 'GST', 'money'), col('amount', 'Amount', 'money'), col('bill', 'Bought on bill')],
        rows,
        total: totalOf(rows, ['qty', 'taxable', 'gst', 'amount'], { date: count(rows.length, 'line') }),
      };
    }
    const rows = list
      .filter((x) => (!q.medicineId && !q.batch) || x.lines.some((l) => sameMed(l.medicineId) && batchOk(l.batch)))
      .map((x) => {
        const t = returnTotals(x);
        return { date: day(x.created.at), number: x.number, supplier: sups.get(String(x.supplierId))?.name ?? '', reason: x.reason ?? '', items: x.lines.length, qty: t.qty, taxable: t.taxablePaise, gst: t.gstPaise, amount: t.amountPaise, creditNote: x.creditNote?.number ?? '' };
      });
    return {
      ...base,
      columns: [col('date', 'Date', 'date'), col('number', 'Debit note'), col('supplier', 'Supplier'), col('reason', 'Reason'), col('items', 'Items', 'num'), col('qty', 'Qty', 'num'), col('taxable', 'Taxable', 'money'), col('gst', 'GST', 'money'), col('amount', 'Amount', 'money'), col('creditNote', "Supplier's credit note")],
      rows,
      total: totalOf(rows, ['items', 'qty', 'taxable', 'gst', 'amount'], { date: count(rows.length, 'return') }),
    };
  }

  if (key === 'purchase-order') {
    const list = (await PurchaseOrder.find({ tenantId, 'created.at': { $gte: from, $lt: to } }).sort({ 'created.at': 1 }).lean()).filter((o) => sameSup(o.supplierId));
    const sups = await supplierNames();
    const head = (o) => ({ date: day(o.created.at), number: o.number, supplier: sups.get(String(o.supplierId))?.name ?? '', status: STATUS_WORDS[o.status] ?? o.status });
    if (q.detail) {
      const rows = list.flatMap((o) => o.lines.filter((l) => sameMed(l.medicineId)).map((l) => ({ ...head(o), medicine: l.name, ordered: l.qty, received: l.receivedQty ?? 0, pending: o.status === 'cancelled' || o.status === 'received' ? 0 : Math.max(0, l.qty - (l.receivedQty ?? 0)) })));
      return {
        ...base,
        columns: [col('date', 'Date', 'date'), col('number', 'Order no.'), col('supplier', 'Supplier'), col('medicine', 'Item'), col('ordered', 'Ordered', 'num'), col('received', 'Received', 'num'), col('pending', 'Pending', 'num'), col('status', 'Status')],
        rows,
        total: totalOf(rows, ['ordered', 'received', 'pending'], { date: count(rows.length, 'line') }),
      };
    }
    const rows = list
      .filter((o) => !q.medicineId || o.lines.some((l) => sameMed(l.medicineId)))
      .map((o) => ({ ...head(o), items: o.lines.length, ordered: o.lines.reduce((s, l) => s + l.qty, 0), received: o.lines.reduce((s, l) => s + (l.receivedQty ?? 0), 0), sent: o.sent?.at ? day(o.sent.at) : '' }));
    return {
      ...base,
      columns: [col('date', 'Date', 'date'), col('number', 'Order no.'), col('supplier', 'Supplier'), col('sent', 'Sent on', 'date'), col('items', 'Items', 'num'), col('ordered', 'Qty ordered', 'num'), col('received', 'Qty received', 'num'), col('status', 'Status')],
      rows,
      total: totalOf(rows, ['items', 'ordered', 'received'], { date: count(rows.length, 'order') }),
    };
  }

  const today = toHospitalDate(now);

  if (key === 'current-stock') {
    const filter = { tenantId, qtyLeft: { $gt: 0 }, ...(q.medicineId ? { medicineId: q.medicineId } : {}), ...(q.supplierId ? { supplierId: q.supplierId } : {}) };
    if (q.expiryBy) {
      const [y, m] = q.expiryBy.split('-').map(Number);
      filter.expiry = { $lte: new Date(Date.UTC(y, m, 0)) }; // the month's last day: expiring by the end of it
    }
    const batches = (await StockBatch.find(filter).sort({ expiry: 1 }).lean()).filter((b) => batchOk(b.batch));
    const meds = new Map((await Medicine.find({ tenantId, _id: { $in: [...new Set(batches.map((b) => String(b.medicineId)))] } }, { name: 1, generic: 1, unit: 1, schedule: 1 }).lean()).map((m) => [String(m._id), m]));
    const places = new Map((await StockLocation.find({ tenantId }, { name: 1 }).lean()).map((p) => [String(p._id), p.name]));
    const state = (b) => (isExpired(b, today) ? 'Expired' : b.hold ? 'On hold' : '');
    if (q.detail) {
      const rows = batches
        .map((b) => {
          const m = meds.get(String(b.medicineId));
          return { medicine: m?.name ?? '', batch: b.batch, expiry: isoDay(b.expiry).slice(0, 7), place: b.locationId ? (places.get(String(b.locationId)) ?? 'A place') : 'Pharmacy', qty: b.qtyLeft, unit: m?.unit ?? '', cost: b.costPaise, mrp: b.mrpPaise, costValue: b.qtyLeft * b.costPaise, mrpValue: b.qtyLeft * b.mrpPaise, state: state(b) };
        })
        .sort((a, b) => a.medicine.localeCompare(b.medicine) || a.expiry.localeCompare(b.expiry));
      return {
        ...base,
        columns: [col('medicine', 'Item'), col('batch', 'Batch'), col('expiry', 'Expiry'), col('place', 'Store'), col('qty', 'Qty', 'num'), col('unit', 'Unit'), col('cost', 'Cost / unit', 'money'), col('mrp', 'MRP / unit', 'money'), col('costValue', 'Value at cost', 'money'), col('mrpValue', 'Value at MRP', 'money'), col('state', 'Note')],
        rows,
        total: totalOf(rows, ['qty', 'costValue', 'mrpValue'], { medicine: count(rows.length, 'batch', 'batches') }),
        note: 'Stock as it is now, batch by batch. Expired and held batches cannot be sold.',
      };
    }
    const by = new Map();
    for (const b of batches) {
      const k = String(b.medicineId);
      const m = meds.get(k);
      const x = by.get(k) ?? { medicine: m?.name ?? '', generic: m?.generic ?? '', unit: m?.unit ?? '', batches: 0, qty: 0, usable: 0, nearest: '', costValue: 0, mrpValue: 0 };
      x.batches += 1;
      x.qty += b.qtyLeft;
      if (!state(b)) x.usable += b.qtyLeft;
      const e = isoDay(b.expiry).slice(0, 7);
      if (!x.nearest || e < x.nearest) x.nearest = e;
      x.costValue += b.qtyLeft * b.costPaise;
      x.mrpValue += b.qtyLeft * b.mrpPaise;
      by.set(k, x);
    }
    const rows = [...by.values()].sort((a, b) => a.medicine.localeCompare(b.medicine));
    return {
      ...base,
      columns: [col('medicine', 'Item'), col('generic', 'Generic'), col('unit', 'Unit'), col('batches', 'Batches', 'num'), col('qty', 'Qty', 'num'), col('usable', 'Usable', 'num'), col('nearest', 'Nearest expiry'), col('costValue', 'Value at cost', 'money'), col('mrpValue', 'Value at MRP', 'money')],
      rows,
      total: totalOf(rows, ['batches', 'qty', 'usable', 'costValue', 'mrpValue'], { medicine: count(rows.length, 'item') }),
      note: 'Stock as it is now. Usable: not expired and not on hold.',
    };
  }

  if (key === 'stock-datewise') {
    // Per medicine: the balance before the period, what came in and went out in it, and the balance at its end
    // (StockMove.balanceAfter is the medicine's balance over all its batches)
    const meds = await Medicine.find({ tenantId, ...(q.medicineId ? { _id: q.medicineId } : {}) }, { name: 1, unit: 1 }).sort({ name: 1 }).lean();
    const ids = meds.map((m) => m._id);
    const lastBefore = async (at) =>
      new Map(
        (
          await StockMove.aggregate([
            { $match: { tenantId, medicineId: { $in: ids }, at: { $lt: at } } },
            { $sort: { at: 1, _id: 1 } },
            { $group: { _id: '$medicineId', balance: { $last: '$balanceAfter' } } },
          ])
        ).map((r) => [String(r._id), r.balance]),
      );
    const [opening, closing] = [await lastBefore(from), await lastBefore(to)];
    const moved = new Map(
      (
        await StockMove.aggregate([
          { $match: { tenantId, medicineId: { $in: ids }, at: { $gte: from, $lt: to } } },
          { $group: { _id: '$medicineId', in: { $sum: { $cond: [{ $gt: ['$qty', 0] }, '$qty', 0] } }, out: { $sum: { $cond: [{ $lt: ['$qty', 0] }, '$qty', 0] } } } },
        ])
      ).map((r) => [String(r._id), r]),
    );
    const rows = meds
      .map((m) => {
        const k = String(m._id);
        const mv = moved.get(k);
        return { medicine: m.name, unit: m.unit ?? '', opening: opening.get(k) ?? 0, in: mv?.in ?? 0, out: -(mv?.out ?? 0), closing: closing.get(k) ?? 0 };
      })
      .filter((r) => r.opening || r.in || r.out || r.closing);
    return {
      ...base,
      columns: [col('medicine', 'Item'), col('unit', 'Unit'), col('opening', 'Opening', 'num'), col('in', 'In', 'num'), col('out', 'Out', 'num'), col('closing', 'Closing', 'num')],
      rows,
      total: totalOf(rows, ['opening', 'in', 'out', 'closing'], { medicine: count(rows.length, 'item') }),
      note: 'Units of sale. In: purchases, returns from patients, counts up; out: sales, issues, write-offs, returns to suppliers. Moves between the pharmacy and a ward store count both ways.',
    };
  }

  if (key === 'non-moving') {
    const days = q.days ?? 90;
    const since = hospitalDayStart(addDays(utcDay(today), -days));
    const batches = await StockBatch.find({ tenantId, qtyLeft: { $gt: 0 }, ...(q.medicineId ? { medicineId: q.medicineId } : {}) }).lean();
    const usable = batches.filter((b) => !isExpired(b, today) && !b.hold);
    const ids = [...new Set(usable.map((b) => String(b.medicineId)))];
    const meds = new Map((await Medicine.find({ tenantId, _id: { $in: ids } }, { name: 1, unit: 1 }).lean()).map((m) => [String(m._id), m]));
    const last = new Map(
      (await StockMove.aggregate([{ $match: { tenantId, medicineId: { $in: usable.map((b) => b.medicineId) }, kind: { $in: ['sale', 'issue'] } } }, { $group: { _id: '$medicineId', at: { $max: '$at' } } }])).map((r) => [String(r._id), r.at]),
    );
    const by = new Map();
    for (const b of usable) {
      const k = String(b.medicineId);
      const x = by.get(k) ?? { medicine: meds.get(k)?.name ?? '', unit: meds.get(k)?.unit ?? '', qty: 0, value: 0, nearest: '' };
      x.qty += b.qtyLeft;
      x.value += b.qtyLeft * b.costPaise;
      const e = isoDay(b.expiry).slice(0, 7);
      if (!x.nearest || e < x.nearest) x.nearest = e;
      by.set(k, x);
    }
    const rows = [...by.entries()]
      .filter(([k]) => !last.get(k) || last.get(k) < since)
      .map(([k, x]) => {
        const at = last.get(k);
        return { ...x, lastSold: at ? day(at) : '', idle: at ? `${Math.round((utcDay(today) - utcDay(toHospitalDate(at))) / 86400000)} days` : 'Never sold' };
      })
      .sort((a, b) => b.value - a.value || a.medicine.localeCompare(b.medicine));
    return {
      ...base,
      columns: [col('medicine', 'Item'), col('unit', 'Unit'), col('qty', 'Usable qty', 'num'), col('value', 'Value at cost', 'money'), col('nearest', 'Nearest expiry'), col('lastSold', 'Last sold or issued', 'date'), col('idle', 'Not moved for')],
      rows,
      total: totalOf(rows, ['qty', 'value'], { medicine: count(rows.length, 'item') }),
      note: `Usable stock with no sale or issue in the last ${days} days.`,
    };
  }

  throw new Error(`Unknown report ${key}`);
}
