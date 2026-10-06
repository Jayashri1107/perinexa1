// The super admin's Billing page: every hospital's billing side by side (numbers only).
import { dayRange, monthStart, todayLocal } from '../../core/dates.js';
import { round2 } from '../../core/money.js';
import { Bill, Payment } from '../bills/bill.model.js';
import { Hospital } from '../hospitals/hospital.model.js';

const netAmount = { $cond: [{ $eq: ['$kind', 'refund'] }, { $multiply: ['$amount', -1] }, '$amount'] };
const byHospital = (rows) => new Map(rows.map((r) => [r._id.toString(), r]));

export async function platformBilling() {
  const hospitals = await Hospital.find().sort({ name: 1 }).select('name code isActive').lean();
  const inAll = { hospitalId: { $in: hospitals.map((h) => h._id) } }; // hospital-owned data is always queried by hospital
  const thisMonth = monthStart(0);
  const [todayStart, todayEnd] = dayRange(todayLocal());

  const [bills, money] = await Promise.all([
    Bill.aggregate([
      { $match: inAll },
      {
        $group: {
          _id: '$hospitalId',
          billsThisMonth: { $sum: { $cond: [{ $and: [{ $gte: ['$createdAt', thisMonth] }, { $ne: ['$status', 'cancelled'] }] }, 1, 0] } },
          billedThisMonth: { $sum: { $cond: [{ $and: [{ $gte: ['$createdAt', thisMonth] }, { $ne: ['$status', 'cancelled'] }] }, '$total', 0] } },
          unpaidBills: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'open'] }, { $gt: ['$balance', 0] }] }, 1, 0] } },
          owed: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'open'] }, { $gt: ['$balance', 0] }] }, '$balance', 0] } },
        },
      },
    ]),
    Payment.aggregate([
      { $match: { ...inAll, createdAt: { $gte: thisMonth < todayStart ? thisMonth : todayStart } } },
      {
        $group: {
          _id: '$hospitalId',
          receivedThisMonth: { $sum: { $cond: [{ $gte: ['$createdAt', thisMonth] }, netAmount, 0] } },
          receivedToday: { $sum: { $cond: [{ $and: [{ $gte: ['$createdAt', todayStart] }, { $lt: ['$createdAt', todayEnd] }] }, netAmount, 0] } },
        },
      },
    ]),
  ]);

  const [b, m] = [byHospital(bills), byHospital(money)];
  const rows = hospitals.map((h) => {
    const id = h._id.toString();
    const bill = b.get(id) ?? {};
    const pay = m.get(id) ?? {};
    return {
      id,
      name: h.name,
      code: h.code,
      isActive: h.isActive,
      billsThisMonth: bill.billsThisMonth ?? 0,
      billedThisMonth: round2(bill.billedThisMonth ?? 0),
      receivedThisMonth: round2(pay.receivedThisMonth ?? 0),
      receivedToday: round2(pay.receivedToday ?? 0),
      unpaidBills: bill.unpaidBills ?? 0,
      owed: round2(bill.owed ?? 0),
    };
  });
  const keys = ['billsThisMonth', 'billedThisMonth', 'receivedThisMonth', 'receivedToday', 'unpaidBills', 'owed'];
  return { hospitals: rows, totals: Object.fromEntries(keys.map((k) => [k, round2(rows.reduce((n, r) => n + r[k], 0))])) };
}
