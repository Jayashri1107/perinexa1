// Analytics of one hospital, numbers only (never a patient's name).
// Exact numbers for doctors (config.access.analyticsExact) and the super admin; for the others, counts from 1 to
// config.analytics.smallNumberBelow − 1 are shown as "fewer than N", so no single patient can be recognised.
import { config } from '../../config/index.js';
import { lastMonths, monthOf, monthStart, todayLocal } from '../../core/dates.js';
import { round2 } from '../../core/money.js';
import { toObjectId } from '../../core/validate.js';
import { Admission, InpatientDocument } from '../admissions/admission.model.js';
import { Appointment } from '../appointments/appointment.model.js';
import { Bill, Payment } from '../bills/bill.model.js';
import { LabOrder } from '../lab/labOrder.model.js';
import { Patient } from '../patients/patient.model.js';
import { Sale } from '../sales/sale.model.js';
import { Visit } from '../visits/visit.model.js';

const { months, smallNumberBelow, dueSoonDays } = config.analytics;
const DAY = 86400000;
const has = (roles, list) => roles.some((r) => list.includes(r));

export function audienceOf(membership) {
  const roles = membership?.roles ?? [];
  return {
    exact: Boolean(membership?.isSuperAdminAccess) || has(roles, config.access.analyticsExact),
    finance: has(roles, config.access.billing),
    pharmacy: has(roles, config.access.pharmacy),
    doctor: roles.includes(config.opd.doctorRole),
  };
}

// A count as shown: exact, or { below: N } when small.
const shown = (n, exact) => (exact || n === 0 || n >= smallNumberBelow ? n : { below: smallNumberBelow });

// Age bands from config.patients.ageBands: [0,1,18,25 …] → "0", "1–17", "18–24" … "50+".
const bands = config.patients.ageBands;
const bandLabel = (i) => (i === bands.length - 1 ? `${bands[i]}+` : bands[i + 1] - bands[i] === 1 ? `${bands[i]}` : `${bands[i]}–${bands[i + 1] - 1}`);

async function patientNumbers(match, exact) {
  const since = monthStart(months - 1);
  const now = new Date();
  const dueBy = new Date(now.getTime() + dueSoonDays * DAY);
  const antenatal = config.patients.careTypes.find((c) => c.needsLmp)?.key;
  const [r] = await Patient.aggregate([
    { $match: match },
    {
      $facet: {
        totals: [{ $group: { _id: null, all: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } } } }],
        byCareType: [{ $match: { status: 'active' } }, { $group: { _id: '$careType', count: { $sum: 1 } } }],
        byMonth: [{ $match: { createdAt: { $gte: since } } }, { $group: { _id: monthOf('$createdAt'), count: { $sum: 1 } } }],
        byAge: [
          { $match: { status: 'active', birthDate: { $ne: null } } },
          { $set: { age: { $dateDiff: { startDate: '$birthDate', endDate: '$$NOW', unit: 'year' } } } },
          { $bucket: { groupBy: '$age', boundaries: [...bands, 200], default: 'other', output: { count: { $sum: 1 } } } },
        ],
        dueSoon: [{ $match: { status: 'active', careType: antenatal, edd: { $gte: now, $lte: dueBy } } }, { $count: 'count' }],
      },
    },
  ]);
  const careCounts = Object.fromEntries(r.byCareType.map((c) => [c._id, c.count]));
  return {
    total: shown(r.totals[0]?.all ?? 0, exact),
    active: shown(r.totals[0]?.active ?? 0, exact),
    dueSoon: shown(r.dueSoon[0]?.count ?? 0, exact),
    dueSoonDays,
    byCareType: config.patients.careTypes.map((c) => ({ key: c.key, label: c.label, count: shown(careCounts[c.key] ?? 0, exact) })),
    byMonth: lastMonths(months).map((m) => ({ month: m, count: shown(r.byMonth.find((x) => x._id === m)?.count ?? 0, exact) })),
    byAge: bands.map((b, i) => ({ label: bandLabel(i), count: shown(r.byAge.find((x) => x._id === b)?.count ?? 0, exact) })),
  };
}

async function financeNumbers(hid) {
  const since = monthStart(months - 1);
  const [billed, collected] = await Promise.all([
    Bill.aggregate([
      { $match: { hospitalId: hid, createdAt: { $gte: since }, status: { $ne: 'cancelled' } } },
      { $group: { _id: monthOf('$createdAt'), billed: { $sum: '$total' } } },
    ]),
    Payment.aggregate([
      { $match: { hospitalId: hid, createdAt: { $gte: since } } },
      { $group: { _id: monthOf('$createdAt'), net: { $sum: { $cond: [{ $eq: ['$kind', 'refund'] }, { $multiply: ['$amount', -1] }, '$amount'] } } } },
    ]),
  ]);
  return lastMonths(months).map((m) => ({
    month: m,
    billed: round2(billed.find((x) => x._id === m)?.billed ?? 0),
    collected: round2(collected.find((x) => x._id === m)?.net ?? 0),
  }));
}

async function pharmacyNumbers(hid) {
  const rows = await Sale.aggregate([
    { $match: { hospitalId: hid, createdAt: { $gte: monthStart(months - 1) } } },
    { $group: { _id: monthOf('$createdAt'), sales: { $sum: 1 }, net: { $sum: { $subtract: ['$total', '$returnedAmount'] } } } },
  ]);
  return lastMonths(months).map((m) => {
    const r = rows.find((x) => x._id === m);
    return { month: m, sales: r?.sales ?? 0, net: round2(r?.net ?? 0) };
  });
}

// The clinical work month by month: OPD visits, appointments (seen, did not come, cancelled), admissions, deliveries
// and lab orders (with how many had a result outside its range), plus who is in hospital now and the average stay.
// patientIds: only these patients (a doctor's own), or null for the whole hospital.
async function clinicalNumbers(hid, patientIds, exact) {
  const since = monthStart(months - 1);
  const mineOnly = patientIds ? { patientId: { $in: patientIds } } : {};
  const todayDay = new Date(`${todayLocal()}T00:00:00.000Z`); // appointments up to yesterday: today's are not over
  const [visits, appts, admissions, stays, deliveries, labs, admittedNow] = await Promise.all([
    Visit.aggregate([{ $match: { hospitalId: hid, ...mineOnly, status: 'active', visitOn: { $gte: since } } }, { $group: { _id: monthOf('$visitOn'), count: { $sum: 1 } } }]),
    Appointment.aggregate([
      { $match: { hospitalId: hid, ...mineOnly, on: { $gte: since, $lt: todayDay } } },
      {
        $group: {
          _id: monthOf('$on'),
          seen: { $sum: { $cond: [{ $eq: ['$status', 'seen'] }, 1, 0] } },
          noShow: { $sum: { $cond: [{ $eq: ['$status', 'booked'] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        },
      },
    ]),
    Admission.aggregate([{ $match: { hospitalId: hid, ...mineOnly, admittedAt: { $gte: since } } }, { $group: { _id: monthOf('$admittedAt'), count: { $sum: 1 } } }]),
    Admission.aggregate([
      { $match: { hospitalId: hid, ...mineOnly, status: 'discharged', dischargedAt: { $gte: since } } },
      { $group: { _id: null, days: { $avg: { $divide: [{ $subtract: ['$dischargedAt', '$admittedAt'] }, DAY] } }, count: { $sum: 1 } } },
    ]),
    InpatientDocument.aggregate([
      { $match: { hospitalId: hid, ...mineOnly, kind: 'delivery', status: 'signed', 'content.deliveredAt': { $gte: since } } },
      { $group: { _id: monthOf('$content.deliveredAt'), count: { $sum: 1 }, caesarean: { $sum: { $cond: [{ $eq: ['$content.mode', 'lscs'] }, 1, 0] } } } },
    ]),
    LabOrder.aggregate([
      { $match: { hospitalId: hid, ...mineOnly, status: { $ne: 'cancelled' }, createdAt: { $gte: since } } },
      { $set: { abnormal: { $gt: [{ $size: { $filter: { input: { $reduce: { input: '$tests', initialValue: [], in: { $concatArrays: ['$$value', '$$this.values'] } } }, cond: { $in: ['$$this.flag', ['low', 'high', 'abnormal']] } } } }, 0] } } },
      { $group: { _id: monthOf('$createdAt'), count: { $sum: 1 }, abnormal: { $sum: { $cond: ['$abnormal', 1, 0] } } } },
    ]),
    Admission.countDocuments({ hospitalId: hid, ...mineOnly, status: 'admitted' }),
  ]);
  const at = (rows, m, k = 'count') => rows.find((x) => x._id === m)?.[k] ?? 0;
  const s = (n) => shown(n, exact);
  return {
    byMonth: lastMonths(months).map((m) => ({
      month: m,
      visits: s(at(visits, m)),
      seen: s(at(appts, m, 'seen')),
      noShow: s(at(appts, m, 'noShow')),
      cancelled: s(at(appts, m, 'cancelled')),
      admissions: s(at(admissions, m)),
      deliveries: s(at(deliveries, m)),
      caesarean: s(at(deliveries, m, 'caesarean')),
      labOrders: s(at(labs, m)),
      labAbnormal: s(at(labs, m, 'abnormal')),
    })),
    admittedNow: s(admittedNow),
    averageStayDays: stays[0]?.count ? Math.round(stays[0].days * 10) / 10 : null,
    discharged: s(stays[0]?.count ?? 0),
  };
}

// mine: a doctor's own patients only.
export async function hospitalAnalytics(req, { mine }) {
  const hid = toObjectId(req.hospitalId);
  const audience = audienceOf(req.membership);
  const onlyMine = mine && audience.doctor;
  const match = { hospitalId: hid, ...(onlyMine && { assignedDoctorId: req.user._id }) };
  const myPatients = onlyMine ? (await Patient.find(match).select('_id').lean()).map((p) => p._id) : null;
  const exact = audience.exact || onlyMine;
  const [patients, clinical, finance, pharmacy] = await Promise.all([
    patientNumbers(match, exact),
    clinicalNumbers(hid, myPatients, exact),
    audience.finance && !onlyMine ? financeNumbers(hid) : null,
    audience.pharmacy && !onlyMine ? pharmacyNumbers(hid) : null,
  ]);
  return { exact, smallNumberBelow, mine: Boolean(onlyMine), canFilterMine: audience.doctor, patients, clinical, finance, pharmacy };
}
