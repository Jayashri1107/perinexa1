// Today: the start page for everyone working in a hospital, with only the sections their roles need.
import { config } from '../../config/index.js';
import { TIMEZONE, dayOf, dayRange, todayLocal } from '../../core/dates.js';
import { round2 } from '../../core/money.js';
import { toObjectId } from '../../core/validate.js';
import { todayFor } from '../appointments/appointment.service.js';
import { Bill, Payment } from '../bills/bill.model.js';
import { todayCounts as labCounts } from '../lab/lab.service.js';
import { unsignedToday } from '../visits/visit.service.js';
import { Patient } from '../patients/patient.model.js';
import { alertCounts } from '../pharmacyReports/pharmacyReports.service.js';
import { Sale } from '../sales/sale.model.js';
import { Admission } from '../admissions/admission.model.js';
import { Appointment } from '../appointments/appointment.model.js';
import { utcDay } from '../appointments/slots.js';

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

const signedAmount = { $cond: [{ $eq: ['$kind', 'refund'] }, { $multiply: ['$amount', -1] }, '$amount'] };
const netPaidOf = { $subtract: ['$paid', '$refunded'] };
const sumIf = (cond, value) => ({ $sum: { $cond: [cond, value, 0] } });

// A short view of a bill for the billing dashboard (no lines).
const billRow = (b, now) => ({
  id: String(b._id),
  billNumber: b.billNumber,
  patient: { id: String(b.patientId), name: b.patient?.name ?? '', patientNumber: b.patient?.patientNumber ?? '' },
  total: round2(b.total),
  paid: round2(b.paid - b.refunded),
  balance: round2(b.balance),
  status: b.status,
  createdAt: b.createdAt,
  days: Math.floor((now - b.createdAt) / DAY),
});

// The billing desk's day (owner, 8 Oct 2026): bills and payments today, what is owed (overdue after
// config.billing.overdueDays, part paid), today's money by payment mode, the latest bills, who owes most urgently,
// today's activity and the money taken in each of the last 7 days. The full lists stay on the Billing pages.
async function billingSection(hid, start, end) {
  const now = new Date();
  const overdueBefore = new Date(now.getTime() - config.billing.overdueDays * DAY);
  const weekStart = new Date(start.getTime() - 6 * DAY);
  const owing = { hospitalId: hid, status: 'open', balance: { $gt: 0 } };
  const [[bills], [money], byModeRows, [owed], recent, pending, todaysPayments, todaysBills, weekRows] = await Promise.all([
    Bill.aggregate([{ $match: { hospitalId: hid, createdAt: { $gte: start, $lt: end }, status: { $ne: 'cancelled' } } }, { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$total' } } }]),
    Payment.aggregate([
      { $match: { hospitalId: hid, createdAt: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: null,
          net: { $sum: signedAmount },
          payments: sumIf({ $eq: ['$kind', 'payment'] }, 1),
          received: sumIf({ $eq: ['$kind', 'payment'] }, '$amount'),
          refunds: sumIf({ $eq: ['$kind', 'refund'] }, 1),
          refunded: sumIf({ $eq: ['$kind', 'refund'] }, '$amount'),
        },
      },
    ]),
    Payment.aggregate([{ $match: { hospitalId: hid, createdAt: { $gte: start, $lt: end } } }, { $group: { _id: '$mode', net: { $sum: signedAmount }, count: { $sum: 1 } } }]),
    Bill.aggregate([
      { $match: owing },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          owed: { $sum: '$balance' },
          overdue: sumIf({ $lt: ['$createdAt', overdueBefore] }, 1),
          overdueOwed: sumIf({ $lt: ['$createdAt', overdueBefore] }, '$balance'),
          partial: sumIf({ $gt: [netPaidOf, 0] }, 1),
          partialOwed: sumIf({ $gt: [netPaidOf, 0] }, '$balance'),
        },
      },
    ]),
    Bill.find({ hospitalId: hid }).sort({ createdAt: -1 }).limit(6).select('-lines').lean(),
    Bill.find(owing).sort({ createdAt: 1 }).limit(6).select('-lines').lean(),
    Payment.find({ hospitalId: hid, createdAt: { $gte: start, $lt: end } }).sort({ createdAt: -1 }).limit(10).lean(),
    Bill.find({ hospitalId: hid, createdAt: { $gte: start, $lt: end } }).sort({ createdAt: -1 }).limit(10).select('billNumber patient total createdAt status').lean(),
    Payment.aggregate([{ $match: { hospitalId: hid, createdAt: { $gte: weekStart, $lt: end } } }, { $group: { _id: dayOf('$createdAt'), net: { $sum: signedAmount } } }]),
  ]);

  // the patients' names for today's payments (the payment keeps the bill number only)
  const billIds = [...new Set(todaysPayments.map((p) => String(p.billId)))];
  const payBills = billIds.length ? await Bill.find({ hospitalId: hid, _id: { $in: billIds } }).select('patient').lean() : [];
  const nameOf = new Map(payBills.map((b) => [String(b._id), b.patient?.name ?? '']));
  const activity = [
    ...todaysPayments.map((p) => ({ at: p.createdAt, kind: p.kind, billId: String(p.billId), billNumber: p.billNumber, patient: nameOf.get(String(p.billId)) ?? '', amount: round2(p.amount), mode: p.mode })),
    ...todaysBills.map((b) => ({ at: b.createdAt, kind: b.status === 'cancelled' ? 'bill_cancelled' : 'bill', billId: String(b._id), billNumber: b.billNumber, patient: b.patient?.name ?? '', amount: round2(b.total), mode: '' })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 10);

  const byMode = new Map(byModeRows.map((r) => [r._id, r]));
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart.getTime() + i * DAY);
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(date);
    return { date: key, net: round2(weekRows.find((r) => r._id === key)?.net ?? 0) };
  });

  return {
    billsToday: bills?.count ?? 0,
    billedToday: round2(bills?.total ?? 0),
    collectedToday: round2(money?.net ?? 0),
    paymentsToday: money?.payments ?? 0,
    receivedToday: round2(money?.received ?? 0),
    refundsToday: money?.refunds ?? 0,
    refundedToday: round2(money?.refunded ?? 0),
    unpaidBills: owed?.count ?? 0,
    owed: round2(owed?.owed ?? 0),
    overdueDays: config.billing.overdueDays,
    overdueBills: owed?.overdue ?? 0,
    overdueOwed: round2(owed?.overdueOwed ?? 0),
    partialBills: owed?.partial ?? 0,
    partialOwed: round2(owed?.partialOwed ?? 0),
    byMode: config.billing.paymentModes.map((m) => ({ mode: m.key, label: m.label, net: round2(byMode.get(m.key)?.net ?? 0), count: byMode.get(m.key)?.count ?? 0 })),
    recentBills: recent.map((b) => billRow(b, now)),
    pendingBills: pending.map((b) => billRow(b, now)),
    activity,
    week,
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

// The front desk's day (owner, 8 Oct 2026): today's appointments across all doctors (booked, waiting, seen,
// walk-ins), patients registered today, and who is in hospital, admitted and discharged today.
async function frontDeskSection(hid, start, end) {
  const day = utcDay(todayLocal());
  const [byStatus, walkIns, inHospital, admittedToday, dischargedToday] = await Promise.all([
    Appointment.aggregate([{ $match: { hospitalId: hid, on: day } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Appointment.countDocuments({ hospitalId: hid, on: day, source: 'walk_in', status: { $ne: 'cancelled' } }),
    Admission.countDocuments({ hospitalId: hid, status: 'admitted' }),
    Admission.countDocuments({ hospitalId: hid, admittedAt: { $gte: start, $lt: end } }),
    Admission.countDocuments({ hospitalId: hid, dischargedAt: { $gte: start, $lt: end } }),
  ]);
  const n = (st) => byStatus.find((x) => x._id === st)?.n ?? 0;
  return {
    appointments: n('booked') + n('arrived') + n('seen'),
    notArrived: n('booked'),
    waiting: n('arrived'),
    seen: n('seen'),
    cancelled: n('cancelled'),
    walkIns,
    inHospital,
    admittedToday,
    dischargedToday,
  };
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
    frontDesk: has(roles, access.registrationMenu),
  };
  const [patients, doctor, appointments, lab, billing, pharmacy, unsignedVisits, frontDesk] = await Promise.all([
    wants.patients ? patientSection(hid, start, end) : null,
    wants.doctor ? doctorSection(hid, req.user._id) : null,
    // a doctor's own appointments today: who is waiting, and who comes next
    wants.doctor ? todayFor(hid, req.user._id) : null,
    wants.lab ? labCounts(req) : null,
    wants.billing ? billingSection(hid, start, end) : null,
    wants.pharmacy ? pharmacySection(hid, start, end) : null,
    // visits of today this person started or that are her doctor's, not signed yet
    has(roles, config.prescriberRoles) ? unsignedToday(hid, req.user._id) : 0,
    wants.frontDesk ? frontDeskSection(hid, start, end) : null,
  ]);
  return { date: todayLocal(), patients, doctor, appointments, lab, billing, pharmacy, unsignedVisits, frontDesk };
}
