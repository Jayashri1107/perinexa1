// Tab "Overview": the headline tiles, A1 new registrations, A4 visits, V1 other care, DQ records to tidy up.
// The type-of-care filter (ctx.careType) changes only A1 and A4 (the cells per type never change with it, so a
// number shown in V1 is always the same number as in A1 and A4). Under a filter the per-type cells stay defined
// (V1 and DQ use them), but are marked offCard: they are not sent on A1 or A4, and never open a list from there.

import { bucketKeyOfDate } from '../period.js';
import { isoDay } from '../../careplans/dates.js';
import { pidOf, sameId } from '../facts.js';
import { activeInScope, cancelledInPeriod, closedStillAntenatalInScope, olderInScope, registrationsInPeriod, visitsInPeriod } from '../populations.js';
import { bucketCode, sets, zeros } from './util.js';

const ALL = ['doctor', 'admin', 'platform'];
// New types go at the END: cell codes and list links follow this order.
export const CARE_TYPE_KEYS = ['antenatal', 'postnatal', 'infertility', 'gynaecology', 'newborn', 'abortion'];
const TYPE_LABELS = { antenatal: 'Antenatal', postnatal: 'Postnatal', infertility: 'Infertility', gynaecology: 'Gynaecology', newborn: 'Newborn', abortion: 'Abortion' };
// A4's per-type cell codes (c8 is "all visits", so Abortion, added later, is c9)
const A4_CODE = { antenatal: 'c3', postnatal: 'c4', infertility: 'c5', gynaecology: 'c6', newborn: 'c7', abortion: 'c9' };

/** Trend cells (one per bucket of the period): keys 'b:m:2026-10' or 'b:w:2026-10-12'. */
export const trendKeys = (ctx) => ctx.period.buckets.map((b) => `b:${b.key}`);
export const trendCells = (ctx) =>
  ctx.period.buckets.map((b) => ({ key: `b:${b.key}`, code: bucketCode(`b:${b.key}`), label: b.label, partial: b.partial, group: 'trend' }));
const bucketOf = (ctx, date) => `b:${bucketKeyOfDate(date, ctx.period.kind)}`;
const filtered = (ctx) => ctx.careType && ctx.careType !== 'all';

/**
 * Headline tiles on Overview. Each shows a cell of another card, filled in by the server, so the two numbers
 * are always the same. A tile whose card is not built yet is left out.
 */
export const HEADLINE_TILES = [
  { ref: 'A2.total', label: 'Active pregnancies', window: 'now' },
  { ref: 'A3.next4', label: 'Due in the next 4 weeks', window: 'now' },
  { ref: 'C1.high', label: 'High-risk pregnancies', window: 'now', tone: 'high' },
  { ref: 'B1.total', label: 'Pregnancies booked', window: 'period' },
  { ref: 'A4.all', label: 'Visits', window: 'period' }, // every visit: the type-of-care filter never changes a tile
  { ref: 'G1.total', label: 'Babies registered', sub: 'born in the period', window: 'period' },
];

export const A1 = {
  id: 'A1',
  section: 'overview',
  order: 10,
  group: 'Registrations and visits',
  title: 'New registrations by type of care',
  window: 'period',
  form: 'bars',
  scopeable: true,
  careTypeFilter: true,
  // The cells whose number changes with the type-of-care filter (the admin view keeps one number per filter).
  filteredCells: (key) => key === 'total' || key.startsWith('b:'),
  audiences: ALL,
  needs: ['patients', 'visitSummary'],
  total: { key: 'total', code: 'c0', label: 'New registrations', list: true },
  cells: (ctx) => [
    ...CARE_TYPE_KEYS.map((t, i) => ({ key: t, code: `c${i + 1}`, label: TYPE_LABELS[t], list: true, ...(filtered(ctx) && t !== ctx.careType ? { offCard: true } : {}) })),
    ...trendCells(ctx),
  ],
  relations: (ctx) => [
    { total: 'total', parts: filtered(ctx) ? [ctx.careType] : CARE_TYPE_KEYS },
    { total: 'total', parts: trendKeys(ctx) },
  ],
  trend: (ctx) => ({ cells: trendKeys(ctx), color: 'bar' }),
  list: { order: 'createdDesc', detailLabel: null },
  emptyText: 'No new registrations in this period.',
  notes: ['Type of care at the first visit; for patients not seen yet, their type of care now.', 'A new record is not the same as a new pregnancy – see Pregnancies booked.'],
  compute(ctx) {
    const out = sets('total', ...CARE_TYPE_KEYS, ...trendKeys(ctx));
    for (const r of registrationsInPeriod(ctx)) {
      out[r.type].add(r.id); // per type: never changed by the filter
      if (filtered(ctx) && r.type !== ctx.careType) continue;
      out.total.add(r.id);
      out[bucketOf(ctx, r.on)].add(r.id);
    }
    return { cells: out, details: new Map() };
  },
};

const VISIT_TYPES = CARE_TYPE_KEYS.map((t) => `v:${t}`);
// Whether a visit is its patient's first, worked out once per loaded visit (the hospital admin's view reads the
// same visits under every period and filter). Kept under a symbol, so it is never sent.
const FIRST = Symbol('first visit');
const isFirstVisit = (ctx, v) => v[FIRST] ?? (v[FIRST] = sameId(ctx.summaryById(pidOf(v))?.firstId, v._id));

export const A4 = {
  id: 'A4',
  section: 'overview',
  order: 20,
  group: 'Registrations and visits',
  title: 'Visits: new and follow-up',
  window: 'period',
  form: 'tiles',
  scopeable: true,
  careTypeFilter: true,
  // The cells whose number changes with the type-of-care filter (the admin view keeps one number per filter).
  filteredCells: (key) => ['total', 'new', 'followUp'].includes(key) || key.startsWith('b:'),
  audiences: ALL,
  needs: ['patients', 'visitSummary', 'windowVisits'],
  total: { key: 'total', code: 'c0', label: 'Visits' },
  cells: (ctx) => [
    { key: 'new', code: 'c1', label: 'New', sub: "the patient's first visit", group: 'kind' },
    { key: 'followUp', code: 'c2', label: 'Follow-up', group: 'kind' },
    ...CARE_TYPE_KEYS.map((t) => ({ key: `v:${t}`, code: A4_CODE[t], label: TYPE_LABELS[t], group: 'type', ...(filtered(ctx) ? { offCard: true } : {}) })),
    // Every visit in the period, whatever the filter: the headline tile and DQ's "visits recorded" use it.
    { key: 'all', code: 'c8', label: 'Visits', offCard: true },
    ...trendCells(ctx),
  ],
  relations: (ctx) => [
    { total: 'total', parts: ['new', 'followUp'] },
    { total: 'total', parts: trendKeys(ctx) },
    { total: 'total', parts: filtered(ctx) ? [`v:${ctx.careType}`] : VISIT_TYPES },
    { total: 'all', parts: VISIT_TYPES },
  ],
  trend: (ctx) => ({ cells: trendKeys(ctx), color: 'bar' }),
  emptyText: 'No visits in this period.',
  notes: ['Visits marked “entered in error” are not counted.'],
  compute(ctx) {
    const out = zeros('total', 'new', 'followUp', 'all', ...VISIT_TYPES, ...trendKeys(ctx));
    for (const v of visitsInPeriod(ctx)) {
      out.all += 1; // every visit, and per type: never changed by the filter
      out[`v:${v.careType}`] += 1;
      if (filtered(ctx) && v.careType !== ctx.careType) continue;
      const first = isFirstVisit(ctx, v);
      out[first ? 'new' : 'followUp'] += 1;
      out.total += 1;
      out[bucketOf(ctx, v.visitOn)] += 1;
    }
    return { cells: out };
  },
};

const OTHER_CARE = ['postnatal', 'gynaecology', 'infertility', 'abortion'];

export const V1 = {
  id: 'V1',
  section: 'overview',
  order: 30,
  title: 'Other care: postnatal, gynaecology, infertility and abortion',
  window: 'period',
  form: 'table',
  scopeable: true,
  audiences: ALL,
  needs: ['patients', 'visitSummary', 'windowVisits'],
  uses: ['A1', 'A4'],
  total: null,
  cells: OTHER_CARE.flatMap((t, i) => [
    // The same numbers as the matching cells of A1 and A4 (one global cell each).
    { key: `r:${t}|c:registered`, code: `c${i * 3 + 1}`, label: `${TYPE_LABELS[t]}: registered`, same: `A1.${t}`, group: 'table' },
    { key: `r:${t}|c:visits`, code: `c${i * 3 + 2}`, label: `${TYPE_LABELS[t]}: visits`, same: `A4.v:${t}`, group: 'table' },
    { key: `r:${t}|c:seen`, code: `c${i * 3 + 3}`, label: `${TYPE_LABELS[t]}: patients seen`, list: true, group: 'table' },
  ]),
  table: {
    rows: OTHER_CARE.map((t) => ({ key: t, label: TYPE_LABELS[t], group: null })),
    cols: [
      { key: 'registered', label: 'Registered as this type' },
      { key: 'visits', label: 'Visits of this type' },
      { key: 'seen', label: 'Patients seen for this type' },
    ],
  },
  list: { order: 'lastVisitDesc', detailLabel: 'Last visit' },
  emptyText: 'No postnatal, gynaecology, infertility or abortion care in this period.',
  notes: [
    'Registered uses the type of care at the first visit. Visits and patients seen use the type of each visit.',
    'Only counts are recorded for these types of care in this version.',
  ],
  compute(ctx) {
    const out = sets(...OTHER_CARE.map((t) => `r:${t}|c:seen`));
    const details = new Map();
    for (const v of visitsInPeriod(ctx)) {
      if (!OTHER_CARE.includes(v.careType)) continue;
      const id = pidOf(v);
      out[`r:${v.careType}|c:seen`].add(id);
      details.set(id, { type: 'lastVisit', on: isoDay(v.visitOn) }); // visits are oldest first: the last one wins
    }
    return { cells: out, details };
  },
};

export const DQ = {
  id: 'DQ',
  section: 'overview',
  order: 40,
  title: 'Records to tidy up',
  window: 'mixed',
  form: 'tiles',
  scopeable: true,
  audiences: ALL,
  needs: ['patients', 'plansLight', 'windowVisits', 'cancelled'],
  uses: ['A2', 'A4', 'G1'],
  total: null,
  cells: [
    {
      key: 'dq1',
      code: 'c1',
      label: 'Antenatal records older than 44 weeks',
      window: 'now',
      list: true,
      tip: 'When the baby is born, change the type of care to postnatal or close the care plan.',
    },
    { key: 'dq5', code: 'c2', label: 'Care plan closed, still marked antenatal', window: 'now', list: true, tip: 'Change the type of care to postnatal, or reopen the care plan.' },
    { key: 'dq2', code: 'c3', label: 'Antenatal records with no EDD', window: 'now', list: true, same: 'A2.noEdd' },
    { key: 'dq3', code: 'c4', label: 'Babies registered in the period with no mother linked', window: 'period', list: true, same: 'G1.noMother' },
    { key: 'dq4', code: 'c5', label: 'Visits marked “entered in error” in the period', window: 'period' },
    { key: 'antenatalRecords', code: 'c6', label: 'Antenatal records', window: 'now', den: true },
    { key: 'active', code: 'c7', label: 'Active pregnancies', window: 'now', den: true, same: 'A2.total' },
    { key: 'babies', code: 'c8', label: 'Babies registered in the period', window: 'period', den: true, same: 'G1.total' },
    { key: 'allVisits', code: 'c9', label: 'Visits recorded in the period', window: 'period', den: true },
  ],
  // Babies: G1 declares total = linked + noMother. The visits not entered in error are A4.all (never filtered).
  relations: [
    { total: 'antenatalRecords', parts: ['active', 'dq1', 'dq5'] },
    { total: 'allVisits', parts: ['A4.all', 'dq4'] },
  ],
  shares: [
    { key: 'dq1', label: 'Older than 44 weeks', num: 'dq1', den: 'antenatalRecords' },
    { key: 'dq5', label: 'Care plan closed, still antenatal', num: 'dq5', den: 'antenatalRecords' },
    { key: 'dq2', label: 'No EDD', num: 'dq2', den: 'active' },
    { key: 'dq3', label: 'No mother linked', num: 'dq3', den: 'babies' },
    { key: 'dq4', label: 'Entered in error', num: 'dq4', den: 'allVisits' },
  ],
  list: { order: 'eddAsc', detailLabel: 'EDD' },
  emptyText: 'Nothing to tidy up.',
  notes: [],
  compute(ctx) {
    const out = sets('dq1', 'dq5', 'antenatalRecords');
    const details = new Map();
    const eddDetail = (p) => (p.pregnancy?.effectiveEdd ? { type: 'edd', on: isoDay(p.pregnancy.effectiveEdd) } : null);
    for (const p of olderInScope(ctx)) {
      out.dq1.add(String(p._id));
      details.set(String(p._id), eddDetail(p));
    }
    for (const p of closedStillAntenatalInScope(ctx)) {
      out.dq5.add(String(p._id));
      details.set(String(p._id), eddDetail(p));
    }
    for (const x of [...activeInScope(ctx).map((a) => a.id), ...out.dq1, ...out.dq5]) out.antenatalRecords.add(x);
    const dq4 = cancelledInPeriod(ctx).length;
    return { cells: { ...out, dq4, allVisits: visitsInPeriod(ctx).length + dq4 }, details };
  },
};

export const OVERVIEW_METRICS = [A1, A4, V1, DQ];
