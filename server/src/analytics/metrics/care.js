// Tab "Care plans & visits": E1 care plans now, E4 done by the due date, B4 visit record complete.
// Care-plan statuses are always worked out by the plan engine (current plans through previewSync, exactly as
// the patient page would show them today – never saved), never read from stored values. Closed plans are
// never worked out again: E4 uses what was stored when they were closed.

import { addDays, isoDay, utcDay } from '../../careplans/dates.js';
import { gaAt, inRange, pidOf, usableGa } from '../facts.js';
import { activeInScope, currentPlansNow, templateItems, visitsInPeriod } from '../populations.js';
import { hashCode, hiddenFor, sets, zeros } from './util.js';

const ALL = ['doctor', 'admin', 'platform'];

/** The "applies when" of an item: the hospital's standard template's, else the item's own. */
const appliesWhenOf = (ctx, it) => templateItems(ctx).get(it.key)?.appliesWhen ?? it.appliesWhen ?? 'always';
const alwaysApplies = (ctx, it) => appliesWhenOf(ctx, it) === 'always';
const itemLabel = (ctx, key) => templateItems(ctx).get(key)?.name ?? key;

// ---------- E1 Care plans now ----------

const TOP_OVERDUE = 8;

/**
 * Each active pregnancy in scope with her current plan as it is today:
 * [{ id, cell ('noPlan' | 'onHold' | 'overdue' | 'onTrack'), missed, overdueKeys (template items overdue), overdueCount }].
 */
const planStates = (ctx) =>
  ctx.once('E1.states', () => {
    const now = currentPlansNow(ctx);
    const admin = hiddenFor(ctx, 'E.conditionalItems');
    return activeInScope(ctx).map(({ id }) => {
      const cur = now.get(id);
      if (!cur) return { id, cell: 'noPlan', missed: false, overdueKeys: [], overdueCount: 0 };
      const { plan, statuses } = cur;
      const overdue = plan.items.filter((it) => statuses.get(it)?.status === 'overdue');
      const missed = plan.items.some((it) => statuses.get(it)?.status === 'missed');
      let cell = 'onTrack';
      if (plan.status === 'paused' || plan.eddReview) cell = 'onHold';
      else if (plan.status === 'active' && overdue.length) cell = 'overdue';
      // Rows name template items only (never an item a doctor typed), and for admins only items for everyone.
      const keys = cell === 'overdue' ? [...new Set(overdue.filter((it) => it.origin === 'template' && (!admin || alwaysApplies(ctx, it))).map((it) => it.key))] : [];
      return { id, cell, missed, overdueKeys: keys, overdueCount: overdue.length };
    });
  });

/** The item keys most often overdue: [{ key, code, ids }], top 8. */
const overdueRows = (ctx) =>
  ctx.once('E1.rows', () => {
    const byKey = new Map();
    for (const s of planStates(ctx)) {
      for (const k of s.overdueKeys) {
        if (!byKey.has(k)) byKey.set(k, { key: k, code: hashCode(k), ids: new Set() });
        byKey.get(k).ids.add(s.id);
      }
    }
    const rows = [...byKey.values()].sort((a, b) => b.ids.size - a.ids.size || a.key.localeCompare(b.key));
    // The super admin gets every overdue item, so each can be added up across hospitals (another hospital's top 8
    // may differ).
    return ctx.audience === 'platform' ? rows : rows.slice(0, TOP_OVERDUE);
  });

export const E1 = {
  id: 'E1',
  section: 'care',
  order: 10,
  title: 'Care plans now',
  window: 'now',
  form: 'bars',
  scopeable: true,
  audiences: ALL,
  needs: ['patients', 'plansLight', 'plansFull', 'template'],
  uses: ['A2'],
  total: { key: 'total', code: 'c0', label: 'Active pregnancies', same: 'A2.total' },
  cells: (ctx) => [
    { key: 'noPlan', code: 'c1', label: 'No care plan', status: 'no_plan', list: true },
    { key: 'onHold', code: 'c2', label: 'On hold or paused', status: 'on_hold', list: true },
    { key: 'overdue', code: 'c3', label: 'Something overdue', status: 'overdue', list: true },
    { key: 'onTrack', code: 'c4', label: 'On track', status: 'on_track', list: true },
    { key: 'plans', code: 'c5', label: 'With a care plan', den: true, list: true },
    { key: 'missedVisits', code: 'c6', label: 'A planned visit was missed', list: true, group: 'missed' },
    ...overdueRows(ctx).map((r) => ({ key: `o:${r.code}`, code: r.code, label: itemLabel(ctx, r.key), list: true, group: 'overdueItems' })),
  ],
  virtual: ['noMissed'],
  // The "most often overdue" rows are chosen and ordered by count, and a row is only there when its count is at
  // least 1. Hospital admins get them in an order that uses only what is sent (adminView.js), and the masking
  // knows that a row that is there counts at least 1.
  rankedGroups: ['overdueItems'],
  onlyWhenCounted: ['overdueItems'],
  relations: (ctx) => [
    { total: 'total', parts: ['noPlan', 'onHold', 'overdue', 'onTrack'] },
    { total: 'plans', parts: ['onHold', 'overdue', 'onTrack'] },
    { total: 'plans', parts: ['missedVisits', 'noMissed'] },
    ...overdueRows(ctx).map((r) => ({ sub: `o:${r.code}`, sup: 'overdue' })),
  ],
  shares: [{ key: 'missed', label: 'A planned visit was missed', num: 'missedVisits', den: 'plans' }],
  list: { order: 'itemsDesc', detailLabel: 'Overdue items' },
  emptyText: 'No active pregnancies.',
  notes: (ctx) => [
    'Worked out as of today from what staff have marked.',
    'Most often overdue: each item is out of the women with something overdue.',
    ...(hiddenFor(ctx, 'E.conditionalItems') ? ['Items only for some women (for example Rh-negative mothers) are not listed for hospital admins.'] : []),
    ...(ctx.audience === 'admin' ? ['Items shown as “fewer than 5” or “Not shown” are listed from A to Z, after the others.'] : []),
  ],
  compute(ctx) {
    const out = sets('noPlan', 'onHold', 'overdue', 'onTrack', 'plans', 'missedVisits', 'noMissed');
    const details = new Map();
    for (const s of planStates(ctx)) {
      out[s.cell].add(s.id);
      if (s.cell !== 'noPlan') {
        out.plans.add(s.id);
        out[s.missed ? 'missedVisits' : 'noMissed'].add(s.id);
      }
      details.set(s.id, s.overdueCount ? { type: 'items', count: s.overdueCount } : null);
    }
    for (const r of overdueRows(ctx)) out[`o:${r.code}`] = r.ids;
    return { cells: out, details };
  },
};

// ---------- E4 Done by the due date ----------

const OUTCOMES = ['onTime', 'late', 'notNeeded', 'notDone'];
const OUTCOME_LABELS = { onTime: 'On time', late: 'Late', notNeeded: 'Not needed', notDone: 'Not done' };
// Rows under headings. 'visits' and 'other' merge many keys (their unit is items, so they open no lists).
export const E4_GROUPS = [
  { group: 'Planned visits', rows: ['visits'] },
  { group: 'Booking tests', rows: ['lab_cbc', 'lab_group', 'lab_urine', 'lab_tsh'] },
  { group: 'Infection tests', rows: ['lab_hiv', 'lab_vdrl', 'lab_hbsag'] },
  { group: 'Sugar test', rows: ['lab_ogtt1', 'lab_ogtt2'] },
  { group: 'Rh-negative mothers', rows: ['lab_ict1', 'lab_ict28', 'anti_d'], hidden: 'E4.rhGroup' },
  { group: 'Hb checks', rows: ['lab_hb28', 'lab_hb36'] },
  { group: 'Scans', rows: ['scan_dating', 'scan_nt', 'scan_anomaly', 'scan_growth32', 'scan_doppler'] },
  { group: 'Vaccines', rows: ['vacc_td1', 'vacc_td2', 'vacc_tdap', 'vacc_flu'] },
  { group: 'Medicines started', rows: ['med_folic', 'med_ifa', 'med_calcium', 'med_deworm'] },
  { group: 'Other items', rows: ['other'] },
];
const MERGED = ['visits', 'other'];
const SINGLE_KEYS = new Set(E4_GROUPS.flatMap((g) => g.rows).filter((r) => !MERGED.includes(r)));
const isAdvice = (it) => it.kind === 'advice' || String(it.key).startsWith('adv_');
const rowOf = (key) => (String(key).startsWith('visit_') ? 'visits' : SINGLE_KEYS.has(key) ? key : 'other');
const cellKey = (row, col) => `r:${row}|c:${col}`;
const E4_COLS = [...OUTCOMES, 'total', 'elsewhere'];

/** The rows this audience gets: [{ key, label, group }]. Admins get no row for only some women. */
function e4Rows(ctx) {
  const out = [];
  for (const g of E4_GROUPS) {
    if (g.hidden && hiddenFor(ctx, g.hidden)) continue;
    for (const r of g.rows) {
      if (!MERGED.includes(r) && hiddenFor(ctx, 'E.conditionalItems') && (templateItems(ctx).get(r)?.appliesWhen ?? 'always') !== 'always') continue;
      out.push({ key: r, label: r === 'visits' ? 'Planned visits' : r === 'other' ? 'Other items' : itemLabel(ctx, r), group: g.group });
    }
  }
  return out;
}

export const E4 = {
  id: 'E4',
  section: 'care',
  order: 20,
  title: 'Done by the due date',
  window: 'period',
  form: 'table',
  scopeable: true,
  audiences: ALL,
  needs: ['patients', 'plansLight', 'plansFull', 'template'],
  total: null,
  cells: (ctx) =>
    e4Rows(ctx).flatMap((r) =>
      E4_COLS.map((c) => ({
        key: cellKey(r.key, c),
        code: hashCode(cellKey(r.key, c)),
        label: `${r.label}: ${c === 'total' ? 'items due' : c === 'elsewhere' ? 'done elsewhere' : OUTCOME_LABELS[c].toLowerCase()}`,
        group: 'table',
        // Lists: only "not done" and "late" of single-item rows, where each woman has one item.
        ...(!MERGED.includes(r.key) && (c === 'notDone' || c === 'late') ? { list: true } : {}),
      })),
    ),
  relations: (ctx) =>
    e4Rows(ctx).flatMap((r) => [
      { total: cellKey(r.key, 'total'), parts: OUTCOMES.map((c) => cellKey(r.key, c)) },
      { sub: cellKey(r.key, 'elsewhere'), sup: cellKey(r.key, 'total') },
    ]),
  table: (ctx) => ({
    rows: e4Rows(ctx),
    cols: [...OUTCOMES.map((c) => ({ key: c, label: OUTCOME_LABELS[c] })), { key: 'total', label: 'Items due' }, { key: 'elsewhere', label: 'Of which done elsewhere' }],
  }),
  list: { order: 'dueAsc', detailLabel: null },
  emptyText: 'No care-plan items were due in this period.',
  notes: (ctx) => [
    "On time means by the due date in your hospital's template.",
    'Td: a booster recorded as Td-1 with Td-2 “not needed – covered” shows under Not needed.',
    'Counted: items due in the period up to yesterday, on current care plans and on plans closed in the period. On a paused or closed plan, only items due by the day it was paused or closed. Advice items are left out.',
    'In the rows for one test, scan, vaccine or medicine, each woman counts once, from her newest care plan.',
    ...(ctx.audience === 'admin' ? ['Items only for some women (for example Rh-negative mothers) are not shown to hospital admins.'] : []),
  ],
  compute(ctx) {
    const rows = e4Rows(ctx);
    const rowKeys = new Set(rows.map((r) => r.key));
    const admin = hiddenFor(ctx, 'E.conditionalItems');
    const cells = {};
    for (const r of rows) for (const c of E4_COLS) cells[cellKey(r.key, c)] = MERGED.includes(r.key) ? 0 : new Set();
    const details = new Map();
    // The list order 'dueAsc': for each listable cell, each woman's due date of the item counted (ISO day).
    const order = new Map();
    const { from } = ctx.period;
    const to = ctx.period.to < addDays(ctx.today, -1) ? ctx.period.to : addDays(ctx.today, -1);
    if (to < from) return { cells, details, order };

    // Current plans as a read would show them today; closed plans as stored. Newest first, so a woman with
    // the same item on two plans counts once, from her newest plan. Every plan has a "stop day": the day a
    // paused current plan was paused, the day a closed plan was closed (null for an active plan).
    const now = currentPlansNow(ctx);
    const closed = (ctx.data.fullPlans ?? [])
      .filter((pl) => !pl.current && pl.closed?.at && ctx.isInScope(pidOf(pl)) && ctx.hday(pl.closed.at) >= from)
      .sort((a, b) => new Date(b.closed.at) - new Date(a.closed.at));
    const plans = [
      ...[...now.values()].map((x) => ({ plan: x.plan, stopOn: x.plan.status === 'paused' ? x.pausedOn : null })),
      ...closed.map((pl) => ({ plan: pl, stopOn: ctx.hday(pl.closed.at) })),
    ];
    const seen = new Set();
    for (const { plan, stopOn } of plans) {
      // Paused on a day that is not known: the whole plan is left out (done items too), never one half of it.
      if (stopOn === undefined) continue;
      const pid = String(plan.patientId);
      for (const it of plan.items) {
        if (isAdvice(it)) continue;
        const a = it.auto ?? {};
        if (a.applies === 'no') continue;
        if (stopOn && it.state === 'open' && a.phase === 'inactive') {
          // Pausing or closing a plan makes its open items "inactive"; an item that was due by that day still
          // counts as not done, unless its window had already passed when the plan started.
          if (!it.manualDate && ['lapsed', 'covered'].includes(a.lateStart)) continue;
        } else if (['not_applicable', 'inactive', 'lapsed'].includes(a.phase)) continue;
        const dueBy = utcDay(a.dueBy);
        // On a paused or closed plan, only items due by the stop day (itself included), done and open alike.
        if (!inRange(dueBy, from, to) || (stopOn && dueBy > stopOn)) continue;
        const row = rowOf(it.key);
        if (!rowKeys.has(row)) continue;
        if (admin && MERGED.includes(row) && !alwaysApplies(ctx, it)) continue;
        let outcome = 'notDone';
        if (it.state === 'done' && it.done?.on) outcome = utcDay(it.done.on) <= dueBy ? 'onTime' : 'late';
        else if (it.state === 'not_needed') outcome = 'notNeeded';
        else if (it.state !== 'open') continue;
        const elsewhere = it.state === 'done' && Boolean(it.done?.elsewhere);
        if (MERGED.includes(row)) {
          cells[cellKey(row, outcome)] += 1;
          cells[cellKey(row, 'total')] += 1;
          if (elsewhere) cells[cellKey(row, 'elsewhere')] += 1;
          continue;
        }
        const once = `${pid}|${row}`;
        if (seen.has(once)) continue;
        seen.add(once);
        cells[cellKey(row, outcome)].add(pid);
        cells[cellKey(row, 'total')].add(pid);
        if (elsewhere) cells[cellKey(row, 'elsewhere')].add(pid);
        if (outcome === 'notDone' || outcome === 'late') {
          const ck = cellKey(row, outcome);
          if (!order.has(ck)) order.set(ck, new Map());
          order.get(ck).set(pid, isoDay(dueBy));
        }
      }
    }
    return { cells, details, order };
  },
};

// ---------- B4 Visit record complete ----------

const B4_ROWS = [
  { key: 'bp', label: 'BP (both numbers)', den: 'total', test: (v) => v.vitals?.bpSystolic != null && v.vitals?.bpDiastolic != null },
  { key: 'weight', label: 'Weight', den: 'total', test: (v) => v.vitals?.weightKg != null },
  { key: 'albumin', label: 'Urine albumin', den: 'total', test: (v) => Boolean(v.vitals?.urineAlbumin) },
  { key: 'fhr', label: 'Fetal heart rate', den: 'ga140', test: (v) => v.details?.fetalHeartRate != null },
  { key: 'fundal', label: 'Fundal height', den: 'ga140', test: (v) => v.details?.fundalHeightCm != null },
  { key: 'presentation', label: 'Presentation', den: 'ga252', test: (v) => Boolean(v.details?.presentation) },
];
const B4_DENS = { total: 'All antenatal visits', ga140: 'Visits from 20 weeks', ga252: 'Visits from 36 weeks' };

export const B4 = {
  id: 'B4',
  section: 'care',
  order: 30,
  title: 'Visit record complete',
  window: 'period',
  form: 'table',
  scopeable: true,
  audiences: ALL,
  needs: ['patients', 'windowVisits', 'visitVitals'],
  uses: ['A4'],
  // The same number as A4's antenatal visits: one global cell (section 3.5).
  total: { key: 'total', code: 'c0', label: 'Antenatal visits', same: 'A4.v:antenatal' },
  cells: [
    ...B4_ROWS.map((r, i) => ({ key: r.key, code: `c${i + 1}`, label: r.label, group: B4_DENS[r.den] })),
    { key: 'ga140', code: 'c7', label: B4_DENS.ga140, den: true },
    { key: 'ga252', code: 'c8', label: B4_DENS.ga252, den: true },
  ],
  virtual: B4_ROWS.map((r) => `${r.key}No`),
  relations: [
    ...B4_ROWS.map((r) => ({ total: r.den, parts: [r.key, `${r.key}No`] })),
    { sub: 'ga140', sup: 'total' },
    { sub: 'ga252', sup: 'ga140' },
  ],
  shares: B4_ROWS.map((r) => ({ key: r.key, label: r.label, num: r.key, den: r.den })),
  table: {
    rows: B4_ROWS.map((r) => ({ key: r.key, label: r.label, group: B4_DENS[r.den] })),
    cols: [
      { key: 'recorded', label: 'Recorded' },
      { key: 'of', label: 'Visits' },
    ],
  },
  emptyText: 'No antenatal visits in this period.',
  notes: [
    'Counted in visits, not women. Fetal heart rate and fundal height from 20 weeks, presentation from 36 weeks, by the gestation at the visit.',
    'Visits from an earlier pregnancy on the same record count only for BP, weight and urine albumin.',
  ],
  compute(ctx) {
    // The visits are A4's (visitsInPeriod): the total is A4.v:antenatal, so B4 counts no total of its own.
    const out = zeros('ga140', 'ga252', ...B4_ROWS.flatMap((r) => [r.key, `${r.key}No`]));
    for (const v of visitsInPeriod(ctx)) {
      if (v.careType !== 'antenatal') continue;
      const p = ctx.byId.get(pidOf(v));
      const ga = p ? usableGa(gaAt(p, v.visitOn)) : null;
      const dens = { total: true, ga140: Boolean(ga && ga.totalDays >= 140), ga252: Boolean(ga && ga.totalDays >= 252) };
      if (dens.ga140) out.ga140 += 1;
      if (dens.ga252) out.ga252 += 1;
      for (const r of B4_ROWS) if (dens[r.den]) out[r.test(v) ? r.key : `${r.key}No`] += 1;
    }
    return { cells: out };
  },
};

export const CARE_METRICS = [E1, E4, B4];
