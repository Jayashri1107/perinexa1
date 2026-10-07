// Today: the start page for everyone working in a hospital, with only the sections their roles need.
import { config } from '../../config/index.js';
import { dayRange, todayLocal } from '../../core/dates.js';
import { round2 } from '../../core/money.js';
import { toObjectId } from '../../core/validate.js';
import { todayFor } from '../appointments/appointment.service.js';
import { Bill, Payment } from '../bills/bill.model.js';
import { todayCounts as labCounts } from '../lab/lab.service.js';
import { unsignedToday } from '../visits/visit.service.js';
import { Patient } from '../patients/patient.model.js';
import { alertCounts } from '../pharmacyReports/pharmacyReports.service.js';
import { Sale } from '../sales/sale.model.js';

const has = (roles, list) => roles.some((r) => list.includes(r));
const DAY = 86400000;

async function patientSection(hid, start, end) {
  const [registeredToday, active] = await Promise.all([
    Patient.countDocuments({ hospitalId: hid, createdAt: { $gte: start, $lt: end } }),
    Patient.countDocuments({ hospitalId: hid, status: 'active' }),
  ]);
  return { registeredToday, active };
}

// A doctor's own patients, and her pregnancies due soon (names: they are her patients).
async function doctorSection(hid, userId) {
  const now = new Date();
  const dueBy = new Date(now.getTime() + config.analytics.dueSoonDays * DAY);
  const antenatal = config.patients.careTypes.find((c) => c.needsLmp)?.key;
  const [mine, dueSoon] = await Promise.all([
    Patient.countDocuments({ hospitalId: hid, assignedDoctorId: userId, status: 'active' }),
    Patient.find({ hospitalId: hid, assignedDoctorId: userId, status: 'active', careType: antenatal, edd: { $gte: now, $lte: dueBy } })
      .sort({ edd: 1 })
      .limit(10)
      .select('patientNumber name edd')
      .lean(),
  ]);
  return { mine, dueSoonDays: config.analytics.dueSoonDays, dueSoon: dueSoon.map((p) => ({ id: p._id.toString(), patientNumber: p.patientNumber, name: p.name, edd: p.edd })) };
}

async function billingSection(hid, start, end) {
  const [[bills], [money], [unpaid]] = await Promise.all([
    Bill.aggregate([{ $match: { hospitalId: hid, createdAt: { $gte: start, $lt: end }, status: { $ne: 'cancelled' } } }, { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$total' } } }]),
    Payment.aggregate([
      { $match: { hospitalId: hid, createdAt: { $gte: start, $lt: end } } },
      { $group: { _id: null, net: { $sum: { $cond: [{ $eq: ['$kind', 'refund'] }, { $multiply: ['$amount', -1] }, '$amount'] } } } },
    ]),
    Bill.aggregate([{ $match: { hospitalId: hid, status: 'open', balance: { $gt: 0 } } }, { $group: { _id: null, count: { $sum: 1 }, owed: { $sum: '$balance' } } }]),
  ]);
  return {
    billsToday: bills?.count ?? 0,
    billedToday: round2(bills?.total ?? 0),
    collectedToday: round2(money?.net ?? 0),
    unpaidBills: unpaid?.count ?? 0,
    owed: round2(unpaid?.owed ?? 0),
  };
}

async function pharmacySection(hid, start, end) {
  const [alerts, [sales]] = await Promise.all([
    alertCounts(hid),
    Sale.aggregate([
      { $match: { hospitalId: hid, createdAt: { $gte: start, $lt: end } } },
      { $group: { _id: null, count: { $sum: 1 }, net: { $sum: { $subtract: ['$total', '$returnedAmount'] } } } },
    ]),
  ]);
  return { ...alerts, salesToday: sales?.count ?? 0, soldToday: round2(sales?.net ?? 0) };
}

export async function today(req) {
  const hid = toObjectId(req.hospitalId);
  const roles = req.membership.roles;
  const [start, end] = dayRange(todayLocal());
  const { access } = config;
  const wants = {
    patients: has(roles, access.registerPatients) || roles.includes(config.adminRole),
    doctor: roles.includes(config.opd.doctorRole),
    billing: has(roles, access.billing),
    pharmacy: has(roles, access.pharmacy),
    lab: has(roles, access.lab),
  };
  const [patients, doctor, appointments, lab, billing, pharmacy, unsignedVisits] = await Promise.all([
    wants.patients ? patientSection(hid, start, end) : null,
    wants.doctor ? doctorSection(hid, req.user._id) : null,
    // a doctor's own appointments today: who is waiting, and who comes next
    wants.doctor ? todayFor(hid, req.user._id) : null,
    wants.lab ? labCounts(req) : null,
    wants.billing ? billingSection(hid, start, end) : null,
    wants.pharmacy ? pharmacySection(hid, start, end) : null,
    // visits of today this person started or that are her doctor's, not signed yet
    has(roles, config.prescriberRoles) ? unsignedToday(hid, req.user._id) : 0,
  ]);
  return { date: todayLocal(), patients, doctor, appointments, lab, billing, pharmacy, unsignedVisits };
}
