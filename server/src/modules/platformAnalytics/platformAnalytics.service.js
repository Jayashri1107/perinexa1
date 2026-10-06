// The super admin's analytics: totals per hospital and for all hospitals – numbers only.
import { config } from '../../config/index.js';
import { monthStart } from '../../core/dates.js';
import { round2 } from '../../core/money.js';
import { Bill, Payment } from '../bills/bill.model.js';
import { Hospital } from '../hospitals/hospital.model.js';
import { Membership } from '../members/membership.model.js';
import { Patient } from '../patients/patient.model.js';
import { Sale } from '../sales/sale.model.js';

const byHospital = (rows) => new Map(rows.map((r) => [r._id.toString(), r]));

export async function platformAnalytics() {
  const hospitals = await Hospital.find().sort({ name: 1 }).select('name code isActive').lean();
  const ids = hospitals.map((h) => h._id);
  const inAll = { hospitalId: { $in: ids } }; // hospital-owned data is always queried by hospital
  const thisMonth = monthStart(0);
  const antenatal = config.patients.careTypes.find((c) => c.needsLmp)?.key;

  const [patients, staff, billed, collected, pharmacy] = await Promise.all([
    Patient.aggregate([
      { $match: inAll },
      {
        $group: {
          _id: '$hospitalId',
          patients: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          newThisMonth: { $sum: { $cond: [{ $gte: ['$createdAt', thisMonth] }, 1, 0] } },
          pregnancies: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'active'] }, { $eq: ['$careType', antenatal] }] }, 1, 0] } },
        },
      },
    ]),
    Membership.aggregate([{ $match: { hospitalId: { $in: ids }, isActive: true } }, { $group: { _id: '$hospitalId', staff: { $sum: 1 } } }]),
    Bill.aggregate([{ $match: { ...inAll, createdAt: { $gte: thisMonth }, status: { $ne: 'cancelled' } } }, { $group: { _id: '$hospitalId', billed: { $sum: '$total' } } }]),
    Payment.aggregate([
      { $match: { ...inAll, createdAt: { $gte: thisMonth } } },
      { $group: { _id: '$hospitalId', collected: { $sum: { $cond: [{ $eq: ['$kind', 'refund'] }, { $multiply: ['$amount', -1] }, '$amount'] } } } },
    ]),
    Sale.aggregate([{ $match: { ...inAll, createdAt: { $gte: thisMonth } } }, { $group: { _id: '$hospitalId', pharmacy: { $sum: { $subtract: ['$total', '$returnedAmount'] } } } }]),
  ]);
  const maps = [patients, staff, billed, collected, pharmacy].map(byHospital);
  const rows = hospitals.map((h) => {
    const id = h._id.toString();
    const [p, s, b, c, ph] = maps.map((m) => m.get(id) ?? {});
    return {
      id,
      name: h.name,
      code: h.code,
      isActive: h.isActive,
      patients: p.patients ?? 0,
      active: p.active ?? 0,
      newThisMonth: p.newThisMonth ?? 0,
      pregnancies: p.pregnancies ?? 0,
      staff: s.staff ?? 0,
      billedThisMonth: round2(b.billed ?? 0),
      collectedThisMonth: round2(c.collected ?? 0),
      pharmacyThisMonth: round2(ph.pharmacy ?? 0),
    };
  });
  const keys = ['patients', 'active', 'newThisMonth', 'pregnancies', 'staff', 'billedThisMonth', 'collectedThisMonth', 'pharmacyThisMonth'];
  const totals = Object.fromEntries(keys.map((k) => [k, round2(rows.reduce((n, r) => n + r[k], 0))]));
  return { hospitals: rows, totals };
}
