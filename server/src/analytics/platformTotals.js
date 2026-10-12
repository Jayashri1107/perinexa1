// The ONLY code that produces numbers from more than one hospital. It never runs a query across hospitals: it
// runs the normal tenant-scoped computation once per hospital and keeps only the numbers returned by
// `toPublicCards(raw, 'platform')`. Any change here needs a second reviewer.
//
// The super admin's Analytics (Analytics specification, section 4.5):
//  - exact numbers per hospital and for all hospitals together (owner decision 1), for whole finished months
//    only, with month columns (no weeks, no days, so a count can never be read as one baby's date of birth);
//  - numbers only: no id of a patient, visit, care plan or doctor, no name, no record number and no patient
//    list. The birth weights behind the combined median stay on this server;
//  - "all hospitals" means the active ones (Q7); an inactive hospital can still be picked on its own;
//  - no refreshDueRisks here: a super admin must not cause writes in a hospital, so risk levels are as each
//    hospital last checked them (the risk cards say so).

import mongoose from 'mongoose';
import { hospitalToday, isoDay } from '../careplans/dates.js';
import { Tenant } from '../models/Tenant.js';
import { HttpError } from '../utils/httpError.js';
import { buildContext, computeSections, metricIdsFor, rawValue } from './compute.js';
import { median } from './facts.js';
import { loadHospital, windowFromOf } from './load.js';
import { MEDIAN_MIN_N } from './metrics/newborn.js';
import { parsePeriod, periodJSON } from './period.js';
import { countOf, tilesJSON, toPublicCards } from './publicCards.js';
import { globalCellId, metricById, needsOf, splitGlobal } from './registry.js';
import { PLATFORM_MIN_DENOMINATOR } from './roles.js';

export const HOSPITAL_NOT_FOUND_MESSAGE = 'Hospital not found.';
export const RISK_LEVELS_NOTE = 'Risk levels as last checked in each hospital.';
export const TOO_FEW_MESSAGE = 'Too few patients in this hospital to show';
const MEDIAN_ROUND = 50; // the super admin's medians: to the nearest 50 g
// Hospitals worked out at the same time: one is loaded from the database while another is worked out (the
// working out itself runs one at a time). Three keeps the rows in memory at once small.
const PARALLEL = 3;

// Cards that use the stored risk levels (never brought up to date on this path).
const RISK_LEVEL_CARDS = new Set(['C1', 'C2', 'C9']);
// Clinical cards hidden for a hospital whose card denominator is below PLATFORM_MIN_DENOMINATOR (0 = off). The
// Deliveries tab's cards with a total (H1–H6: deliveries or babies); H7 (stillbirths and deaths) has no total.
export const MIN_DENOMINATOR_CARDS = new Set(['C1', 'C2', 'C4', 'C9', 'D1', 'D3', 'D4', 'D6', 'G2', 'G3', 'G6', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
// Rows chosen by count in each hospital: the super admin gets every row (metrics/risk.js, metrics/care.js), and
// the combined card shows them by the combined count, highest first.
const RANKED_ROWS = {
  C2: () => true, // the super admin's C2 has no "Other reasons" row
  E1: (c) => c.group === 'overdueItems',
};
// A label that can differ from hospital to hospital (each hospital's own risk rule).
const LABEL_WHEN_DIFFERENT = { C4: { 'preg:grand': 'Grand multipara (by each hospital’s own number of births)' } };

// No rows at all: the cards still have their shape when there is no hospital to count.
const EMPTY_DATA = Object.freeze({ tenantId: null, patients: [], visitSummary: [], windowVisits: [], cancelledVisits: [], plans: [], fullPlans: [], template: null, deliveries: [] });

/** The hospitals of a request: all active ones (by name), or the one picked (active or not). 404 if unknown. */
export async function platformHospitals(hospital) {
  if (hospital === 'all') return Tenant.find({ isActive: true }).sort({ name: 1, _id: 1 }).select('_id name isActive').lean();
  if (typeof hospital !== 'string' || !/^[a-f\d]{24}$/i.test(hospital)) {
    throw new HttpError(404, HOSPITAL_NOT_FOUND_MESSAGE, 'NOT_FOUND');
  }
  const found = await Tenant.find({ _id: new mongoose.Types.ObjectId(hospital) }).select('_id name isActive').lean();
  if (!found.length) throw new HttpError(404, HOSPITAL_NOT_FOUND_MESSAGE, 'NOT_FOUND');
  return found;
}

/** Runs fn over the items, at most `limit` at a time; results in the items' order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * One hospital's section, numbers only: { cards (as toPublicCards gives them), tiles, tileDens, weights,
 * noPatients }. `tileDens[j]` is the denominator of tile j's card when that card is one the small-hospital
 * switch covers (the same total the card itself shows), else null. `weights` (birth weights for the combined
 * median) and `tileDens` never leave the server.
 */
function computeHospital(data, { now, today, period, section, careType }) {
  const ctx = buildContext(data, { now, today, period, scope: 'hospital', careType, audience: 'platform', userId: null, visible: null });
  const { cards, tiles } = computeSections(ctx, [section]);
  const tileDens = tiles
    ? tiles.map((t) => {
        const m = metricById(splitGlobal(t.ref)[0]);
        return MIN_DENOMINATOR_CARDS.has(m.id) && m.total ? countOf(rawValue(ctx, globalCellId(m, m.total.key, ctx))) : null;
      })
    : null;
  return {
    cards: toPublicCards(cards, ctx, { audience: 'platform' }),
    tiles: tiles ? tilesJSON(tiles, ctx, { audience: 'platform' }) : null,
    tileDens,
    weights: ctx.results.get('G3')?.internal?.weights ?? null,
    noPatients: data.patients.length === 0,
  };
}

const add = (a, b) => (a == null ? b : b == null ? a : a + b);
const sum = (values) => values.reduce(add, null);

/** Rows of a table (V1, E4, B4) across hospitals, by key, in the first hospital's order. */
function combineTable(tables) {
  const present = tables.filter(Boolean);
  if (!present.length) return null;
  const rows = [];
  const seen = new Set();
  for (const t of present) {
    for (const r of t.rows) {
      if (seen.has(r.key)) continue;
      seen.add(r.key);
      rows.push(r);
    }
  }
  return { ...present[0], rows };
}

/** Notes across hospitals: a note every hospital has is said once; a note of only some names them. */
function combineNotes(perHospital, hospitals, { combined }) {
  const out = [];
  const where = new Map(); // note → indexes of the hospitals that have it
  perHospital.forEach((notes, i) => {
    for (const n of notes) {
      const text = typeof n === 'string' ? n : String(n);
      if (!where.has(text)) where.set(text, []);
      where.get(text).push(i);
    }
  });
  const every = (list) => list.length === hospitals.length;
  for (const [text, list] of where) {
    if (!combined || hospitals.length <= 1) out.push(text.replace(/\bYour hospital's\b/g, "This hospital's").replace(/\byour hospital's\b/g, "this hospital's"));
    else if (every(list)) out.push(text.replace(/\bYour hospital's\b/g, "Each hospital's").replace(/\byour hospital's\b/g, "each hospital's"));
    else out.push(`${list.map((i) => hospitals[i].name).join(', ')}: ${text.replace(/\bYour hospital's\b/g, "The hospital's").replace(/\byour hospital's\b/g, "the hospital's")}`);
  }
  return out;
}

const roundMedian = (weights) => (weights.length >= MEDIAN_MIN_N ? Math.round(median(weights) / MEDIAN_ROUND) * MEDIAN_ROUND : null);
const ratioOf = (girls, boys) => (boys > 0 ? Math.round((girls / boys) * 1000) : null);

/**
 * One card across hospitals. `perHospital[i]` holds hospital i's cards; tooFew[i] leaves hospital i out of this
 * card (PLATFORM_MIN_DENOMINATOR). withValues: each number also carries its value per hospital.
 */
function combineCard(id, perHospital, hospitals, { withValues, weights, tooFew }) {
  const m = metricById(id);
  const cards = perHospital.map((r) => r.cards.find((c) => c.id === id));
  const counted = cards.map((c, i) => (tooFew[i] ? null : c));
  const base = cards[0];
  const labels = LABEL_WHEN_DIFFERENT[id] ?? {};

  // Cells: every key any hospital has, in the first hospital's order, then the others as they come.
  const order = [];
  const byKey = new Map();
  counted.forEach((c, i) => {
    for (const cell of c?.cells ?? []) {
      if (!byKey.has(cell.key)) {
        byKey.set(cell.key, new Array(cards.length).fill(null));
        order.push(cell.key);
      }
      byKey.get(cell.key)[i] = cell;
    }
  });
  // A hospital that is counted but has no such row has 0 of it (every row is sent to the super admin); a
  // hospital left out of the card has no number (null).
  let cells = order.map((key) => {
    const own = byKey.get(key);
    const shape = own.find(Boolean);
    const values = cards.map((_, i) => (tooFew[i] ? null : (own[i]?.value ?? 0)));
    const differ = new Set(own.filter(Boolean).map((e) => e.label)).size > 1;
    return { ...shape, label: differ && labels[key] ? labels[key] : shape.label, value: sum(values), values: withValues ? values : null };
  });
  const ranked = RANKED_ROWS[id];
  // A card left out for every hospital: the shape of the first one, with no numbers, and without the rows that
  // are there only because a hospital has them (C2's reasons): a reason's name would tell that a hospital left
  // out has at least one woman with it.
  if (!counted.some(Boolean)) {
    cells = base.cells.filter((c) => !ranked?.(c)).map((c) => ({ ...c, value: null, values: withValues ? cards.map(() => null) : null }));
  }
  if (ranked) {
    const at = cells.flatMap((c, i) => (ranked(c) ? [i] : []));
    const rows = at.map((i) => cells[i]).sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
    at.forEach((i, j) => {
      cells[i] = rows[j];
    });
  }

  let total = null;
  if (base.total) {
    const values = counted.map((c) => (c ? c.total.value : null));
    total = { ...base.total, value: sum(values), values: withValues ? values : null };
  }

  // Derived numbers from the combined counts (a ratio from girls and boys, a median from the weights kept here).
  const extras = {};
  const cellValue = (key) => cells.find((c) => c.key === key)?.value ?? 0;
  if (id === 'G2' && counted.some(Boolean)) {
    const perRatio = counted.map((c) => (c ? (c.extras?.ratio?.value ?? null) : null));
    extras.ratio = { value: ratioOf(cellValue('girls'), cellValue('boys')), basis: cellValue('girls') + cellValue('boys'), ...(withValues ? { values: perRatio } : {}) };
  }
  if (id === 'G3' && counted.some(Boolean)) {
    const all = weights.flatMap((w, i) => (tooFew[i] ? [] : (w ?? [])));
    const value = roundMedian(all);
    const perMedian = counted.map((c) => (c ? (c.extras?.median?.value ?? null) : null));
    if (value != null || (withValues && perMedian.some((v) => v != null))) extras.median = { value, n: all.length, ...(withValues ? { values: perMedian } : {}) };
  }

  // Notes: G2's few-births line from the combined count; the others as each hospital has them.
  let notes;
  if (id === 'G2') notes = typeof m.notes === 'function' ? m.notes({ audience: 'platform' }, { cells: { total: total?.value ?? 0 } }) : (m.notes ?? []);
  else notes = combineNotes(cards.map((c) => c.notes ?? []), hospitals, { combined: withValues });
  if (RISK_LEVEL_CARDS.has(id)) notes = [...notes, RISK_LEVELS_NOTE];
  const left = tooFewNote(tooFew, hospitals, { withValues });
  if (left) notes = [...notes, left];

  return {
    ...base,
    notes,
    total,
    cells,
    table: combineTable(counted.map((c) => c?.table ?? null)) ?? base.table,
    extras,
    tooFew: tooFew.some(Boolean) ? [...tooFew] : null,
  };
}

/**
 * The headline tiles across hospitals (Overview). tooFewAt(i, j): hospital i is left out of tile j, by the same
 * rule as the tile's card (a tile is its card's own cell, so the two numbers stay identical).
 */
function combineTiles(perHospital, hospitals, { withValues, tooFewAt }) {
  const first = perHospital[0].tiles;
  if (!first) return null;
  return first.map((t, j) => {
    const tooFew = perHospital.map((_, i) => tooFewAt(i, j));
    const values = perHospital.map((r, i) => (tooFew[i] ? null : r.tiles[j].value));
    return {
      ...t,
      value: sum(values), // null when every hospital picked is left out
      ...(withValues ? { values } : {}),
      tooFew: tooFew.some(Boolean) ? tooFew : null,
      note: tooFewNote(tooFew, hospitals, { withValues }),
    };
  });
}

/** The note for hospitals left out by the small-hospital switch (null when none is). */
function tooFewNote(tooFew, hospitals, { withValues }) {
  if (!tooFew.some(Boolean)) return null;
  const names = hospitals.filter((_, i) => tooFew[i]).map((h) => h.name);
  return withValues ? `${TOO_FEW_MESSAGE}: ${names.join(', ')}. Left out of the numbers for all hospitals.` : `${TOO_FEW_MESSAGE}.`;
}

/**
 * A section for the super admin: { hospitals: [{ id, name, isActive }], period, noPatients, tiles, cards }.
 * hospital: 'all' (active hospitals) or one hospital's id. periodQuery: { period, from, to }. careType: Overview only.
 * minDenominator: PLATFORM_MIN_DENOMINATOR unless a test sets it.
 */
export async function platformSection({ section, hospital, periodQuery, careType = 'all', now, minDenominator = PLATFORM_MIN_DENOMINATOR }) {
  const today = hospitalToday(now);
  const period = parsePeriod(periodQuery, { audience: 'platform', today });
  const tenants = await platformHospitals(hospital);
  const needs = needsOf(metricIdsFor([section], 'platform')).concat('patients');
  const opts = { now, today, period, section, careType: section === 'overview' ? careType : 'all' };

  // A few hospitals at a time (PARALLEL), each with its own ObjectId tenant filter. Only the numbers
  // of each are kept; the rows are dropped as soon as its numbers are worked out.
  const perHospital = await mapLimit(tenants, PARALLEL, async (t) => {
    const data = await loadHospital(t._id, { now, today, windowFrom: windowFromOf(period, today), periodFrom: period.from, periodTo: period.to, needs });
    return computeHospital(data, opts);
  });
  const hospitals = tenants.map((t) => ({ id: String(t._id), name: t.name, isActive: t.isActive }));

  // No hospital to count: the cards with zeros, so the page keeps its shape.
  const rows = perHospital.length ? perHospital : [computeHospital(EMPTY_DATA, opts)];
  const withValues = hospital === 'all';
  const named = perHospital.length ? hospitals : [{ id: null, name: '' }];
  // The small-hospital switch, one rule for cards and tiles: a clinical card whose denominator is below
  // minDenominator in a hospital leaves that hospital out (0 = off).
  const isTooFew = (id, den) => minDenominator > 0 && MIN_DENOMINATOR_CARDS.has(id) && perHospital.length > 0 && typeof den === 'number' && den < minDenominator;
  const cardIds = rows[0].cards.map((c) => c.id);
  const cards = cardIds.map((id) => {
    const tooFew = rows.map((r) => isTooFew(id, r.cards.find((c) => c.id === id)?.total?.value));
    return combineCard(id, rows, named, { withValues, weights: rows.map((r) => r.weights), tooFew });
  });
  const tooFewAt = (i, j) => isTooFew(splitGlobal(rows[i].tiles[j].ref)[0], rows[i].tileDens?.[j]);

  return {
    today: isoDay(today),
    period: periodJSON(period),
    hospitals,
    noPatients: perHospital.every((r) => r.noPatients),
    tiles: combineTiles(rows, named, { withValues, tooFewAt }),
    cards,
  };
}
