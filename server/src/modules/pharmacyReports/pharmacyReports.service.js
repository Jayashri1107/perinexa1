// Pharmacy reports: alerts (low stock, expiry), the registers, stock value, sales by day and the GST summary.
import { config } from '../../config/index.js';
import { lookupOne, withId } from '../../core/aggregate.js';
import { dayOf, dayRange } from '../../core/dates.js';
import { round2 } from '../../core/money.js';
import { paginate, toSort } from '../../core/pagination.js';
import { toObjectId } from '../../core/validate.js';
import { Medicine } from '../medicines/medicine.model.js';
import { Sale } from '../sales/sale.model.js';
import { StockBatch, StockMovement } from '../stock/stock.model.js';

const DAY = 86400000;

// Batches running out of date within config.pharmacy.expiryAlertDays, and those already expired with stock left.
export async function expiryReport(hospitalId) {
  const hid = toObjectId(hospitalId);
  const now = new Date();
  const soon = new Date(now.getTime() + config.pharmacy.expiryAlertDays * DAY);
  const rows = await StockBatch.aggregate([
    { $match: { hospitalId: hid, qty: { $gt: 0 }, expiry: { $lte: soon } } },
    { $sort: { expiry: 1 } },
    ...lookupOne({ from: Medicine.collection.name, localField: 'medicineId', as: 'medicine', fields: ['name', 'strength', 'schedule'] }),
    { $project: { batch: 1, expiry: 1, qty: 1, mrp: 1, purchasePrice: 1, medicine: 1, expired: { $lte: ['$expiry', now] } } },
    ...withId(),
  ]);
  const withDays = rows.map((r) => ({ ...r, daysLeft: Math.ceil((new Date(r.expiry) - now) / DAY) }));
  return {
    alertDays: config.pharmacy.expiryAlertDays,
    expired: withDays.filter((r) => r.expired),
    expiringSoon: withDays.filter((r) => !r.expired),
  };
}

export async function stockValue(hospitalId) {
  const [row] = await StockBatch.aggregate([
    { $match: { hospitalId: toObjectId(hospitalId), qty: { $gt: 0 } } },
    {
      $group: {
        _id: null,
        atCost: { $sum: { $multiply: ['$qty', '$purchasePrice'] } },
        atMrp: { $sum: { $multiply: ['$qty', '$mrp'] } },
        units: { $sum: '$qty' },
        batches: { $sum: 1 },
      },
    },
  ]);
  return { atCost: round2(row?.atCost ?? 0), atMrp: round2(row?.atMrp ?? 0), units: row?.units ?? 0, batches: row?.batches ?? 0 };
}

// The H1, Schedule X or narcotic register for a period: every movement of those medicines.
export async function register(hospitalId, q) {
  const [start] = dayRange(q.from);
  const [, end] = dayRange(q.to);
  return paginate(StockMovement, {
    match: { hospitalId: toObjectId(hospitalId), schedule: q.schedule, createdAt: { $gte: start, $lt: end } },
    sort: toSort(q.sort),
    page: q.page,
    limit: q.limit,
    pageStages: withId(),
  });
}

// Sales per day of a period (net of returns), and the GST by rate.
export async function salesReport(hospitalId, { from, to }) {
  const hid = toObjectId(hospitalId);
  const [start] = dayRange(from);
  const [, end] = dayRange(to);
  const [[result]] = await Promise.all([
    Sale.aggregate([
      { $match: { hospitalId: hid, createdAt: { $gte: start, $lt: end } } },
      {
        $facet: {
          byDay: [
            {
              $group: {
                _id: dayOf('$createdAt'),
                sales: { $sum: 1 },
                total: { $sum: '$total' },
                returned: { $sum: '$returnedAmount' },
                gst: { $sum: '$gst' },
                toBill: { $sum: { $cond: [{ $eq: ['$payment.to', 'bill'] }, '$total', 0] } },
              },
            },
            { $sort: { _id: 1 } },
          ],
          gstByRate: [
            { $unwind: '$lines' },
            {
              $group: {
                _id: '$lines.gstRate',
                gross: { $sum: { $multiply: ['$lines.amount', { $cond: [{ $gt: ['$subtotal', 0] }, { $divide: ['$total', '$subtotal'] }, 0] }] } },
              },
            },
            { $sort: { _id: 1 } },
          ],
        },
      },
    ]),
  ]);
  const gstByRate = result.gstByRate.map((g) => {
    const gross = round2(g.gross);
    const taxable = round2(gross / (1 + g._id / 100));
    return { rate: g._id, gross, taxable, gst: round2(gross - taxable) };
  });
  const byDay = result.byDay.map((d) => ({ date: d._id, sales: d.sales, total: round2(d.total), returned: round2(d.returned), net: round2(d.total - d.returned), gst: round2(d.gst), toBill: round2(d.toBill) }));
  return {
    from,
    to,
    byDay,
    gstByRate,
    totals: {
      sales: byDay.reduce((n, d) => n + d.sales, 0),
      net: round2(byDay.reduce((n, d) => n + d.net, 0)),
      gst: round2(gstByRate.reduce((n, g) => n + g.gst, 0)),
    },
  };
}

// The pharmacist's and admin's alert counts (for Today).
export async function alertCounts(hospitalId) {
  const hid = toObjectId(hospitalId);
  const now = new Date();
  const soon = new Date(now.getTime() + config.pharmacy.expiryAlertDays * DAY);
  const [[low], [expiry]] = await Promise.all([
    Medicine.aggregate([
      { $match: { hospitalId: hid, isActive: true } },
      {
        $lookup: {
          from: StockBatch.collection.name,
          localField: '_id',
          foreignField: 'medicineId',
          as: 'b',
          pipeline: [{ $match: { hospitalId: hid, qty: { $gt: 0 }, expiry: { $gt: now } } }, { $group: { _id: null, qty: { $sum: '$qty' } } }],
        },
      },
      { $match: { $expr: { $lte: [{ $ifNull: [{ $first: '$b.qty' }, 0] }, '$reorderLevel'] } } },
      { $count: 'count' },
    ]),
    StockBatch.aggregate([
      { $match: { hospitalId: hid, qty: { $gt: 0 }, expiry: { $lte: soon } } },
      { $sort: { expiry: 1 } },
      {
        $group: {
          _id: null,
          expired: { $sum: { $cond: [{ $lte: ['$expiry', now] }, 1, 0] } },
          soon: { $sum: { $cond: [{ $gt: ['$expiry', now] }, 1, 0] } },
          // the medicines expiring soon (not yet expired), soonest first
          soonMedicines: { $push: { $cond: [{ $gt: ['$expiry', now] }, '$medicineId', '$$REMOVE'] } },
        },
      },
    ]),
  ]);
  // how many different medicines expire soon, and the names of the first three (soonest first)
  const ids = [...new Map((expiry?.soonMedicines ?? []).map((id) => [String(id), id])).values()];
  const named = ids.length ? await Medicine.find({ hospitalId: hid, _id: { $in: ids.slice(0, 3) } }).select('name strength').lean() : [];
  const byId = new Map(named.map((m) => [String(m._id), `${m.name}${m.strength ? ` ${m.strength}` : ''}`]));
  return {
    lowStock: low?.count ?? 0,
    expiringSoon: expiry?.soon ?? 0,
    expiringMedicines: ids.length,
    expiringNames: ids.slice(0, 3).map((id) => byId.get(String(id))).filter(Boolean),
    expiryAlertDays: config.pharmacy.expiryAlertDays,
    expired: expiry?.expired ?? 0,
  };
}
