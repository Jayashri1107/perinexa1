// The hospital admin's Analytics (Analytics specification, section 3.5): whole-hospital numbers for whole finished
// months, without the rows kept for doctors (roles.js ADMIN_HIDDEN), and with small numbers protected.
//
// One masking for the whole day. The numbers of every admin view – every section, the four admin periods
// (last month, last 3, 6 and 12 months) and every type-of-care filter of Overview – are put into ONE graph of
// numbers and the sums that link them, and small numbers are hidden once over that graph (mask.js). Every admin
// page is a slice of that one result, so the same number (for example the month of September on the
// registrations card, or the first trimester today) is shown, or hidden, the same way under every period and on
// every tab, and a number hidden on one view can't be read on another.
//
// Numbers in the graph are named so that the same number has the same name everywhere:
//  - an "as of today" number and a month column keep their global id ('A2.t1', 'A1.b:m:2026-09');
//  - any other number of a period gets the period: 'B1.total@last_3m';
//  - a number that changes with Overview's type-of-care filter gets the filter: 'A1.total#antenatal@last_3m'.
// Building the graph checks that a name never gets two different numbers.
//
// The result is kept in memory for 10 minutes per hospital and hospital date. It holds numbers only – the cards
// as sent to the browser before masking, and the graph – never an id of a patient.

import { isoDay } from '../careplans/dates.js';
import { refreshDueRisks } from '../careplans/templatesService.js';
import { buildContext, computeMetric, computeSections, rawValue } from './compute.js';
import { inRange } from './facts.js';
import { NEEDS, loadHospital, windowFromOf } from './load.js';
import { maskForAdmin } from './mask.js';
import { CARE_TYPE_KEYS } from './metrics/overview.js';
import { MEDIAN_MIN_N } from './metrics/newborn.js';
import { PERIOD_KEYS, parsePeriod, periodJSON } from './period.js';
import { cardJSON, countOf, tilesJSON } from './publicCards.js';
import { SECTIONS, allCellDefs, globalCellId, globalCellWindow, metricById, metricsOfSection, relations, shownCellsOf, splitGlobal } from './registry.js';

export const ADMIN_PERIOD_KEYS = PERIOD_KEYS.admin;
export const ADMIN_CARE_TYPES = ['all', ...CARE_TYPE_KEYS];
export const ADMIN_CACHE_MS = 10 * 60 * 1000;

export const MASKING_NOTE =
  "Numbers from 1 to 4 are shown as “fewer than 5”. Some numbers are not shown so that a small number can't be worked out. Some detailed rows are only for doctors.";

// Numbers worked out from others, left out when any of the cells they come from is not exact (step 4).
const DERIVED = {
  ratio: { cells: ['girls', 'boys'], min: 0 }, // G2: girls per 1,000 boys
  median: { cells: ['weighed'], min: MEDIAN_MIN_N }, // G3: the median birth weight and its n
};

const viewKey = (periodKey, careType) => `${periodKey}|${careType}`;

/** The graph's name of a global cell in one view (see the header). */
export function adminCellId(globalId, ctx) {
  const [mid, key] = splitGlobal(globalId);
  const m = metricById(mid);
  let id = globalId;
  if (ctx.careType !== 'all' && m.filteredCells?.(key)) id += `#${ctx.careType}`;
  // Admin periods are whole months, so a month column is the same number under every period.
  if (globalCellWindow(globalId, ctx) === 'period' && !key.startsWith('b:')) id += `@${ctx.period.key}`;
  return id;
}

const members = (r) => (r.kind === 'subset' ? [r.sub, r.sup] : [r.total, ...r.parts]);
const relationKey = (r) => (r.kind === 'subset' ? `s|${r.sub}|${r.sup}` : `p|${r.total}|${r.parts.join('+')}`);

/**
 * Every admin view of one hospital, without masking: { views: Map 'period|careType' → { period, careType,
 * cards: [{ id, section, json, ids: { total, cells } }], tiles: [{ json, id }] | null }, cells: Map id →
 * { value, shown }, relations }. A view with a type-of-care filter holds only the cards the filter changes.
 * `data`: what loadHospital returns (loaded once for the four periods).
 */
export function collectAdminViews(data, { now, today }) {
  const views = new Map();
  const cells = new Map();
  const rels = new Map();
  const setCell = (id, value) => {
    const c = cells.get(id);
    if (!c) cells.set(id, { value, shown: false });
    else if (c.value !== value) throw new Error(`Analytics admin view: ${id} has two different numbers (${c.value} and ${value})`);
  };
  const addRelation = (r) => {
    const k = relationKey(r);
    if (!rels.has(k)) rels.set(k, r);
  };

  // What does not depend on the period (care plans read through the plan engine, active pregnancies …) is
  // worked out once for all the views.
  const shared = new Map();
  const filteredCards = metricsOfSection('overview', 'admin').filter((m) => m.careTypeFilter).map((m) => m.id);
  for (const periodKey of ADMIN_PERIOD_KEYS) {
    const period = parsePeriod({ period: periodKey }, { audience: 'admin', today });
    // One load covers the four periods: the visits entered in error are counted per period here.
    const viewData = { ...data, cancelledVisits: (data.cancelledVisits ?? []).filter((v) => inRange(v.visitOn, period.from, period.to)) };
    for (const careType of ADMIN_CARE_TYPES) {
      const ctx = buildContext(viewData, { now, today, period, scope: 'hospital', careType, audience: 'admin', userId: null, visible: null, shared });
      let cards;
      let tiles = null;
      if (careType === 'all') ({ cards, tiles } = computeSections(ctx, SECTIONS));
      else {
        // The type-of-care filter changes only the cards that say so (A1, A4); the rest of Overview and the
        // headline tiles come from the view without a filter (adminPayload).
        cards = filteredCards;
        for (const id of cards) computeMetric(ctx, id);
      }
      const idOf = (gid) => adminCellId(gid, ctx);

      // Every cell of every card worked out (shown or not), and every sum that links them.
      for (const mid of ctx.results.keys()) {
        const m = metricById(mid);
        for (const def of allCellDefs(m, ctx)) {
          const gid = globalCellId(m, def.key, ctx);
          setCell(idOf(gid), countOf(rawValue(ctx, gid)));
          // A row that is only there when its count is at least 1: its presence says so (mask.js).
          if (m.onlyWhenCounted?.includes(def.group)) cells.get(idOf(gid)).atLeastOne = true;
        }
      }
      for (const r of relations(ctx, [...ctx.results.keys()])) {
        addRelation(r.kind === 'subset' ? { kind: 'subset', sub: idOf(r.sub), sup: idOf(r.sup) } : { kind: 'partition', total: idOf(r.total), parts: r.parts.map(idOf) });
      }
      // Across the filters: each registration and each visit has one type of care, so a number that changes
      // with the filter is the sum of its numbers under each type.
      if (careType === 'all') {
        for (const mid of filteredCards) {
          const m = metricById(mid);
          for (const def of allCellDefs(m, ctx)) {
            if (!m.filteredCells?.(def.key)) continue;
            const total = idOf(`${mid}.${def.key}`);
            const at = total.includes('@') ? total.slice(total.indexOf('@')) : '';
            const base = at ? total.slice(0, total.indexOf('@')) : total;
            addRelation({ kind: 'partition', total, parts: CARE_TYPE_KEYS.map((t) => `${base}#${t}${at}`) });
          }
        }
      }

      const view = { period, careType, cards: [], tiles: null };
      for (const id of cards) {
        const m = metricById(id);
        const json = cardJSON(id, ctx, { audience: 'admin' });
        const ids = {
          total: m.total ? idOf(globalCellId(m, m.total.key, ctx)) : null,
          cells: shownCellsOf(m, ctx).map((def) => idOf(globalCellId(m, def.key, ctx))),
        };
        for (const x of [ids.total, ...ids.cells]) if (x) cells.get(x).shown = true;
        view.cards.push({ id, section: m.section, json, ids });
      }
      if (tiles) {
        view.tiles = tilesJSON(tiles, ctx, { audience: 'admin' }).map((json) => {
          const id = idOf(json.ref);
          cells.get(id).shown = true;
          return { json, id };
        });
      }
      views.set(viewKey(periodKey, careType), view);
    }
  }
  const relationList = [...rels.values()];
  for (const r of relationList) for (const id of members(r)) if (!cells.has(id)) throw new Error(`Analytics admin view: a sum names ${id}, which was not worked out`);
  return { views, cells, relations: relationList };
}

/** The admin views of one hospital with small numbers protected: collectAdminViews + masking. */
export function buildAdminGraph(data, { now, today }) {
  const graph = collectAdminViews(data, { now, today });
  const masking = maskForAdmin(graph.cells, graph.relations);
  return { ...graph, masking, calculatedAt: now, noPatients: (data.patients ?? []).length === 0 };
}

const isMasked = (v) => v != null && typeof v === 'object';

/** One card of a view as sent to the hospital admin. */
export function maskedCard(entry, values) {
  const json = structuredClone(entry.json);
  const valueOf = (id) => (values.has(id) ? values.get(id) : null);
  if (json.total) json.total.value = valueOf(entry.ids.total);
  json.cells.forEach((c, i) => {
    c.value = valueOf(entry.ids.cells[i]);
  });
  const m = json.id ? metricById(json.id) : null;
  // Rows chosen and ordered by count (E1 "most often overdue"): the order must use only what is sent, or it would
  // tell how the "fewer than 5" rows compare. Exact numbers first, highest first; then the others from A to Z.
  for (const group of m?.rankedGroups ?? []) {
    const at = json.cells.flatMap((c, i) => (c.group === group ? [i] : []));
    const rows = at
      .map((i) => json.cells[i])
      .sort((a, b) => {
        const ea = typeof a.value === 'number';
        const eb = typeof b.value === 'number';
        if (ea !== eb) return ea ? -1 : 1;
        if (ea && a.value !== b.value) return b.value - a.value;
        return a.label.localeCompare(b.label) || String(a.code).localeCompare(String(b.code));
      });
    at.forEach((i, j) => {
      json.cells[i] = rows[j];
    });
  }
  // Derived values only from exact numbers (a ratio from exact girls and boys, a median from an exact n of 5 or more).
  for (const [name, rule] of Object.entries(DERIVED)) {
    if (!json.extras?.[name]) continue;
    const inputs = rule.cells.map((k) => json.cells.find((c) => c.key === k) ?? (json.total?.key === k ? json.total : null));
    if (inputs.some((c) => !c || typeof c.value !== 'number' || c.value < rule.min)) delete json.extras[name];
  }
  // Notes that depend on numbers are worked out from what is sent, never from the true counts (G2).
  if (m?.maskedNotes) json.notes = [...(json.notes ?? []), ...m.maskedNotes(json)];
  const shown = [...(json.total ? [json.total] : []), ...json.cells];
  json.allMasked = shown.length > 0 && shown.every((c) => isMasked(c.value));
  return json;
}

/**
 * The part of a section payload that differs for a hospital admin: { period, calculatedAt, masking, noPatients,
 * tiles, cards }. careType is used on Overview only.
 */
export function adminPayload(graph, { section, periodKey, careType = 'all' }) {
  const view = graph.views.get(viewKey(periodKey, 'all'));
  const filtered = section === 'overview' && careType !== 'all' ? graph.views.get(viewKey(periodKey, careType)) : null;
  if (!view || filtered === undefined) throw new Error(`No admin view for ${periodKey} ${careType}`);
  const { values } = graph.masking;
  const cards = view.cards
    .filter((c) => c.section === section)
    .map((c) => filtered?.cards.find((f) => f.id === c.id) ?? c)
    .map((c) => maskedCard(c, values));
  const tiles =
    section === 'overview'
      ? (view.tiles ?? []).map(({ json, id }) => ({ ...json, value: values.has(id) ? values.get(id) : null, list: false, cell: null }))
      : null;
  return {
    period: periodJSON(view.period),
    calculatedAt: graph.calculatedAt,
    masking: { note: MASKING_NOTE },
    noPatients: graph.noPatients,
    tiles,
    cards,
  };
}

// ---------- The 10-minute cache (numbers only) ----------

const cache = new Map(); // 'tenantId|YYYY-MM-DD' → { at, graph }
const inFlight = new Map();

/** For tests. */
export const resetAdminViewCache = () => {
  cache.clear();
  inFlight.clear();
};

/**
 * The masked graph of one hospital for today: from the cache when it was made in the last 10 minutes, otherwise
 * worked out afresh (risk levels brought up to date first, then one load for the four periods).
 */
export async function adminGraphFor(tenantId, { now, today }) {
  const key = `${tenantId}|${isoDay(today)}`;
  const t = new Date(now).getTime();
  const hit = cache.get(key);
  if (hit && t >= hit.at && t - hit.at < ADMIN_CACHE_MS) return hit.graph;
  if (inFlight.has(key)) return inFlight.get(key);
  const job = (async () => {
    await refreshDueRisks(tenantId, now);
    const periods = ADMIN_PERIOD_KEYS.map((k) => parsePeriod({ period: k }, { audience: 'admin', today }));
    const longest = periods.reduce((a, b) => (b.from < a.from ? b : a));
    const periodTo = periods.reduce((a, b) => (b.to > a ? b.to : a), periods[0].to);
    const data = await loadHospital(tenantId, { now, today, windowFrom: windowFromOf(longest, today), periodFrom: longest.from, periodTo, needs: NEEDS });
    const graph = buildAdminGraph(data, { now, today });
    cache.set(key, { at: t, graph });
    if (cache.size > 200) for (const [k, v] of cache) if (t - v.at >= ADMIN_CACHE_MS) cache.delete(k);
    return graph;
  })();
  inFlight.set(key, job);
  try {
    return await job;
  } finally {
    inFlight.delete(key);
  }
}

/** A section for a hospital admin (the route adds the parts every payload has). */
export async function adminSection(tenantId, { now, today, section, periodKey, careType }) {
  return adminPayload(await adminGraphFor(tenantId, { now, today }), { section, periodKey, careType });
}

