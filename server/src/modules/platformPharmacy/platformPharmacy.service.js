// The super admin's Pharmacy page: every hospital's pharmacy side by side – sales, stock value and alerts.
import { config } from '../../config/index.js';
import { dayRange, monthStart, todayLocal } from '../../core/dates.js';
import { round2 } from '../../core/money.js';
import { Hospital } from '../hospitals/hospital.model.js';
import { Medicine } from '../medicines/medicine.model.js';
import { Sale } from '../sales/sale.model.js';
import { StockBatch } from '../stock/stock.model.js';

const DAY = 86400000;
const byHospital = (rows) => new Map(rows.map((r) => [r._id.toString(), r]));

export async function platformPharmacy() {
  const hospitals = await Hospital.find().sort({ name: 1 }).select('name code isActive').lean();
  const ids = hospitals.map((h) => h._id);
  const inAll = { hospitalId: { $in: ids } }; // hospital-owned data is always queried by hospital
  const thisMonth = monthStart(0);
  const [todayStart, todayEnd] = dayRange(todayLocal());
  const now = new Date();
  const soon = new Date(now.getTime() + config.pharmacy.expiryAlertDays * DAY);

  const [sales, stock, low] = await Promise.all([
    Sale.aggregate([
      { $match: { ...inAll, createdAt: { $gte: thisMonth < todayStart ? thisMonth : todayStart } } },
      {
        $group: {
          _id: '$hospitalId',
          soldThisMonth: { $sum: { $cond: [{ $gte: ['$createdAt', thisMonth] }, { $subtract: ['$total', '$returnedAmount'] }, 0] } },
          salesToday: { $sum: { $cond: [{ $and: [{ $gte: ['$createdAt', todayStart] }, { $lt: ['$createdAt', todayEnd] }] }, 1, 0] } },
        },
      },
    ]),
    StockBatch.aggregate([
      { $match: { ...inAll, qty: { $gt: 0 } } },
      {
        $group: {
          _id: '$hospitalId',
          valueAtCost: { $sum: { $multiply: ['$qty', '$purchasePrice'] } },
          expiringSoon: { $sum: { $cond: [{ $and: [{ $gt: ['$expiry', now] }, { $lte: ['$expiry', soon] }] }, 1, 0] } },
          expired: { $sum: { $cond: [{ $lte: ['$expiry', now] }, 1, 0] } },
        },
      },
    ]),
    // medicines at or below their reorder level (sellable stock only)
    Medicine.aggregate([
      { $match: { ...inAll, isActive: true } },
      {
        $lookup: {
          from: StockBatch.collection.name,
          let: { m: '$_id', h: '$hospitalId' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$medicineId', '$$m'] }, { $eq: ['$hospitalId', '$$h'] }, { $gt: ['$qty', 0] }, { $gt: ['$expiry', now] }] } } },
            { $group: { _id: null, qty: { $sum: '$qty' } } },
          ],
          as: 'stock',
        },
      },
      { $match: { $expr: { $lte: [{ $ifNull: [{ $first: '$stock.qty' }, 0] }, '$reorderLevel'] } } },
      { $group: { _id: '$hospitalId', lowStock: { $sum: 1 } } },
    ]),
  ]);

  const [s, st, l] = [byHospital(sales), byHospital(stock), byHospital(low)];
  const rows = hospitals.map((h) => {
    const id = h._id.toString();
    return {
      id,
      name: h.name,
      code: h.code,
      isActive: h.isActive,
      soldThisMonth: round2(s.get(id)?.soldThisMonth ?? 0),
      salesToday: s.get(id)?.salesToday ?? 0,
      valueAtCost: round2(st.get(id)?.valueAtCost ?? 0),
      lowStock: l.get(id)?.lowStock ?? 0,
      expiringSoon: st.get(id)?.expiringSoon ?? 0,
      expired: st.get(id)?.expired ?? 0,
    };
  });
  const keys = ['soldThisMonth', 'salesToday', 'valueAtCost', 'lowStock', 'expiringSoon', 'expired'];
  return {
    expiryAlertDays: config.pharmacy.expiryAlertDays,
    hospitals: rows,
    totals: Object.fromEntries(keys.map((k) => [k, round2(rows.reduce((n, r) => n + r[k], 0))])),
  };
}
