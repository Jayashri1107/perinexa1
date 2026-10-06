// Analytics of one hospital, numbers only (never a patient's name).
// Exact numbers for doctors (config.access.analyticsExact) and the super admin; for the others, counts from 1 to
// config.analytics.smallNumberBelow − 1 are shown as "fewer than N", so no single patient can be recognised.
import { config } from '../../config/index.js';
import { lastMonths, monthOf, monthStart } from '../../core/dates.js';
import { round2 } from '../../core/money.js';
import { toObjectId } from '../../core/validate.js';
import { Bill, Payment } from '../bills/bill.model.js';
import { Patient } from '../patients/patient.model.js';
import { Sale } from '../sales/sale.model.js';

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

// mine: a doctor's own patients only.
export async function hospitalAnalytics(req, { mine }) {
  const hid = toObjectId(req.hospitalId);
  const audience = audienceOf(req.membership);
  const onlyMine = mine && audience.doctor;
  const match = { hospitalId: hid, ...(onlyMine && { assignedDoctorId: req.user._id }) };
  const [patients, finance, pharmacy] = await Promise.all([
    patientNumbers(match, audience.exact || onlyMine),
    audience.finance && !onlyMine ? financeNumbers(hid) : null,
    audience.pharmacy && !onlyMine ? pharmacyNumbers(hid) : null,
  ]);
  return { exact: audience.exact || onlyMine, smallNumberBelow, mine: Boolean(onlyMine), canFilterMine: audience.doctor, patients, finance, pharmacy };
}
