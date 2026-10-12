// The ONLY place that turns computed cells (Sets of patient ids) into numbers and builds the JSON the browser
// gets (Analytics specification, section 4.6). No id of a patient ever leaves here: a Set becomes its size.

import { dateLabel } from './period.js';
import { rawValue } from './compute.js';
import { cellsOf, globalCellId, metricById, sharesOf, shownCellsOf, tableOf, trendOf } from './registry.js';

/** A computed value as a number (a Set becomes its size). */
export function countOf(raw) {
  if (raw instanceof Set) return raw.size;
  if (typeof raw === 'number') return raw;
  if (raw === null) return null;
  throw new Error('Analytics cell was not computed');
}

const subtitleOf = (metric, ctx) => {
  if (metric.window === 'now') return `As of today, ${dateLabel(ctx.today)}`;
  if (metric.window === 'period') return ctx.period.label;
  return null; // mixed: each cell says its own window
};

function cellJSON(metric, def, ctx, audience) {
  const gid = globalCellId(metric, def.key, ctx);
  const raw = rawValue(ctx, gid);
  if (raw === undefined) throw new Error(`Analytics cell ${gid} (shown on ${metric.id}) was not computed`);
  const value = countOf(raw);
  return {
    key: def.key,
    code: def.code ?? null,
    label: def.label,
    sub: def.sub ?? null,
    value,
    unknown: Boolean(def.unknown),
    status: def.status ?? null,
    // Doctors only, only a cell marked listable (a shared cell counts when it says list: true), only above 0.
    // The super admin's cards carry no list flag at all (numbers only).
    ...(audience === 'platform' ? {} : { list: audience === 'doctor' && Boolean(def.list) && raw instanceof Set && value > 0 }),
    values: null,
    group: def.group ?? null,
    den: Boolean(def.den),
    partial: def.partial ?? null,
    window: def.window ?? null,
    tip: def.tip ?? null,
  };
}

/** One card as sent to the browser. */
export function cardJSON(metricId, ctx, { audience }) {
  const m = metricById(metricId);
  const res = ctx.results.get(metricId);
  const notes = typeof m.notes === 'function' ? m.notes(ctx, res) : (m.notes ?? []);
  const trend = trendOf(m, ctx);
  return {
    id: m.id,
    title: m.title,
    group: m.group ?? null,
    window: m.window,
    form: m.form,
    subtitle: subtitleOf(m, ctx),
    notes,
    wholeHospital: Boolean(m.wholeHospital),
    emptyText: m.emptyText ?? null,
    allMasked: false,
    total: m.total ? { ...cellJSON(m, m.total, ctx, audience), key: m.total.key } : null,
    cells: shownCellsOf(m, ctx).map((def) => cellJSON(m, def, ctx, audience)),
    shares: sharesOf(m).map((s) => ({ key: s.key, label: s.label, num: s.num, den: s.den })),
    trend: trend ? { cells: trend.cells, color: trend.color } : null,
    table: tableOf(m, ctx),
    extras: res.extras ?? {},
  };
}

/** The cards of a computed section, in order. */
export const toPublicCards = (cardIds, ctx, { audience }) => cardIds.map((id) => cardJSON(id, ctx, { audience }));

/** The headline tiles: [{ ref, label, sub, tone, window, value, metric, list, cell }] (the super admin's: no list, no cell). */
export function tilesJSON(tiles, ctx, { audience }) {
  return tiles.map((t) => {
    const raw = rawValue(ctx, t.ref);
    const [mid, key] = t.ref.split('.');
    const m = metricById(mid);
    const def = key === m.total?.key ? m.total : cellsOf(m, ctx).find((c) => c.key === key);
    const value = countOf(raw);
    const list = audience === 'doctor' && Boolean(def?.list) && raw instanceof Set && value > 0;
    const tile = { ref: t.ref, label: t.label, sub: t.sub ?? null, tone: t.tone ?? 'neutral', window: t.window, value, metric: mid };
    // The super admin's tiles open nothing: no list flag and no cell code.
    return audience === 'platform' ? tile : { ...tile, list, cell: list ? def.code : null };
  });
}
