// The super admin's analytics: totals per hospital and for all hospitals – numbers only.
import { config } from '../../config/index.js';
import { lastMonths, monthOf, monthStart } from '../../core/dates.js';
import { round2 } from '../../core/money.js';
import { Bill, Payment } from '../bills/bill.model.js';
import { Hospital } from '../hospitals/hospital.model.js';
import { Membership } from '../members/membership.model.js';
import { Patient } from '../patients/patient.model.js';
import { Sale } from '../sales/sale.model.js';
import { Admission } from '../admissions/admission.model.js';
import { Appointment } from '../appointments/appointment.model.js';
import { Visit } from '../visits/visit.model.js';
import { todayLocal } from '../../core/dates.js';

const byHospital = (rows) => new Map(rows.map((r) => [r._id.toString(), r]));

export async function platformAnalytics() {
  const hospitals = await Hospital.find().sort({ name: 1 }).select('name code isActive').lean();
  const ids = hospitals.map((h) => h._id);
  const inAll = { hospitalId: { $in: ids } }; // hospital-owned data is always queried by hospital
  const thisMonth = monthStart(0);
  const antenatal = config.patients.careTypes.find((c) => c.needsLmp)?.key;

  const today = new Date(`${todayLocal()}T00:00:00.000Z`);
  const [patients, staff, billed, collected, pharmacy, visits, admitted, appointmentsToday] = await Promise.all([
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
    Visit.aggregate([{ $match: { ...inAll, status: 'active', visitOn: { $gte: thisMonth } } }, { $group: { _id: '$hospitalId', visits: { $sum: 1 } } }]),
    Admission.aggregate([{ $match: { ...inAll, status: 'admitted' } }, { $group: { _id: '$hospitalId', admitted: { $sum: 1 } } }]),
    Appointment.aggregate([{ $match: { ...inAll, on: today, status: { $ne: 'cancelled' } } }, { $group: { _id: '$hospitalId', appointments: { $sum: 1 } } }]),
  ]);
  const maps = [patients, staff, billed, collected, pharmacy, visits, admitted, appointmentsToday].map(byHospital);
  const rows = hospitals.map((h) => {
    const id = h._id.toString();
    const [p, s, b, c, ph, v, a, ap] = maps.map((m) => m.get(id) ?? {});
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
      visitsThisMonth: v.visits ?? 0,
      admittedNow: a.admitted ?? 0,
      appointmentsToday: ap.appointments ?? 0,
    };
  });
  const keys = ['patients', 'active', 'newThisMonth', 'pregnancies', 'staff', 'billedThisMonth', 'collectedThisMonth', 'pharmacyThisMonth', 'visitsThisMonth', 'admittedNow', 'appointmentsToday'];
  const totals = Object.fromEntries(keys.map((k) => [k, round2(rows.reduce((n, r) => n + r[k], 0))]));
  return { hospitals: rows, totals, trend: await monthlyTrend(inAll) };
}

// All hospitals together, month by month (config.analytics.months): new patients, billed, received, pharmacy sales.
async function monthlyTrend(inAll) {
  const since = monthStart(config.analytics.months - 1);
  const [patients, billed, received, pharmacy, visits] = await Promise.all([
    Patient.aggregate([{ $match: { ...inAll, createdAt: { $gte: since } } }, { $group: { _id: monthOf('$createdAt'), v: { $sum: 1 } } }]),
    Bill.aggregate([{ $match: { ...inAll, createdAt: { $gte: since }, status: { $ne: 'cancelled' } } }, { $group: { _id: monthOf('$createdAt'), v: { $sum: '$total' } } }]),
    Payment.aggregate([
      { $match: { ...inAll, createdAt: { $gte: since } } },
      { $group: { _id: monthOf('$createdAt'), v: { $sum: { $cond: [{ $eq: ['$kind', 'refund'] }, { $multiply: ['$amount', -1] }, '$amount'] } } } },
    ]),
    Sale.aggregate([{ $match: { ...inAll, createdAt: { $gte: since } } }, { $group: { _id: monthOf('$createdAt'), v: { $sum: { $subtract: ['$total', '$returnedAmount'] } } } }]),
    Visit.aggregate([{ $match: { ...inAll, status: 'active', visitOn: { $gte: since } } }, { $group: { _id: monthOf('$visitOn'), v: { $sum: 1 } } }]),
  ]);
  const at = (rows, m) => round2(rows.find((r) => r._id === m)?.v ?? 0);
  return lastMonths(config.analytics.months).map((month) => ({
    month,
    newPatients: at(patients, month),
    billed: at(billed, month),
    received: at(received, month),
    pharmacy: at(pharmacy, month),
    visits: at(visits, month),
  }));
}
