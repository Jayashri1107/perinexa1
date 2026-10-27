// Every Analytics card (metric), in page order, and how its cells are named.
//
// A cell's global id is "<metricId>.<cellKey>" (for example 'A2.t1'), unless the cell says it is the SAME cell
// as one of another card (`same: 'A2.noEdd'`): then it has that id, and its number is that card's number.
// Codes ('c0', 'c1' …) are stable and opaque; they are what a patient-list link carries, so the browser
// history never shows a diagnosis.
//
import { CARE_METRICS } from './metrics/care.js';
import { DELIVERY_METRICS } from './metrics/deliveries.js';
import { FERTILITY_METRICS } from './metrics/fertility.js';
import { NEWBORN_METRICS } from './metrics/newborn.js';
import { HEADLINE_TILES, OVERVIEW_METRICS } from './metrics/overview.js';
import { PREGNANCY_METRICS } from './metrics/pregnancy.js';
import { RISK_METRICS } from './metrics/risk.js';
import { G2 } from './metrics/sexAtBirth.js';

// The tabs (the website has the same ones: client/src/pages/analytics/analyticsFormat.js, which also sets their
// order on the page – Deliveries before Newborn). Here a new tab goes at the END: the hospital admin's numbers are
// worked out in this order, and a tab added last leaves the protection of every number before it as it was.
export const SECTIONS = ['overview', 'pregnancy', 'risk', 'care', 'newborn', 'deliveries', 'fertility'];
// Sections whose cards use risk levels: stored levels are brought up to date first (ages and rules change), as
// the Patients list does, on the hospital path only. Overview needs it for the "High-risk pregnancies" tile.
// A patient list does the same as the page its card is on.
export const REFRESH_RISK_SECTIONS = ['overview', 'risk'];
export const METRICS = [...OVERVIEW_METRICS, ...PREGNANCY_METRICS, ...RISK_METRICS, ...CARE_METRICS, ...NEWBORN_METRICS, G2, ...DELIVERY_METRICS, ...FERTILITY_METRICS];
export { HEADLINE_TILES };

const BY_ID = new Map(METRICS.map((m) => [m.id, m]));

export const metricById = (id) => BY_ID.get(id) ?? null;
export const isRegistered = (id) => BY_ID.has(id);

/** The cards of a section for an audience, in page order. */
export const metricsOfSection = (section, audience) =>
  METRICS.filter((m) => m.section === section && (!audience || m.audiences.includes(audience))).sort((a, b) => a.order - b.order);

/** 'A2.t1' → ['A2', 't1'] (cell keys may contain ':' and '|', never '.'). */
export function splitGlobal(globalId) {
  const i = globalId.indexOf('.');
  return [globalId.slice(0, i), globalId.slice(i + 1)];
}

// A card's cell definitions depend only on the card and the context (its filters, audience and data), so they
// are worked out once per context: looking up one cell by key must not rebuild a card of many cells each time.
const defCache = new WeakMap(); // ctx → Map metric id → { cells, all, byKey }
function defsOf(metric, ctx) {
  const build = () => {
    const cells = typeof metric.cells === 'function' ? metric.cells(ctx) : metric.cells;
    const all = [...(metric.total ? [{ ...metric.total, isTotal: true }] : []), ...cells, ...virtualOf(metric).map((v) => ({ ...v, virtual: true }))];
    const byKey = new Map();
    for (const c of all) if (!byKey.has(c.key)) byKey.set(c.key, c);
    return { cells, all, byKey };
  };
  if (!ctx || typeof ctx !== 'object') return build();
  let perCtx = defCache.get(ctx);
  if (!perCtx) defCache.set(ctx, (perCtx = new Map()));
  let e = perCtx.get(metric.id);
  if (!e) perCtx.set(metric.id, (e = build()));
  return e;
}

/** The cells declared on a card (without its total), including those marked offCard. */
export const cellsOf = (metric, ctx) => defsOf(metric, ctx).cells;
/**
 * The cells sent on the card. A cell marked offCard stays defined (another card or a tile shows it, so its global
 * id must resolve under every filter) but is not shown on this card and never opens a list from it.
 */
export const shownCellsOf = (metric, ctx) => cellsOf(metric, ctx).filter((c) => !c.offCard);
/** Cells never sent to the browser (they only complete a partition): [{ key, window }]. */
export const virtualOf = (metric) => (metric.virtual ?? []).map((v) => (typeof v === 'string' ? { key: v, window: metric.window } : { window: metric.window, ...v }));
export const relationsOf = (metric, ctx) => (typeof metric.relations === 'function' ? metric.relations(ctx) : (metric.relations ?? []));
export const sharesOf = (metric) => metric.shares ?? [];
export const trendOf = (metric, ctx) => (typeof metric.trend === 'function' ? metric.trend(ctx) : (metric.trend ?? null));
export const tableOf = (metric, ctx) => (typeof metric.table === 'function' ? metric.table(ctx) : (metric.table ?? null));

/** Every cell definition of a card: its total, the shown cells, and the virtual ones (marked virtual: true). */
export function allCellDefs(metric, ctx) {
  return defsOf(metric, ctx).all;
}

export function cellDef(metric, key, ctx) {
  return defsOf(metric, ctx).byKey.get(key) ?? null;
}

/** A cell's window: 'now' (as of today) or 'period'. */
export const cellWindow = (metric, def) => def?.window ?? metric.window;

/** The global id of a cell of this card (a key that already names another card, 'A2.total', is kept). */
export function globalCellId(metric, key, ctx) {
  if (key.includes('.')) return key;
  const def = cellDef(metric, key, ctx);
  if (!def) throw new Error(`Analytics card ${metric.id} has no cell ${key}`);
  return def.same ?? `${metric.id}.${key}`;
}

/**
 * The listable cell of a card with this code (null if none). A shared cell counts when it says list: true
 * (DQ c3 is A2.noEdd); its patients are the source cell's Set. A cell not shown on the card is never listable.
 */
export function cellByCode(metric, code, ctx) {
  return allCellDefs(metric, ctx).find((c) => c.code === code && c.list && !c.virtual && !c.offCard) ?? null;
}

/**
 * Every declared relation of these cards, with global ids: [{ metric, kind: 'partition', total, parts }].
 * A part or total named by another card's id ('D6.total') must be a card that exists.
 */
export function relations(ctx, metricIds = METRICS.map((m) => m.id)) {
  const out = [];
  for (const id of metricIds) {
    const m = metricById(id);
    for (const r of relationsOf(m, ctx)) {
      if (r.sub) {
        out.push({ metric: id, kind: 'subset', sub: globalCellId(m, r.sub, ctx), sup: globalCellId(m, r.sup, ctx) });
      } else {
        out.push({ metric: id, kind: 'partition', total: globalCellId(m, r.total, ctx), parts: r.parts.map((k) => globalCellId(m, k, ctx)) });
      }
    }
  }
  return out;
}

/** The window of a global cell ('now' or 'period'). */
export function globalCellWindow(globalId, ctx) {
  const [mid, key] = splitGlobal(globalId);
  const m = metricById(mid);
  if (!m) throw new Error(`Unknown analytics card ${mid}`);
  const def = cellDef(m, key, ctx);
  if (!def) throw new Error(`Analytics card ${mid} has no cell ${key}`);
  return cellWindow(m, def);
}

/** The cards a set of cards needs computed first (their `uses`, recursively), then the cards themselves. */
export function withDependencies(metricIds) {
  const out = [];
  const visit = (id) => {
    if (out.includes(id) || !isRegistered(id)) return;
    for (const dep of metricById(id).uses ?? []) visit(dep);
    out.push(id);
  };
  metricIds.forEach(visit);
  return out;
}

/** What must be loaded for these cards (load.js NEEDS). */
export function needsOf(metricIds) {
  const set = new Set();
  for (const id of withDependencies(metricIds)) for (const n of metricById(id).needs ?? []) set.add(n);
  return [...set];
}

/** The headline tiles that can be shown (their card exists). */
export const availableTiles = () => HEADLINE_TILES.filter((t) => isRegistered(splitGlobal(t.ref)[0]));
