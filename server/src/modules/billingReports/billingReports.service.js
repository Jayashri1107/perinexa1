// Billing reports: unpaid bills, the daily cash summary, monthly income, and the export for Excel.
import { config } from '../../config/index.js';
import { lookupOne, withId } from '../../core/aggregate.js';
import { dayRange, lastMonths, monthOf, monthStart } from '../../core/dates.js';
import { round2 } from '../../core/money.js';
import { paginate } from '../../core/pagination.js';
import { containsText, toObjectId } from '../../core/validate.js';
import { Bill, Payment } from '../bills/bill.model.js';
import { Patient } from '../patients/patient.model.js';

const label = (list, key) => list.find((x) => x.key === key)?.label ?? key;

// Who owes how much, since when, with the phone number to call. Oldest first.
export async function unpaidBills(hospitalId, q) {
  const match = { hospitalId: toObjectId(hospitalId), status: 'open', balance: { $gt: 0 } };
  if (q.search) match.$or = [{ 'patient.name': containsText(q.search) }, { billNumber: containsText(q.search) }];
  const result = await paginate(Bill, {
    match,
    sort: { createdAt: 1, _id: 1 },
    page: q.page,
    limit: q.limit,
    pageStages: [
      ...lookupOne({ from: Patient.collection.name, localField: 'patientId', as: 'contact', fields: ['phone'] }),
      { $project: { billNumber: 1, patient: 1, total: 1, balance: 1, createdAt: 1, phone: '$contact.phone', patientId: 1 } },
      ...withId(),
    ],
  });
  const [totals] = await Bill.aggregate([{ $match: match }, { $group: { _id: null, owed: { $sum: '$balance' }, bills: { $sum: 1 } } }]);
  return { ...result, totals: { owed: round2(totals?.owed ?? 0), bills: totals?.bills ?? 0 } };
}

// Money in and out on one day: by mode, by person, and the bills of the day.
export async function dailySummary(hospitalId, date) {
  const hid = toObjectId(hospitalId);
  const [start, end] = dayRange(date);
  const signed = { $cond: [{ $eq: ['$kind', 'refund'] }, { $multiply: ['$amount', -1] }, '$amount'] };
  const [[money], [bills]] = await Promise.all([
    Payment.aggregate([
      { $match: { hospitalId: hid, createdAt: { $gte: start, $lt: end } } },
      {
        $facet: {
          byMode: [
            {
              $group: {
                _id: '$mode',
                payments: { $sum: { $cond: [{ $eq: ['$kind', 'payment'] }, '$amount', 0] } },
                refunds: { $sum: { $cond: [{ $eq: ['$kind', 'refund'] }, '$amount', 0] } },
                count: { $sum: 1 },
              },
            },
          ],
          byPerson: [{ $group: { _id: '$byName', net: { $sum: signed }, count: { $sum: 1 } } }, { $sort: { net: -1 } }],
          total: [
            {
              $group: {
                _id: null,
                payments: { $sum: { $cond: [{ $eq: ['$kind', 'payment'] }, '$amount', 0] } },
                refunds: { $sum: { $cond: [{ $eq: ['$kind', 'refund'] }, '$amount', 0] } },
              },
            },
          ],
        },
      },
    ]),
    Bill.aggregate([
      { $match: { hospitalId: hid, createdAt: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: null,
          created: { $sum: 1 },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          billed: { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, '$total', 0] } },
          discounts: { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, '$discount.amount', 0] } },
        },
      },
    ]),
  ]);
  const totals = money.total[0] ?? { payments: 0, refunds: 0 };
  const byMode = Object.fromEntries(money.byMode.map((m) => [m._id, m]));
  return {
    date,
    byMode: config.billing.paymentModes.map((m) => ({
      mode: m.key,
      label: m.label,
      payments: round2(byMode[m.key]?.payments ?? 0),
      refunds: round2(byMode[m.key]?.refunds ?? 0),
      count: byMode[m.key]?.count ?? 0,
    })),
    byPerson: money.byPerson.map((p) => ({ name: p._id, net: round2(p.net), count: p.count })),
    totals: { payments: round2(totals.payments), refunds: round2(totals.refunds), net: round2(totals.payments - totals.refunds) },
    bills: { created: bills?.created ?? 0, cancelled: bills?.cancelled ?? 0, billed: round2(bills?.billed ?? 0), discounts: round2(bills?.discounts ?? 0) },
  };
}

// The last N months: billed by group, and money in by mode.
export async function monthlyIncome(hospitalId, months) {
  const hid = toObjectId(hospitalId);
  const since = monthStart(months - 1);
  const [byGroupRows, byModeRows, billRows] = await Promise.all([
    Bill.aggregate([
      { $match: { hospitalId: hid, createdAt: { $gte: since }, status: { $ne: 'cancelled' } } },
      { $unwind: '$lines' },
      { $group: { _id: { month: monthOf('$createdAt'), group: '$lines.group' }, amount: { $sum: '$lines.amount' } } },
    ]),
    Payment.aggregate([
      { $match: { hospitalId: hid, createdAt: { $gte: since } } },
      {
        $group: {
          _id: { month: monthOf('$createdAt'), mode: '$mode' },
          net: { $sum: { $cond: [{ $eq: ['$kind', 'refund'] }, { $multiply: ['$amount', -1] }, '$amount'] } },
        },
      },
    ]),
    Bill.aggregate([
      { $match: { hospitalId: hid, createdAt: { $gte: since }, status: { $ne: 'cancelled' } } },
      { $group: { _id: monthOf('$createdAt'), billed: { $sum: '$total' }, discounts: { $sum: '$discount.amount' }, bills: { $sum: 1 } } },
    ]),
  ]);

  const cell = (rows, month, key, field) => round2(rows.find((r) => r._id.month === month && r._id[key] === field)?.[key === 'group' ? 'amount' : 'net'] ?? 0);
  return {
    groups: config.billing.priceGroups.map((g) => ({ key: g.key, label: g.label })),
    modes: config.billing.paymentModes.map((m) => ({ key: m.key, label: m.label })),
    months: lastMonths(months).map((month) => {
      const b = billRows.find((r) => r._id === month);
      return {
        month,
        bills: b?.bills ?? 0,
        billed: round2(b?.billed ?? 0),
        discounts: round2(b?.discounts ?? 0),
        byGroup: Object.fromEntries(config.billing.priceGroups.map((g) => [g.key, cell(byGroupRows, month, 'group', g.key)])),
        byMode: Object.fromEntries(config.billing.paymentModes.map((m) => [m.key, cell(byModeRows, month, 'mode', m.key)])),
      };
    }),
  };
}

// Bills of a period as CSV (opens in Excel).
export async function exportBills(hospitalId, from, to) {
  const [start] = dayRange(from);
  const [, end] = dayRange(to);
  const bills = await Bill.find({ hospitalId, createdAt: { $gte: start, $lt: end } }).sort({ createdAt: 1 }).lean();
  const cell = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const header = ['Bill', 'Date', 'Patient number', 'Patient', 'Subtotal', 'Discount', 'Total', 'Paid', 'Refunded', 'Balance', 'Status'];
  const rows = bills.map((b) => [
    b.billNumber,
    b.createdAt.toISOString(),
    b.patient?.patientNumber,
    b.patient?.name,
    b.subtotal,
    b.discount?.amount ?? 0,
    b.total,
    b.paid,
    b.refunded,
    b.balance,
    label([{ key: 'open', label: 'Open' }, { key: 'paid', label: 'Paid' }, { key: 'cancelled', label: 'Cancelled' }], b.status),
  ]);
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}
