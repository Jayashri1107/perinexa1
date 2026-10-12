// Tab "Pregnancy": A2 active pregnancies by trimester, A3 expected deliveries, D9 past the due date, D10 not seen
// recently, B1 when pregnancies were booked. Each card is ONE definition: the same compute() gives the number,
// the patient list, its order and its detail column (rule R4). Counts are Sets of patient ids until
// publicCards.js turns them into numbers.

import { addDays, daysBetween, isoDay, utcDay } from '../../careplans/dates.js';
import { bookingCell, bookingOf, d10Cell, trimesterKey } from '../facts.js';
import { dayMonthLabel } from '../period.js';
import { activeInScope } from '../populations.js';
import { sets } from './util.js';

const ALL = ['doctor', 'admin', 'platform'];
const gaDetail = (ga) => (ga ? { type: 'ga', weeks: ga.weeks, days: ga.days } : null);

export const A2 = {
  id: 'A2',
  section: 'pregnancy',
  order: 10,
  title: 'Active pregnancies by trimester',
  window: 'now',
  form: 'bars',
  scopeable: true,
  audiences: ALL,
  needs: ['patients', 'plansLight'],
  total: { key: 'total', code: 'c0', label: 'Active pregnancies', list: true },
  cells: [
    { key: 't1', code: 'c1', label: 'First trimester', sub: 'up to 13 w 6 d', list: true },
    { key: 't2', code: 'c2', label: 'Second trimester', sub: '14 w 0 d – 27 w 6 d', list: true },
    { key: 't3', code: 'c3', label: 'Third trimester', sub: 'from 28 w 0 d', list: true },
    { key: 'check', code: 'c4', label: 'Dates to check', sub: 'EDD more than 40 weeks away', unknown: true, list: true },
    { key: 'noEdd', code: 'c5', label: 'EDD not recorded', unknown: true, list: true },
  ],
  virtual: ['ga196_251'],
  relations: [{ total: 'total', parts: ['t1', 't2', 't3', 'check', 'noEdd'] }],
  list: { order: 'gaDesc', detailLabel: 'Gestation today' },
  emptyText: 'No active pregnancies.',
  notes: ['Active: an antenatal record whose EDD is at most 4 weeks ago, or a record made in the last 44 weeks with no EDD yet. Women whose care plan was closed for this pregnancy are not counted.'],
  compute(ctx) {
    const out = sets('total', 't1', 't2', 't3', 'check', 'noEdd', 'ga196_251');
    const details = new Map();
    for (const { id, edd, ga } of activeInScope(ctx)) {
      const key = !edd ? 'noEdd' : trimesterKey(ga);
      out.total.add(id);
      out[key].add(id);
      if (ga && ga.totalDays >= 196 && ga.totalDays < 252) out.ga196_251.add(id);
      details.set(id, gaDetail(ga));
    }
    return { cells: out, details };
  },
};

const WEEKS = Array.from({ length: 12 }, (_, i) => i + 1);

export const A3 = {
  id: 'A3',
  section: 'pregnancy',
  order: 20,
  title: 'Expected deliveries, next 12 weeks',
  window: 'now',
  form: 'columns',
  scopeable: true,
  audiences: ALL,
  needs: ['patients', 'plansLight'],
  total: { key: 'total12', code: 'c0', label: 'Due in the next 12 weeks', list: true },
  cells: (ctx) => [
    ...WEEKS.map((k) => ({ key: `w${k}`, code: `c${k}`, label: dayMonthLabel(addDays(ctx.today, 7 * (k - 1))), sub: `week ${k}`, list: true, group: 'weeks' })),
    { key: 'next4', code: 'c13', label: 'Due in the next 4 weeks', list: true, group: 'summary' },
  ],
  relations: [
    { total: 'total12', parts: WEEKS.map((k) => `w${k}`) },
    { total: 'next4', parts: ['w1', 'w2', 'w3', 'w4'] },
  ],
  trend: { cells: WEEKS.map((k) => `w${k}`), color: 'scheduled' },
  list: { order: 'eddAsc', detailLabel: 'EDD' },
  emptyText: 'No deliveries expected in the next 12 weeks.',
  notes: ['EDD from the scan if recorded, otherwise from the LMP.'],
  compute(ctx) {
    const out = sets('total12', 'next4', ...WEEKS.map((k) => `w${k}`));
    const details = new Map();
    for (const { id, edd } of activeInScope(ctx)) {
      if (!edd) continue;
      const d = daysBetween(ctx.today, edd);
      if (d < 0 || d > 83) continue;
      const k = Math.floor(d / 7) + 1;
      out[`w${k}`].add(id);
      out.total12.add(id);
      if (k <= 4) out.next4.add(id);
      details.set(id, { type: 'edd', on: isoDay(edd) });
    }
    return { cells: out, details };
  },
};

export const D9 = {
  id: 'D9',
  section: 'pregnancy',
  order: 30,
  title: 'Past the due date – still recorded as pregnant',
  window: 'now',
  form: 'bars',
  scopeable: true,
  audiences: ALL,
  needs: ['patients', 'plansLight'],
  uses: ['DQ'], // the footnote is DQ.dq1 itself: one global cell, protected once
  total: { key: 'total', code: 'c0', label: 'Past the due date', list: true },
  cells: [
    { key: 'p40', code: 'c1', label: '40 w 1 d – 40 w 6 d', list: true },
    { key: 'p41', code: 'c2', label: '41 w', list: true },
    { key: 'p42', code: 'c3', label: '42 w 0 d – 44 w 0 d', list: true },
    // "n more records are older than 44 weeks – see Records to tidy up": a line under the bars, never a bar.
    { key: 'older44', code: 'c4', label: 'More records older than 44 weeks – see Records to tidy up', same: 'DQ.dq1', group: 'footnote' },
  ],
  relations: [{ total: 'total', parts: ['p40', 'p41', 'p42'] }], // the footnote is outside the partition
  list: { order: 'eddAsc', detailLabel: 'Gestation today' },
  emptyText: 'No active pregnancy is past the due date.',
  notes: ['Women whose care plan was closed as delivered are not counted here.'],
  compute(ctx) {
    const out = sets('total', 'p40', 'p41', 'p42');
    const details = new Map();
    for (const { id, edd, ga } of activeInScope(ctx)) {
      if (!edd || edd >= ctx.today) continue;
      const late = daysBetween(edd, ctx.today); // 1 … 28 for an active pregnancy
      const key = late <= 6 ? 'p40' : late <= 13 ? 'p41' : 'p42';
      out.total.add(id);
      out[key].add(id);
      details.set(id, gaDetail(ga));
    }
    return { cells: out, details };
  },
};

export const D10 = {
  id: 'D10',
  section: 'pregnancy',
  order: 40,
  title: 'Not seen recently',
  window: 'now',
  form: 'bars',
  scopeable: true,
  audiences: ALL,
  needs: ['patients', 'plansLight', 'visitSummary'],
  uses: ['A2'],
  total: { key: 'total', code: 'c0', label: 'Active pregnancies', same: 'A2.total' },
  cells: [
    { key: 'neverSeen', code: 'c1', label: 'Never seen', list: true },
    { key: 'waitingFirst', code: 'c2', label: 'Registered in the last 14 days, first visit not yet' },
    { key: 'missedAppt', code: 'c3', label: 'Missed the next visit date', list: true },
    { key: 'gap', code: 'c4', label: 'No visit for too long', list: true },
    { key: 'ok', code: 'c5', label: 'Seen recently, or next visit not due yet' },
  ],
  relations: [{ total: 'total', parts: ['neverSeen', 'waitingFirst', 'missedAppt', 'gap', 'ok'] }],
  list: { order: 'lastVisitAsc', detailLabel: 'Last visit' },
  emptyText: 'No active pregnancies.',
  notes: [
    'Based on the usual schedule: monthly to 28 weeks, every 2 weeks to 36 weeks, then weekly.',
    'Missed: the next visit date given at the last visit has passed by more than 7 days (3 days from 36 weeks).',
  ],
  compute(ctx) {
    const out = sets('neverSeen', 'waitingFirst', 'missedAppt', 'gap', 'ok');
    const details = new Map();
    for (const { p, id } of activeInScope(ctx)) {
      const key = d10Cell(p, ctx);
      out[key].add(id);
      const last = ctx.summaryOf(p)?.lastOn;
      details.set(id, last ? { type: 'lastVisit', on: isoDay(utcDay(last)) } : null);
    }
    return { cells: out, details };
  },
};

export const B1 = {
  id: 'B1',
  section: 'pregnancy',
  order: 50,
  title: 'When pregnancies were booked',
  window: 'period',
  form: 'bars',
  scopeable: true,
  audiences: ALL,
  needs: ['patients', 'plansLight', 'visitSummary'],
  total: { key: 'total', code: 'c0', label: 'Pregnancies booked', list: true },
  cells: [
    { key: 'lt12', code: 'c1', label: 'Before 12 weeks', sub: 'up to 11 w 6 d', list: true },
    { key: 'w12_19', code: 'c2', label: '12 to 19 weeks', list: true },
    { key: 'w20_27', code: 'c3', label: '20 to 27 weeks', list: true },
    { key: 'w28p', code: 'c4', label: '28 weeks or later', list: true },
    { key: 'unknown', code: 'c5', label: 'Gestation not known', unknown: true, list: true },
    { key: 'known', code: 'c6', label: 'Gestation known', list: true, den: true },
  ],
  relations: [
    { total: 'total', parts: ['known', 'unknown'] },
    { total: 'known', parts: ['lt12', 'w12_19', 'w20_27', 'w28p'] },
  ],
  shares: [{ key: 'first', label: 'Booked before 12 weeks', num: 'lt12', den: 'known' }],
  list: { order: 'bookedDesc', detailLabel: 'Booked at' },
  emptyText: 'No pregnancies were booked in this period.',
  notes: ['Booking date as recorded on the care plan.', 'A second pregnancy on the same record counts again when its new care plan is booked.'],
  compute(ctx) {
    const out = sets('total', 'lt12', 'w12_19', 'w20_27', 'w28p', 'unknown', 'known');
    const details = new Map();
    const { from, to } = ctx.period;
    for (const p of ctx.patientsInScope) {
      const b = bookingOf(p, ctx, from, to);
      if (!b) continue;
      const id = String(p._id);
      const key = bookingCell(b.ga);
      out.total.add(id);
      out[key].add(id);
      if (key !== 'unknown') out.known.add(id);
      details.set(id, { type: 'booked', weeks: b.ga?.weeks ?? null, days: b.ga?.days ?? null, on: isoDay(b.on) });
    }
    return { cells: out, details };
  },
};

export const PREGNANCY_METRICS = [A2, A3, D9, D10, B1];
