// Analytics → Lab times (P9 of docs/LAB_BUILD_NOTE.md): how long the lab's orders take, stage by stage.
//
// Its own page beside Waiting times, for the same reason: the tabs' protection (mask.js) is built for counts, and
// durations stay out of it. The owner's decisions for the patient timeline apply (docs/PATIENT_FLOW_PLAN.md,
// decisions 3, 6 and 7): stages only – never a figure per technician or per doctor; RMOs, nurses, reception and the
// lab get no Analytics (the lab sees its late orders in the Lab list).
//
// Stages, in minutes, counted by clock time day and night (whether the lab's closed hours are taken out is the
// owner's open point – LAB_BUILD_NOTE section 7):
//  - order → sample, sample → report: only when the sample's time is known. An order reported without "sample taken"
//    has `collected` stamped by the report (collectedAtReport; on older orders collected.at === reported.at) – it is
//    left out of these two and still counts for the whole;
//  - report → doctor's review: the latest report to the review (walk-in orders are not reviewed here);
//  - order → report (the whole), and whether it was later than its due time (`dueAt`);
//  - critical results: the report to the first call noted (the call's own time; a call before the report counts as 0),
//    and the report to the doctor's acknowledgement.
// The report time is the FIRST report (`firstReported`). Orders reported before that stamp existed use `reported`
// when they were never amended; an amended old order takes it from the audit log (its first LAB_RESULTS_REPORTED) where
// the log still has it, else it is left out of the report stages.
//
// Who sees what (as Waiting times):
//  - doctor: exact numbers, the current month too, the orders of patients whose clinical details she may see;
//  - hospital admin: whole finished months; a usual or slow time only from WAIT_MIN_N orders, else "Too few";
//    counts rounded to 5; never a patient, a name or a list;
//  - super admin: the same as the hospital admin, per hospital and for all hospitals together.
// A confidential test (HIV) is never named here: the groups are the lab's departments.

import { AuditLog } from '../models/AuditLog.js';
import { hospitalDayStart, hospitalToday, utcDay } from '../careplans/dates.js';
import { DEPARTMENT_KEYS } from '../lab/labSetup.js';
import { LabOrder } from '../models/LabOrder.js';
import { Patient } from '../models/Patient.js';
import { hourAndDay, spread } from '../visits/flow.js';
import { PATIENT_FIELDS } from './load.js';
import { visibleSet } from './visibility.js';
import { WAIT_MIN_N, waitPeriod } from './waitingTimes.js';

const MIN = 60_000;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const LAB_STAGES = [
  { key: 'toSample', label: 'Order to sample taken' },
  { key: 'sampleToReport', label: 'Sample taken to report' },
  { key: 'reportToReview', label: "Report to the doctor's review" },
  { key: 'whole', label: 'Order to report (whole)' },
  // P5: critical results only - the report to the lab's first call, and to the doctor's acknowledgement
  { key: 'reportToCall', label: 'Critical result: report to the first call' },
  { key: 'reportToAck', label: 'Critical result: report to acknowledgement' },
];

const ms = (d) => (d ? new Date(d).getTime() : null);
const minutes = (a, b) => (a == null || b == null || b < a ? null : Math.round((b - a) / MIN));

/** The time of an order's first report, or null when it is not known (an amended order from before 10 Nov 2026). */
export function firstReportAt(order) {
  if (order.firstReported?.at) return ms(order.firstReported.at);
  if (!order.reported?.at) return null;
  return (order.amendments ?? []).length ? null : ms(order.reported.at);
}

/** One order's moments and stages: { orderedAt, urgent, departments, late, stages: { key: minutes | null } }. */
export function orderTimes(order) {
  const ordered = ms(order.ordered?.at);
  const report = firstReportAt(order);
  const latestReport = ms(order.reported?.at);
  const sampleKnown = order.collected?.at && !order.collectedAtReport && ms(order.collected.at) !== latestReport && ms(order.collected.at) !== report;
  const sample = sampleKnown ? ms(order.collected.at) : null;
  const review = order.source !== 'walk_in' && order.reviewed?.at ? ms(order.reviewed.at) : null;
  const critical = order.critical?.values?.length ? order.critical : null;
  const firstCall = critical?.calls?.length ? Math.min(...critical.calls.map((c) => ms(c.at))) : null;
  const ack = critical?.acknowledged?.at ? ms(critical.acknowledged.at) : null;
  return {
    orderedAt: ordered,
    urgent: Boolean(order.urgent),
    departments: [...new Set((order.tests ?? []).map((t) => (DEPARTMENT_KEYS.includes(t.department) ? t.department : 'other')))],
    // Late against the due time of its tests (lab/labSetup.js dueAt); null when it had none (older orders)
    late: order.dueAt && report != null ? report > ms(order.dueAt) : null,
    stages: {
      toSample: minutes(ordered, sample),
      sampleToReport: minutes(sample, report),
      reportToReview: minutes(latestReport, review),
      whole: minutes(ordered, report),
      reportToCall: firstCall != null && report != null ? Math.max(0, Math.round((firstCall - report) / MIN)) : null,
      reportToAck: minutes(report, ack),
    },
  };
}

const round5 = (n) => Math.round(n / 5) * 5;

/** The numbers of a set of orders for an audience (exact for doctors; protected for 'admin' and 'platform'). */
export function summariseLab(rows, audience) {
  const exact = audience === 'doctor';
  const count = (n) => (exact ? n : round5(n));
  const cell = (values) => {
    const s = spread(values);
    if (!exact && s.n < WAIT_MIN_N) return { n: s.n ? null : 0, median: null, p90: null, tooFew: s.n > 0 };
    return { n: count(s.n), median: s.median, p90: s.p90, tooFew: false };
  };
  // The share of reported orders with a due time that were late – hidden like a time below the minimum
  const lateShare = (list) => {
    const known = list.filter((r) => r.late != null);
    if (!known.length) return { late: null, tooFew: false };
    if (!exact && known.length < WAIT_MIN_N) return { late: null, tooFew: true };
    return { late: Math.round((100 * known.filter((r) => r.late).length) / known.length), tooFew: false };
  };
  const stages = LAB_STAGES.map((st) => ({ key: st.key, label: st.label, ...cell(rows.map((r) => r.stages[st.key])) }));
  const whole = (list) => ({ ...cell(list.map((r) => r.stages.whole)), lateShare: lateShare(list) });
  const groups = (keyOf, keys) => {
    const by = new Map(keys.map((k) => [k, []]));
    for (const r of rows) for (const k of [keyOf(r)].flat()) if (by.has(k)) by.get(k).push(r);
    return keys.map((k) => ({ key: k, ...whole(by.get(k)) }));
  };
  const reported = rows.filter((r) => r.stages.whole != null);
  const byUrgency = [
    { key: 'routine', label: 'Routine', ...whole(rows.filter((r) => !r.urgent)) },
    { key: 'urgent', label: 'Urgent', ...whole(rows.filter((r) => r.urgent)) },
  ];
  const byDepartment = groups((r) => r.departments, [...DEPARTMENT_KEYS.filter((k) => k !== 'other'), 'other']).filter((c) => c.n !== 0 || c.tooFew);
  const byHour = groups((r) => hourAndDay(r.orderedAt).hour, Array.from({ length: 24 }, (_, h) => h)).filter((c) => c.n !== 0 || c.tooFew);
  const byWeekday = groups((r) => hourAndDay(r.orderedAt).weekday, [1, 2, 3, 4, 5, 6, 0]);
  const monthOf = (r) => new Date(r.orderedAt).toISOString().slice(0, 7);
  const monthKeys = [...new Set(rows.map(monthOf))].sort();
  const byMonth = groups(monthOf, monthKeys).map((c) => ({ ...c, label: `${MONTH_NAMES[Number(c.key.slice(5)) - 1]} ${c.key.slice(0, 4)}` }));
  const total = rows.length;
  const share = (pred) => (total ? Math.round((100 * rows.filter(pred).length) / total) : null);
  return {
    orders: count(total),
    reported: count(reported.length),
    stages,
    late: lateShare(reported),
    byUrgency,
    byDepartment,
    byHour,
    byWeekday,
    byMonth,
    completeness: {
      sampleTimeKnown: share((r) => r.stages.toSample != null),
      reportTimeKnown: share((r) => r.stages.whole != null),
    },
  };
}

/** The orders of a hospital ordered between two hospital days (inclusive), not cancelled, with their stages. */
export async function loadLabTimes(tenantId, fromDay, toDay, { limit = 20000 } = {}) {
  const from = hospitalDayStart(utcDay(fromDay));
  const to = hospitalDayStart(new Date(utcDay(toDay).getTime() + 86400000));
  const orders = await LabOrder.find(
    { tenantId, status: { $ne: 'cancelled' }, 'ordered.at': { $gte: from, $lt: to } },
    { patientId: 1, source: 1, urgent: 1, dueAt: 1, tests: 1, ordered: 1, collected: 1, collectedAtReport: 1, reported: 1, firstReported: 1, reviewed: 1, amendments: 1, critical: 1 },
  )
    .sort({ 'ordered.at': -1 })
    .limit(limit)
    .lean();
  // P9: an order amended before firstReported existed (10 Nov 2026) takes its first report time from the audit log –
  // the earliest LAB_RESULTS_REPORTED of that order, where the log still has it; otherwise it stays out of the stages
  const lost = orders.filter((o) => !o.firstReported?.at && o.reported?.at && (o.amendments ?? []).length);
  if (lost.length) {
    const first = new Map();
    const entries = await AuditLog.find({ tenantId, action: 'LAB_RESULTS_REPORTED', 'details.orderId': { $in: lost.map((o) => String(o._id)) } }, { 'details.orderId': 1, createdAt: 1 })
      .sort({ createdAt: 1 })
      .lean();
    for (const e of entries) if (!first.has(e.details.orderId)) first.set(e.details.orderId, e.createdAt);
    for (const o of lost) if (first.has(String(o._id))) o.firstReported = { at: first.get(String(o._id)) };
  }
  return orders.map((o) => ({ patientId: String(o.patientId), ...orderTimes(o) }));
}

/** A hospital's lab times for a period, for a doctor (req: her visibility) or a hospital admin. */
export async function hospitalLabTimes(req, { audience, periodKey }) {
  const period = waitPeriod(periodKey, hospitalToday(req.now), audience);
  let rows = await loadLabTimes(req.tenantId, period.from, period.to);
  if (audience === 'doctor' && rows.length) {
    const ids = [...new Set(rows.map((r) => r.patientId))];
    const patients = await Patient.find({ tenantId: req.tenantId, _id: { $in: ids } }).select(PATIENT_FIELDS).lean();
    const visible = visibleSet(req, patients);
    rows = rows.filter((r) => visible.has(r.patientId));
  }
  return { period: { key: period.key, label: period.label, from: period.from, to: period.to }, ...summariseLab(rows, audience) };
}

/** One hospital's or every hospital's lab times for the super admin: numbers only (tenants: [{ _id, name }]). */
export async function platformLabTimes(tenants, { periodKey, now }) {
  const period = waitPeriod(periodKey, hospitalToday(now), 'platform');
  const all = [];
  const hospitals = [];
  for (const t of tenants) {
    const rows = await loadLabTimes(t._id, period.from, period.to);
    all.push(...rows);
    const s = summariseLab(rows, 'platform');
    hospitals.push({ id: String(t._id), name: t.name, orders: s.orders, stages: s.stages.map(({ key, n, median, tooFew }) => ({ key, n, median, tooFew })) });
  }
  return { period: { key: period.key, label: period.label, from: period.from, to: period.to }, ...summariseLab(all, 'platform'), hospitals };
}
