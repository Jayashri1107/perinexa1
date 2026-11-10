// Analytics → Waiting times (owner's decisions of 10 Nov 2026 – docs/PATIENT_FLOW_PLAN.md section 6).
//
// The time each stage of an outpatient's day takes (visits/flow.js), by stage, by hour of arrival, by weekday and by
// month. Stages only – never split by a named person (decision 6). Its own page, not a card of the Analytics tabs: the
// tabs' protection (mask.js) is built for counts, and durations stay out of it so that it is left exactly as it was.
// Who sees what (decision 3, developer's decision of 10 Nov 2026 for perinexa1):
//  - doctor: exact numbers, the current month too, and only the visits of patients whose clinical details she may see
//    (analytics/visibility.js – the need-to-know rule of every Analytics tab);
//  - hospital admin: whole finished months only; a usual or slow time only from WAIT_MIN_N visits, otherwise "Too few
//    visits to show"; visit counts rounded to the nearest 5; never a patient, a name or a list;
//  - super admin: the same as the hospital admin, per hospital and for all hospitals together (platform route).
// No patient lists in this first version.

import { DAY, hospitalToday, utcDay } from '../careplans/dates.js';
import { Patient } from '../models/Patient.js';
import { STAGES, hourAndDay, loadFlows, spread } from '../visits/flow.js';
import { PATIENT_FIELDS } from './load.js';
import { visibleSet } from './visibility.js';

export const WAIT_MIN_N = 10; // hospital admin and super admin: a usual or slow time only from this many visits

/** The periods: last finished month, last 3 or 12 finished months; doctors also "this month so far". */
export const WAIT_PERIODS = {
  month: { label: 'This month so far', doctorOnly: true },
  last: { label: 'Last month' },
  '3m': { label: 'Last 3 months' },
  '12m': { label: 'Last 12 months' },
};

const monthStart = (y, m) => new Date(Date.UTC(y, m, 1));
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** { key, label, from, to } (hospital days, inclusive) for a period at "today". Unknown periods: the default. */
export function waitPeriod(key, today, audience) {
  const k = WAIT_PERIODS[key] && !(WAIT_PERIODS[key].doctorOnly && audience !== 'doctor') ? key : audience === 'doctor' ? 'month' : 'last';
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const thisMonth = monthStart(y, m);
  const lastDay = new Date(thisMonth.getTime() - DAY);
  if (k === 'month') return { key: k, label: WAIT_PERIODS[k].label, from: thisMonth, to: utcDay(today) };
  const months = k === 'last' ? 1 : k === '3m' ? 3 : 12;
  return { key: k, label: WAIT_PERIODS[k].label, from: monthStart(y, m - months), to: lastDay };
}

const round5 = (n) => Math.round(n / 5) * 5;

/**
 * The numbers of one set of visits for an audience: { visits, stages: [{ key, label, wait, n, median, p90, tooFew }],
 * longest, byHour, byWeekday, byMonth, completeness }. Exact for doctors; for 'admin' and 'platform' a time only from
 * WAIT_MIN_N visits and counts rounded to 5.
 */
export function summarise(rows, audience) {
  const exact = audience === 'doctor';
  const count = (n) => (exact ? n : round5(n));
  const cell = (values) => {
    const s = spread(values);
    if (!exact && s.n < WAIT_MIN_N) return { n: s.n ? null : 0, median: null, p90: null, tooFew: s.n > 0 };
    return { n: count(s.n), median: s.median, p90: s.p90, tooFew: false };
  };
  const stages = STAGES.map((st) => ({ key: st.key, label: st.label, wait: st.wait, ...cell(rows.map((r) => r.stages[st.key])) }));
  const waits = stages.filter((s) => s.wait && s.median != null);
  const longest = waits.length ? waits.reduce((a, b) => (b.median > a.median ? b : a)).key : null;
  // The whole visit by hour of arrival and by weekday (hospital time), and by month
  const groups = (keyOf, keys) => {
    const by = new Map(keys.map((k) => [k, []]));
    for (const r of rows) {
      if (r.moments.arrived == null) continue;
      const k = keyOf(r);
      if (by.has(k)) by.get(k).push(r.stages.whole);
    }
    return keys.map((k) => ({ key: k, ...cell(by.get(k)) }));
  };
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const byHour = groups((r) => hourAndDay(r.moments.arrived).hour, hours).filter((c) => c.n !== 0 || c.tooFew);
  const byWeekday = groups((r) => hourAndDay(r.moments.arrived).weekday, [1, 2, 3, 4, 5, 6, 0]);
  const monthKeys = [...new Set(rows.map((r) => utcDay(r.visitOn).toISOString().slice(0, 7)))].sort();
  const byMonth = groups((r) => utcDay(r.visitOn).toISOString().slice(0, 7), monthKeys).map((c) => ({ ...c, label: `${MONTH_NAMES[Number(c.key.slice(5)) - 1]} ${c.key.slice(0, 4)}` }));
  // How complete the numbers are: the share of visits with each habit (section 6 of the plan)
  const total = rows.length;
  const share = (pred) => (total ? Math.round((100 * rows.filter(pred).length) / total) : null);
  const completeness = {
    arrivalMarked: share((r) => r.moments.arrived != null),
    finishedSameDay: share((r) => r.moments.finished != null),
    withSale: share((r) => r.moments.sold != null),
  };
  return { visits: count(total), stages, longest, byHour, byWeekday, byMonth, completeness };
}

/** A hospital's waiting times for a period, for a doctor (req: her visibility) or a hospital admin. */
export async function hospitalWaitingTimes(req, { audience, periodKey }) {
  const today = hospitalToday(req.now);
  const period = waitPeriod(periodKey, today, audience);
  let rows = await loadFlows(req.tenantId, period.from, period.to);
  if (audience === 'doctor' && rows.length) {
    const ids = [...new Set(rows.map((r) => r.patientId))];
    const patients = await Patient.find({ tenantId: req.tenantId, _id: { $in: ids } }).select(PATIENT_FIELDS).lean();
    const visible = visibleSet(req, patients);
    rows = rows.filter((r) => visible.has(r.patientId));
  }
  return { period: { key: period.key, label: period.label, from: period.from, to: period.to }, ...summarise(rows, audience) };
}

/** One hospital's or every hospital's waiting times for the super admin: numbers only (tenants: [{ _id, name }]). */
export async function platformWaitingTimes(tenants, { periodKey, now }) {
  const today = hospitalToday(now);
  const period = waitPeriod(periodKey, today, 'platform');
  const all = [];
  const hospitals = [];
  for (const t of tenants) {
    const rows = await loadFlows(t._id, period.from, period.to);
    all.push(...rows);
    const s = summarise(rows, 'platform');
    hospitals.push({ id: String(t._id), name: t.name, visits: s.visits, stages: s.stages.map(({ key, n, median, tooFew }) => ({ key, n, median, tooFew })) });
  }
  return { period: { key: period.key, label: period.label, from: period.from, to: period.to }, ...summarise(all, 'platform'), hospitals };
}
