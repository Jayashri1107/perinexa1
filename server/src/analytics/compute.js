// Works out the cards of one hospital from the rows loaded by load.js. Pure: everything comes from `data` and
// the options (the moment, the period, who is asking). Cells hold Sets of patient ids (or plain numbers for
// visits); only publicCards.js turns them into numbers for the browser.

import { config } from '../config.js';
import { dayCache, idOf, pidOf, sameId } from './facts.js';
import { availableTiles, metricById, metricsOfSection, splitGlobal, withDependencies } from './registry.js';

const EMPTY_PLANS = Object.freeze({ current: null, closed: [], all: [] });

const timeOf = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());
function byVisitOrder(a, b) {
  return timeOf(a.visitOn) - timeOf(b.visitOn) || timeOf(a.createdAt) - timeOf(b.createdAt) || idOf(a).localeCompare(idOf(b));
}

// Groups (ctx.once keys) that depend on neither the period nor the type-of-care filter. A caller that builds
// several contexts over the same rows, audience, scope and visibility (the hospital admin's view: four periods,
// five filters) passes one `shared` Map, so these are worked out once – care plans read through the plan engine
// above all.
export const PERIOD_FREE_GROUPS = new Set(['active', 'older44', 'closedAntenatal', 'plansNow', 'templateItems', 'grand', 'C2.rows', 'E1.states', 'E1.rows']);
// Groups that depend on the period but not on the type-of-care filter: shared by the contexts of one period
// (the admin view builds one context per filter), under the period's first and last day.
export const FILTER_FREE_GROUPS = new Set(['registrations', 'visits', 'babies', 'cancelled']);

/** Indexes of one hospital's rows: by patient, care plans per patient, visit summaries, visits per patient. */
function indexRows(data, timeZone) {
  const hday = dayCache(timeZone);
  const byId = new Map(data.patients.map((p) => [idOf(p), p]));
  const plans = new Map();
  for (const pl of data.plans ?? []) {
    const k = pidOf(pl);
    let e = plans.get(k);
    if (!e) plans.set(k, (e = { current: null, closed: [], all: [] }));
    e.all.push(pl);
    if (pl.current) e.current = pl;
    else e.closed.push(pl);
  }
  const summaries = new Map((data.visitSummary ?? []).map((s) => [String(s._id), s]));
  const windowVisits = [...(data.windowVisits ?? [])].sort(byVisitOrder);
  const visitsBy = new Map();
  for (const v of windowVisits) {
    const k = pidOf(v);
    if (!visitsBy.has(k)) visitsBy.set(k, []);
    visitsBy.get(k).push(v);
  }
  return { hday, byId, plans, summaries, windowVisits, visitsBy };
}

/**
 * The context every compute() works on: { data, now, today, period, scope, careType, audience, userId,
 * visible, hday, byId, plansOf, summaryOf, summaryById, visitsOf, windowVisits, patientsInScope, isInScope,
 * once, results }.
 * visible: for doctors, the Set of patient ids whose clinical details they may see (null = everyone).
 * shared: see PERIOD_FREE_GROUPS (null: nothing is shared with another context).
 * scope 'mine': patients assigned to this doctor, and babies whose mother is assigned to them.
 */
export function buildContext(data, { now, today, period, scope = 'hospital', careType = 'all', audience, userId = null, visible = null, shared = null, timeZone = config.HOSPITAL_TIME_ZONE }) {
  // The indexes of the rows. Contexts that share work (see PERIOD_FREE_GROUPS) also share these, as long as
  // they were built over the same rows.
  const rows = shared?.get('rows');
  const same = rows && rows.patients === data.patients && rows.plans === data.plans && rows.visitSummary === data.visitSummary && rows.windowVisits === data.windowVisits && rows.timeZone === timeZone;
  const { hday, byId, plans, summaries, windowVisits, visitsBy } = same ? rows.index : indexRows(data, timeZone);
  if (shared && !same) shared.set('rows', { patients: data.patients, plans: data.plans, visitSummary: data.visitSummary, windowVisits: data.windowVisits, timeZone, index: { hday, byId, plans, summaries, windowVisits, visitsBy } });

  const isVisible = (p) => !visible || visible.has(idOf(p));
  const mine = (p) =>
    sameId(p.assignedDoctor, userId) || (p.careType === 'newborn' && p.newborn?.mother != null && sameId(byId.get(String(p.newborn.mother))?.assignedDoctor, userId));
  const patientsInScope = data.patients.filter((p) => isVisible(p) && (scope !== 'mine' || mine(p)));
  const inScopeIds = new Set(patientsInScope.map(idOf));
  const memo = new Map();

  return {
    data,
    now,
    today,
    period,
    scope,
    careType,
    audience,
    userId,
    visible,
    hday,
    byId,
    plansOf: (p) => plans.get(idOf(p)) ?? EMPTY_PLANS,
    summaryOf: (p) => summaries.get(idOf(p)) ?? null,
    summaryById: (id) => summaries.get(String(id)) ?? null,
    visitsOf: (p) => visitsBy.get(idOf(p)) ?? [],
    windowVisits,
    patientsInScope,
    isInScope: (id) => inScopeIds.has(String(id)),
    once(key, fn) {
      let store = memo;
      let k = key;
      if (shared && PERIOD_FREE_GROUPS.has(key)) store = shared;
      else if (shared && FILTER_FREE_GROUPS.has(key) && period) {
        // Only contexts over the same rows of the period (the same cancelled visits) may share these.
        store = shared;
        k = `${key}@${period.from.getTime()}|${period.to.getTime()}`;
        const owner = `${k}#data`;
        if (store.has(owner) && store.get(owner) !== data.cancelledVisits) throw new Error(`Analytics: ${key} shared over different rows`);
        store.set(owner, data.cancelledVisits);
      }
      if (!store.has(k)) store.set(k, fn());
      return store.get(k);
    },
    results: new Map(),
  };
}

/**
 * Computes one card (and first the cards it uses). Returns { cells, details, order, extras, internal }.
 * `order`: Map cell key → Map patient id → sort value (E4: the item's due date, ISO day), for a list order
 * that is not a patient field; the list sorts by it ascending, then createdAt, then _id. `internal` and
 * `order` never leave the server (for example the birth weights behind a median).
 */
export function computeMetric(ctx, id) {
  if (ctx.results.has(id)) return ctx.results.get(id);
  for (const dep of withDependencies([id])) {
    if (ctx.results.has(dep)) continue;
    const m = metricById(dep);
    const r = m.compute(ctx);
    ctx.results.set(dep, { cells: r.cells, details: r.details ?? new Map(), order: r.order ?? new Map(), extras: r.extras ?? {}, internal: r.internal ?? {} });
  }
  return ctx.results.get(id);
}

/** The raw value of a global cell ('A2.t1'): a Set, a number, or undefined if that card was not computed. */
export function rawValue(ctx, globalId) {
  const [mid, key] = splitGlobal(globalId);
  return ctx.results.get(mid)?.cells?.[key];
}

/** The cards (ids, in page order) of these sections for the context's audience, and the headline tiles. */
export function computeSections(ctx, sectionIds) {
  const cards = [];
  for (const s of sectionIds) {
    for (const m of metricsOfSection(s, ctx.audience)) {
      computeMetric(ctx, m.id);
      cards.push(m.id);
    }
  }
  let tiles = null;
  if (sectionIds.includes('overview')) {
    tiles = availableTiles();
    for (const t of tiles) computeMetric(ctx, splitGlobal(t.ref)[0]);
  }
  return { cards, tiles };
}

/** The card ids a request for these sections computes (for needsOf): the cards, and the tiles' cards. */
export function metricIdsFor(sectionIds, audience) {
  const ids = [];
  for (const s of sectionIds) for (const m of metricsOfSection(s, audience)) ids.push(m.id);
  if (sectionIds.includes('overview')) for (const t of availableTiles()) ids.push(splitGlobal(t.ref)[0]);
  return [...new Set(ids)];
}
