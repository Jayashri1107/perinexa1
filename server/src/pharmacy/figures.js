// PH15 (docs/PHARMACY_BUILD_NOTE.md): the pharmacy's missing reports, for a period – profit by medicine, slow and
// non-moving stock, the value lost to expiry, days out of stock, prescriptions filled in-house, and the use of H1
// (antibiotic) medicines by month. Every query starts with the hospital (tenantScoped refuses one that does not).
// "Use by ward" waits for stock outside the pharmacy (PH13). Counts and amounts only – no patient list.

import { addDays, hospitalDayStart, isoDay, toHospitalDate, utcDay } from '../careplans/dates.js';
import { Medicine, PharmacyInvoice, StockBatch, StockMove, SupplierReturn } from '../models/Pharmacy.js';
import { Visit } from '../models/Visit.js';
import { isExpired } from './pharmacyService.js';

const DAY = 86_400_000;

/** Profit by medicine: what was charged (taxable value, net of returns) less what it cost (the batch's cost per unit). */
export async function profitByMedicine(tenantId, from, to) {
  const invoices = await PharmacyInvoice.find({ tenantId, 'created.at': { $gte: from, $lt: to } }, { lines: 1, returns: 1 }).lean();
  const oldBatchIds = invoices.flatMap((i) => i.lines.filter((l) => l.costPaise == null).map((l) => l.batchId));
  const costs = new Map((oldBatchIds.length ? await StockBatch.find({ tenantId, _id: { $in: oldBatchIds } }, { costPaise: 1 }).lean() : []).map((b) => [String(b._id), b.costPaise]));
  const by = new Map();
  for (const inv of invoices) {
    const returned = new Map();
    for (const r of inv.returns ?? []) {
      for (const x of r.lines) {
        const cur = returned.get(String(x.lineId)) ?? { qty: 0, taxablePaise: 0 };
        cur.qty += x.qty;
        cur.taxablePaise += x.taxablePaise;
        returned.set(String(x.lineId), cur);
      }
    }
    for (const l of inv.lines) {
      const back = returned.get(String(l._id)) ?? { qty: 0, taxablePaise: 0 };
      const qty = l.qty - back.qty;
      if (qty <= 0) continue;
      const unitCost = l.costPaise ?? costs.get(String(l.batchId)) ?? 0;
      const row = by.get(String(l.medicineId)) ?? { medicineId: String(l.medicineId), name: l.name, qty: 0, salesPaise: 0, costPaise: 0 };
      row.qty += qty;
      row.salesPaise += l.taxablePaise - back.taxablePaise;
      row.costPaise += unitCost * qty;
      by.set(String(l.medicineId), row);
    }
  }
  const rows = [...by.values()].map((r) => ({ ...r, profitPaise: r.salesPaise - r.costPaise, marginPercent: r.salesPaise ? Math.round(((r.salesPaise - r.costPaise) * 1000) / r.salesPaise) / 10 : null })).sort((a, b) => b.profitPaise - a.profitPaise);
  return { rows, salesPaise: rows.reduce((s, r) => s + r.salesPaise, 0), costPaise: rows.reduce((s, r) => s + r.costPaise, 0), profitPaise: rows.reduce((s, r) => s + r.profitPaise, 0) };
}

/** Medicines with usable stock and no sale or issue in the last 90 (slow) or 180 (non-moving) days, at cost. */
export async function nonMoving(tenantId, now) {
  const today = toHospitalDate(now);
  const batches = await StockBatch.find({ tenantId, qtyLeft: { $gt: 0 } }, { medicineId: 1, qtyLeft: 1, costPaise: 1, expiry: 1, hold: 1 }).lean();
  const since = hospitalDayStart(addDays(utcDay(today), -180));
  const last = new Map((await StockMove.aggregate([{ $match: { tenantId, kind: { $in: ['sale', 'issue'] }, at: { $gte: since } } }, { $group: { _id: '$medicineId', at: { $max: '$at' } } }])).map((r) => [String(r._id), r.at]));
  const meds = new Map((await Medicine.find({ tenantId, _id: { $in: [...new Set(batches.map((b) => String(b.medicineId)))] } }, { name: 1 }).lean()).map((m) => [String(m._id), m.name]));
  const by = new Map();
  for (const b of batches) {
    const k = String(b.medicineId);
    const row = by.get(k) ?? { medicineId: k, name: meds.get(k) ?? '', qty: 0, valuePaise: 0, heldOrExpiredPaise: 0 };
    if (isExpired(b, today) || b.hold) row.heldOrExpiredPaise += b.qtyLeft * b.costPaise;
    else {
      row.qty += b.qtyLeft;
      row.valuePaise += b.qtyLeft * b.costPaise;
    }
    by.set(k, row);
  }
  const rows = [];
  for (const r of by.values()) {
    if (!r.qty) continue;
    const at = last.get(r.medicineId);
    const days = at ? Math.floor((now - at) / DAY) : null;
    if (days != null && days < 90) continue;
    rows.push({ ...r, lastSold: at ? isoDay(toHospitalDate(at)) : null, band: days == null || days >= 180 ? 'non_moving' : 'slow' });
  }
  rows.sort((a, b) => b.valuePaise - a.valuePaise);
  return { rows, valuePaise: rows.reduce((s, r) => s + r.valuePaise, 0) };
}

const expiredWords = /expir/i;
/** The value lost to expiry: expired stock written off (kind 'expired', or older write-offs saying so) and stock returned to suppliers as expired, at cost. */
export async function expiryLoss(tenantId, from, to) {
  const moves = await StockMove.find({ tenantId, kind: 'writeoff', at: { $gte: from, $lt: to } }, { batchId: 1, qty: 1, reason: 1, writeoffKind: 1 }).lean();
  const expiredMoves = moves.filter((m) => m.writeoffKind === 'expired' || (!m.writeoffKind && expiredWords.test(m.reason ?? '')));
  const costs = new Map((expiredMoves.length ? await StockBatch.find({ tenantId, _id: { $in: expiredMoves.map((m) => m.batchId) } }, { costPaise: 1 }).lean() : []).map((b) => [String(b._id), b.costPaise]));
  const writtenOffPaise = expiredMoves.reduce((s, m) => s + -m.qty * (costs.get(String(m.batchId)) ?? 0), 0);
  const returns = await SupplierReturn.find({ tenantId, reason: 'expired', status: { $ne: 'cancelled' }, 'created.at': { $gte: from, $lt: to } }, { lines: 1 }).lean();
  const returnedPaise = returns.reduce((s, r) => s + r.lines.reduce((t, l) => t + l.taxablePaise, 0), 0);
  return { writtenOffPaise, returnedToSupplierPaise: returnedPaise, writeOffs: expiredMoves.length, returns: returns.length };
}

/** Days out of stock in the period, per medicine in use: from each medicine's balance after every move ("about" – expired stock still counts in the balance). */
export async function daysOutOfStock(tenantId, from, to) {
  const meds = await Medicine.find({ tenantId, active: true }, { name: 1 }).lean();
  const before = await StockMove.aggregate([{ $match: { tenantId, at: { $lt: from } } }, { $sort: { at: -1, _id: -1 } }, { $group: { _id: '$medicineId', balance: { $first: '$balanceAfter' } } }]);
  const start = new Map(before.map((r) => [String(r._id), r.balance]));
  const moves = await StockMove.find({ tenantId, at: { $gte: from, $lt: to } }, { medicineId: 1, at: 1, balanceAfter: 1 }).sort({ at: 1, _id: 1 }).lean();
  const byMed = new Map();
  for (const m of moves) {
    const k = String(m.medicineId);
    if (!byMed.has(k)) byMed.set(k, []);
    byMed.get(k).push(m);
  }
  const rows = [];
  for (const med of meds) {
    const k = String(med._id);
    let balance = start.get(k) ?? 0;
    let since = from;
    let outMs = 0;
    for (const m of byMed.get(k) ?? []) {
      if (balance <= 0) outMs += m.at - since;
      balance = m.balanceAfter;
      since = m.at;
    }
    if (balance <= 0) outMs += to - since;
    const days = Math.round(outMs / DAY);
    if (days > 0 && (start.has(k) || byMed.has(k))) rows.push({ medicineId: k, name: med.name, days });
  }
  rows.sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
  return { rows, periodDays: Math.round((to - from) / DAY) };
}

/** Prescriptions written in the period and how many were sold from (at least in part) in-house – counts only. */
export async function prescriptionsFilled(tenantId, from, to) {
  const visits = await Visit.find({ tenantId, status: 'active', 'prescription.items.0': { $exists: true }, visitOn: { $gte: utcDay(toHospitalDate(from)), $lt: utcDay(toHospitalDate(to)) } }, { _id: 1 }).lean();
  if (!visits.length) return { written: 0, filled: 0, percent: null };
  const filled = await PharmacyInvoice.distinct('visitId', { tenantId, visitId: { $in: visits.map((v) => v._id) } });
  return { written: visits.length, filled: filled.length, percent: Math.round((filled.length * 100) / visits.length) };
}

/** Units of each H1 medicine sold or issued (net of returns) by month. */
export async function h1Use(tenantId, from, to) {
  const meds = await Medicine.find({ tenantId, schedule: 'H1' }, { name: 1 }).lean();
  if (!meds.length) return { months: [], rows: [] };
  const moves = await StockMove.find({ tenantId, medicineId: { $in: meds.map((m) => m._id) }, kind: { $in: ['sale', 'issue', 'return'] }, at: { $gte: from, $lt: to } }, { medicineId: 1, qty: 1, at: 1 }).lean();
  const names = new Map(meds.map((m) => [String(m._id), m.name]));
  const months = new Set();
  const by = new Map();
  for (const m of moves) {
    const month = isoDay(toHospitalDate(m.at)).slice(0, 7);
    months.add(month);
    const k = String(m.medicineId);
    const row = by.get(k) ?? { medicineId: k, name: names.get(k), byMonth: {} };
    row.byMonth[month] = (row.byMonth[month] ?? 0) - m.qty;
    by.set(k, row);
  }
  return { months: [...months].sort(), rows: [...by.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

