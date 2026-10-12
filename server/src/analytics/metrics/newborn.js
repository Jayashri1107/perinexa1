// Tab "Newborn": G1 babies registered, G3 birth weight, G6 gestation at birth. (Card G2 has its own file,
// metrics/sexAtBirth.js, the only one that reads that field.)
// Population: babies already born, in scope, whose birth (hospital date) falls in the period. For doctors,
// only babies whose clinical details they may see; under "My patients", babies assigned to them or whose
// mother is.

import { bucketKeyOfDate } from '../period.js';
import { babyEdd, birthGaCell, idOf, isBornBaby, median, weightCell } from '../facts.js';
import { gaOn } from '../../careplans/dates.js';
import { babiesInPeriod } from '../populations.js';
import { trendCells, trendKeys } from './overview.js';
import { sets } from './util.js';

const ALL = ['doctor', 'admin', 'platform'];
const MULTIPLE_MS = 24 * 3600_000;

// ---------- G1 Babies registered ----------

export const G1 = {
  id: 'G1',
  section: 'newborn',
  order: 10,
  title: 'Babies registered, by month of birth',
  window: 'period',
  form: 'columns',
  scopeable: true,
  audiences: ALL,
  needs: ['patients'],
  total: { key: 'total', code: 'c0', label: 'Babies registered', sub: 'born in the period', list: true },
  cells: (ctx) => [
    { key: 'noMother', code: 'c1', label: 'No mother linked', unknown: true, list: true },
    { key: 'linked', code: 'c2', label: 'Mother linked', den: true },
    { key: 'multiple', code: 'c3', label: 'Born as twins or more', list: true },
    ...trendCells(ctx),
  ],
  virtual: ['single'],
  relations: (ctx) => [
    { total: 'total', parts: ['linked', 'noMother'] },
    { total: 'total', parts: trendKeys(ctx) },
    { total: 'linked', parts: ['multiple', 'single'] },
  ],
  trend: (ctx) => ({ cells: trendKeys(ctx), color: 'bar' }),
  shares: [{ key: 'multiple', label: 'Born as twins or more', num: 'multiple', den: 'linked' }],
  list: { order: 'bornDesc', detailLabel: null },
  emptyText: 'No babies were registered as born in this period.',
  notes: [
    'Babies registered in Perinexa. This can include babies born elsewhere and registered later, so past months can still change. Stillbirths are not recorded.',
    'Twins or more: babies of the same linked mother born within 24 hours of each other.',
  ],
  compute(ctx) {
    const out = sets('total', 'linked', 'noMother', 'multiple', 'single', ...trendKeys(ctx));
    // Born babies of each linked mother (babies whose details this person may see), for twins or more.
    const byMother = new Map();
    for (const b of ctx.data.patients) {
      if (!isBornBaby(b, ctx.now) || !b.newborn.mother || (ctx.visible && !ctx.visible.has(idOf(b)))) continue;
      const k = String(b.newborn.mother);
      if (!byMother.has(k)) byMother.set(k, []);
      byMother.get(k).push(b);
    }
    for (const { p, id, on } of babiesInPeriod(ctx)) {
      out.total.add(id);
      out[`b:${bucketKeyOfDate(on, ctx.period.kind)}`].add(id);
      if (!p.newborn.mother) {
        out.noMother.add(id);
        continue;
      }
      out.linked.add(id);
      const born = new Date(p.newborn.birthAt).getTime();
      const twin = (byMother.get(String(p.newborn.mother)) ?? []).some((b) => b !== p && Math.abs(new Date(b.newborn.birthAt).getTime() - born) <= MULTIPLE_MS);
      out[twin ? 'multiple' : 'single'].add(id);
    }
    return { cells: out };
  },
};

// ---------- G3 Birth weight ----------

const WEIGHT_CELLS = ['elbw', 'vlbw', 'lbw', 'normal', 'macro'];
export const MEDIAN_MIN_N = 5; // hospital admins and the super admin: a median only from 5 babies
const MEDIAN_ROUND_PLATFORM = 50;

export const G3 = {
  id: 'G3',
  section: 'newborn',
  order: 30,
  title: 'Birth weight',
  window: 'period',
  form: 'bars',
  scopeable: true,
  audiences: ALL,
  needs: ['patients'],
  uses: ['G1'],
  total: { key: 'total', code: 'c0', label: 'Babies registered', same: 'G1.total' },
  cells: [
    { key: 'elbw', code: 'c1', label: 'Under 1,000 g', list: true },
    { key: 'vlbw', code: 'c2', label: '1,000 to 1,499 g', list: true },
    { key: 'lbw', code: 'c3', label: '1,500 to 2,499 g', list: true },
    { key: 'normal', code: 'c4', label: '2,500 to 3,999 g', list: true },
    { key: 'macro', code: 'c5', label: '4,000 g or more', list: true },
    { key: 'notWeighed', code: 'c6', label: 'Not weighed or not recorded', unknown: true, list: true },
    { key: 'weighed', code: 'c7', label: 'Weighed at birth', den: true, list: true },
    { key: 'low', code: 'c8', label: 'Under 2,500 g', list: true },
  ],
  relations: [
    { total: 'total', parts: ['weighed', 'notWeighed'] },
    { total: 'weighed', parts: WEIGHT_CELLS },
    { total: 'low', parts: ['elbw', 'vlbw', 'lbw'] },
  ],
  shares: [
    { key: 'weighed', label: 'Weighed at birth', num: 'weighed', den: 'total' },
    { key: 'low', label: 'Under 2,500 g', num: 'low', den: 'weighed' },
  ],
  list: { order: 'gramsAsc', detailLabel: 'Birth weight' },
  emptyText: 'No babies were registered as born in this period.',
  notes: ['Weight as recorded on the baby’s record.'],
  compute(ctx) {
    const out = sets('weighed', 'low', 'notWeighed', ...WEIGHT_CELLS);
    const details = new Map();
    const weights = [];
    for (const { p, id } of babiesInPeriod(ctx)) {
      const g = p.newborn?.birthWeightGrams ?? null;
      const cell = weightCell(g);
      out[cell].add(id);
      if (cell === 'notWeighed') continue;
      out.weighed.add(id);
      if (['elbw', 'vlbw', 'lbw'].includes(cell)) out.low.add(id);
      weights.push(g);
      details.set(id, { type: 'grams', value: g });
    }
    // The median: doctors from 1 baby; hospital admins from 5; the super admin from 5, to the nearest 50 g.
    const n = weights.length;
    let med = null;
    if (ctx.audience === 'doctor' ? n >= 1 : n >= MEDIAN_MIN_N) {
      med = median(weights);
      if (ctx.audience === 'platform') med = Math.round(med / MEDIAN_ROUND_PLATFORM) * MEDIAN_ROUND_PLATFORM;
    }
    // The weights stay on the server (internal): the super admin's combined median is worked out from them.
    return { cells: out, details, extras: med == null ? {} : { median: { value: med, n } }, internal: { weights } };
  },
};

// ---------- G6 Gestation at birth ----------

const GA_CELLS = ['lt28', 'w28_31', 'w32_33', 'w34_36', 'term', 'post'];

export const G6 = {
  id: 'G6',
  section: 'newborn',
  order: 40,
  title: 'Gestation at birth',
  window: 'period',
  form: 'bars',
  scopeable: true,
  audiences: ALL,
  needs: ['patients', 'plansLight'],
  uses: ['G1'],
  total: { key: 'total', code: 'c0', label: 'Babies registered', same: 'G1.total' },
  cells: [
    { key: 'lt28', code: 'c1', label: 'Before 28 weeks', list: true },
    { key: 'w28_31', code: 'c2', label: '28 to 31 weeks', list: true },
    { key: 'w32_33', code: 'c3', label: '32 to 33 weeks', list: true },
    { key: 'w34_36', code: 'c4', label: '34 to 36 weeks', list: true },
    { key: 'term', code: 'c5', label: 'Term', sub: '37 w 0 d – 41 w 6 d', list: true },
    { key: 'post', code: 'c6', label: '42 weeks or later', list: true },
    { key: 'noMother', code: 'c7', label: 'Mother not linked', unknown: true, list: true, same: 'G1.noMother' },
    { key: 'noDates', code: 'c8', label: 'Mother linked, dates not usable', unknown: true, list: true },
    { key: 'known', code: 'c9', label: 'Gestation known', den: true, list: true },
    { key: 'preterm', code: 'c10', label: 'Born before 37 weeks', list: true },
    { key: 'scan', code: 'c11', label: 'EDD by scan', list: true },
  ],
  virtual: ['notScan'],
  relations: [
    { total: 'total', parts: ['known', 'noMother', 'noDates'] },
    { total: 'known', parts: GA_CELLS },
    { total: 'preterm', parts: ['lt28', 'w28_31', 'w32_33', 'w34_36'] },
    { total: 'known', parts: ['scan', 'notScan'] },
  ],
  shares: [
    { key: 'preterm', label: 'Born before 37 weeks', num: 'preterm', den: 'known' },
    { key: 'scan', label: 'EDD by scan', num: 'scan', den: 'known' },
    { key: 'known', label: 'Gestation known', num: 'known', den: 'total' },
  ],
  list: { order: 'gaAsc', detailLabel: 'Gestation at birth' },
  emptyText: 'No babies were registered as born in this period.',
  notes: (ctx) => [
    "Gestation from the mother's EDD (her care plan's, or her record's), for babies whose mother is linked.",
    'Preterm figures from LMP-only dates are less reliable.',
    ...(ctx.audience === 'doctor' ? ["Dates not usable also holds babies whose mother's record you cannot open."] : []),
  ],
  compute(ctx) {
    const out = sets('known', 'noDates', 'preterm', 'scan', 'notScan', ...GA_CELLS);
    const details = new Map();
    for (const { p, id, on } of babiesInPeriod(ctx)) {
      const mid = p.newborn.mother;
      if (!mid) continue; // G1.noMother
      const mother = ctx.byId.get(String(mid));
      // A mother whose clinical details this doctor may not see: her dates are not used.
      const usable = mother && (!ctx.visible || ctx.visible.has(idOf(mother)));
      const plans = usable ? [...ctx.plansOf(mother).all].sort((a, b) => Number(b.current) - Number(a.current) || new Date(b.bookedOn) - new Date(a.bookedOn)) : [];
      const e = usable ? babyEdd(mother, plans, on) : null;
      if (!e) {
        out.noDates.add(id);
        continue;
      }
      const ga = gaOn(e.edd, on);
      const cell = birthGaCell(ga.totalDays);
      out.known.add(id);
      out[cell].add(id);
      if (!['term', 'post'].includes(cell)) out.preterm.add(id);
      out[e.source === 'scan' ? 'scan' : 'notScan'].add(id);
      details.set(id, { type: 'ga', weeks: ga.weeks, days: ga.days });
    }
    return { cells: out, details };
  },
};

export const NEWBORN_METRICS = [G1, G3, G6];
