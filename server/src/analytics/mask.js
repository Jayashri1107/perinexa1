// Small numbers for hospital admins (Analytics specification, section 3.5). Pure: no database, no clock.
//
// A hospital admin never receives a count from 1 to 4. Such a count is sent as "fewer than 5". Because many
// numbers on the page add up to others (a card's rows add up to its total, the months add up to the period, the
// same number is shown on two cards …), a small number could sometimes still be worked out from the numbers
// around it. So, after the small numbers are replaced, this file works out everything a reader could calculate,
// and hides more numbers ("Not shown") until no small number can be pinned down exactly. Where only small
// numbers and zeros pin each other (a very small hospital), those are "withheld" instead (maskForAdmin).
//
// What a reader can calculate (readerModel):
//  1. the sums solved exactly: every declared sum is an equation; with the exact numbers filled in, the equations
//     are reduced (whole-number linear algebra, no rounding), so any combination of sums that leaves one unknown
//     number alone is found – for example 20 − 18 = 2 from two different sums on one card;
//  2. ranges: each unknown number starts as what the reader knows of it ("fewer than 5" is 1 to 4, "Not shown"
//     is 5 or more, "withheld" is 0 to 4) and is narrowed through every sum, every "at most" and every reduced
//     equation, until nothing changes.
// Numbers that are the same by construction (a card total and another card's total with the same parts, a
// one-month period and its month column …) are masked together: one number, one way of showing it everywhere.
//
// For hospital admins, the order and presence of rows must never depend on counts beyond each row's own shown
// value (adminView.js puts rows ranked by count in an order that uses only what is sent).
//
// It fails closed: if the check can't finish, or a small number stays pinned with nothing left to hide, it throws
// and nothing is sent (the route answers with a plain error).
//
// Words used here:
//  - cell: one number, named by an id (the admin view's id, see adminView.js);
//  - shown cell: a number that is on a page; virtual cell: a number that is never shown but completes a sum
//    (for example the women without a care plan item) – if it is 1 to 4 it is "sensitive" and must stay unknown;
//  - partition: { kind: 'partition', total, parts } – the parts add up exactly to the total;
//  - subset: { kind: 'subset', sub, sup } – the sub is at most the sup.

export const LT5 = Object.freeze({ masked: 'lt5' });
export const HIDDEN = Object.freeze({ masked: 'hidden' });
// Withheld: a small number or a zero not shown because small numbers and zeros around it would give each other
// away (see maskForAdmin). Shown as "Not shown"; known only to be between 0 and 4 (1 to 4 for a row that is
// only there when its count is at least 1).
export const WITHHELD = Object.freeze({ masked: 'withheld' });

const isSmall = (v) => typeof v === 'number' && v >= 1 && v <= 4;
export const MAX_STEPS = 20_000_000; // a safety stop for the range check; real graphs settle long before
const NOT_SETTLED = 'Masking: the range check did not settle, so no numbers are sent';
const NOT_ADDING_UP = 'Masking: the declared sums do not add up';
// Reduced equations with larger whole numbers than these are left out of the range narrowing (never out of the
// exact solving), so that the narrowing's arithmetic stays exact.
const MAX_COEF = 2n ** 20n;
const MAX_RHS = 2n ** 40n;

/** What a reader knows of one value before working anything out: [lo, hi]. */
function startRange(known, atLeastOne = false) {
  if (typeof known === 'number') return [known, known];
  if (known?.masked === 'lt5') return [1, 4];
  if (known?.masked === 'hidden') return [5, Infinity]; // only exact values of 5 or more are ever hidden
  if (known?.masked === 'withheld') return [atLeastOne ? 1 : 0, 4];
  return [0, Infinity]; // a virtual cell (or "not applicable")
}

// ---------- Whole-number linear algebra (BigInt, exact) ----------

const absB = (x) => (x < 0n ? -x : x);
function gcdB(x, y) {
  let a = absB(x);
  let b = absB(y);
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * An equation row: { coefs: Map column → bigint (never 0), rhs: bigint, comb: Map sum → bigint }. It reads
 * Σ coefs[c]·x[c] = rhs, and it is Σ comb[k] × (declared sum k), with the exact numbers moved to the right.
 * tidy divides the row by the greatest common divisor of all its whole numbers.
 */
function tidy(row) {
  let g = row.rhs;
  for (const v of row.coefs.values()) g = gcdB(g, v);
  for (const v of row.comb.values()) g = gcdB(g, v);
  if (g <= 1n) return;
  for (const [c, v] of row.coefs) row.coefs.set(c, v / g);
  for (const [k, v] of row.comb) row.comb.set(k, v / g);
  row.rhs /= g;
}

function negate(row) {
  for (const [c, v] of row.coefs) row.coefs.set(c, -v);
  for (const [k, v] of row.comb) row.comb.set(k, -v);
  row.rhs = -row.rhs;
}

/** row := a·row − b·q, with a = q's (positive) coefficient of column c and b = row's: column c leaves row. */
function eliminate(row, q, c) {
  const a = q.coefs.get(c);
  const b = row.coefs.get(c);
  const mix = (m, qm) => {
    for (const [k, v] of m) m.set(k, v * a);
    for (const [k, v] of qm) {
      const x = (m.get(k) ?? 0n) - b * v;
      if (x === 0n) m.delete(k);
      else m.set(k, x);
    }
  };
  mix(row.coefs, q.coefs);
  mix(row.comb, q.comb);
  row.rhs = row.rhs * a - b * q.rhs;
  tidy(row);
}

/**
 * Reduced row echelon form, in place: every row kept gets a pivot column (positive coefficient) that no other row
 * has. A column is fixed by the equations exactly when a row has it as its only column. Throws when a row reads
 * 0 = a number other than 0 (the sums do not add up).
 */
function reduceRows(rows) {
  const out = [];
  const pivotOf = new Map();
  for (const row of rows) {
    for (const c of [...row.coefs.keys()]) {
      const q = pivotOf.get(c);
      if (q && row.coefs.has(c)) eliminate(row, q, c);
    }
    if (row.coefs.size === 0) {
      if (row.rhs !== 0n) throw new Error(NOT_ADDING_UP);
      continue;
    }
    // A column with coefficient 1 or −1 keeps the numbers small: the lowest such column, else the lowest column.
    let p = -1;
    for (const [c, v] of row.coefs) if ((v === 1n || v === -1n) && (p < 0 || c < p)) p = c;
    if (p < 0) p = Math.min(...row.coefs.keys());
    if (row.coefs.get(p) < 0n) negate(row);
    for (const q of out) if (q.coefs.has(p)) eliminate(q, row, p);
    row.pivot = p;
    pivotOf.set(p, row);
    out.push(row);
  }
  return out;
}

/** A partition as an equation over columns: total − Σ parts = 0 (a column named twice adds up). */
function sumCoefs(r, col) {
  const m = new Map();
  const add = (c, v) => {
    const x = (m.get(c) ?? 0n) + v;
    if (x === 0n) m.delete(c);
    else m.set(c, x);
  };
  add(col(r.total), 1n);
  for (const p of r.parts) add(col(p), -1n);
  return m;
}

/**
 * Numbers that are the same by construction: a − b is a combination of the declared sums, before any value is
 * known (for example A4.total and A4.all, a one-month period and its month column). Returns, per column, the
 * first column of its group.
 */
function sameNumberGroups(n, sums) {
  const rows = reduceRows(sums.map((coefs) => ({ coefs: new Map(coefs), rhs: 0n, comb: new Map() })));
  const rowOf = new Map(rows.map((r) => [r.pivot, r]));
  const byKey = new Map();
  const first = new Array(n);
  for (let c = 0; c < n; c += 1) {
    // What c is once the sums are used up: itself (a free column), or a combination of the free columns.
    const r = rowOf.get(c);
    let key = `${c}:1/1`;
    if (r) {
      const a = r.coefs.get(c);
      key = [...r.coefs]
        .filter(([j]) => j !== c)
        .sort((x, y) => x[0] - y[0])
        .map(([j, v]) => {
          const g = gcdB(v, a);
          return `${j}:${-v / g}/${a / g}`;
        })
        .join(',');
    }
    if (!byKey.has(key)) byKey.set(key, c);
    first[c] = byKey.get(key);
  }
  return first;
}

// ---------- The graph and the range check ----------

/** A row the range check can narrow through, or null when its whole numbers are too large for exact arithmetic. */
function numberRow(coefs, rhs, extra) {
  if (absB(rhs) > MAX_RHS) return null;
  const cols = [];
  const vals = [];
  for (const [c, v] of coefs) {
    if (absB(v) > MAX_COEF) return null;
    cols.push(c);
    vals.push(Number(v));
  }
  return { subset: false, cols: Int32Array.from(cols), coefs: Float64Array.from(vals), rhs: Number(rhs), ...extra };
}

/**
 * The relations with cells numbered 0…n−1: sums (Map column → bigint, one per partition, in order), and the rows
 * the range check narrows through: one per partition ({ cols, coefs, rhs: 0, sum: k }) and one per subset.
 */
function compile(relations, cellIds) {
  const index = new Map();
  const ids = [];
  const idx = (id) => {
    let i = index.get(id);
    if (i === undefined) {
      i = ids.length;
      index.set(id, i);
      ids.push(id);
    }
    return i;
  };
  for (const id of cellIds) idx(id);
  const sums = [];
  const rows = [];
  for (const r of relations) {
    if (r.kind === 'subset') {
      const sub = idx(r.sub);
      const sup = idx(r.sup);
      if (sub !== sup) rows.push({ subset: true, sub, sup });
      continue;
    }
    const coefs = sumCoefs(r, idx);
    const k = sums.length;
    sums.push(coefs);
    if (coefs.size) rows.push(numberRow(coefs, 0n, { sum: k }));
  }
  return { index, ids, sums, rows };
}

/**
 * Narrows every range a reader could reach, until nothing changes:
 *  - equation Σ a·x = rhs: each x narrows to what rhs minus the others' ranges allows, rounded to whole numbers;
 *  - subset: sub.hi ≤ sup.hi and sup.lo ≥ sub.lo.
 * lo and hi (one entry per cell) are narrowed in place. Returns, per cell, the rows that narrowed it. Throws when
 * it does not settle within maxSteps, or when a range becomes empty (the sums do not add up).
 */
function propagate(rows, n, lo, hi, maxSteps = MAX_STEPS) {
  const byCell = Array.from({ length: n }, () => []);
  rows.forEach((r, i) => {
    for (const c of new Set(r.subset ? [r.sub, r.sup] : r.cols)) byCell[c].push(i);
  });
  const causes = new Array(n).fill(null);
  const queued = new Uint8Array(rows.length).fill(1);
  let queue = rows.map((_, i) => i);
  let head = 0;
  let steps = 0;
  let changedRow = false;
  const narrow = (c, a, b, i) => {
    let changed = false;
    if (a > lo[c]) {
      lo[c] = a;
      changed = true;
    }
    if (b < hi[c]) {
      hi[c] = b;
      changed = true;
    }
    if (!changed) return;
    changedRow = true;
    (causes[c] ??= new Set()).add(i);
    for (const j of byCell[c]) {
      if (j !== i && !queued[j]) {
        queued[j] = 1;
        queue.push(j);
      }
    }
  };
  while (head < queue.length) {
    if (steps >= maxSteps) throw new Error(NOT_SETTLED);
    steps += 1;
    const i = queue[head];
    head += 1;
    queued[i] = 0;
    const r = rows[i];
    changedRow = false;
    if (r.subset) {
      narrow(r.sub, -Infinity, hi[r.sup], i);
      narrow(r.sup, lo[r.sub], Infinity, i);
    } else {
      // The range of each term a·x, and of all terms together (infinite ends counted apart).
      const k = r.cols.length;
      let minF = 0;
      let maxF = 0;
      let minInf = 0;
      let maxInf = 0;
      const mins = new Float64Array(k);
      const maxs = new Float64Array(k);
      for (let t = 0; t < k; t += 1) {
        const c = r.cols[t];
        const a = r.coefs[t];
        const mn = a > 0 ? a * lo[c] : a * hi[c];
        const mx = a > 0 ? a * hi[c] : a * lo[c];
        mins[t] = mn;
        maxs[t] = mx;
        if (mn === -Infinity) minInf += 1;
        else minF += mn;
        if (mx === Infinity) maxInf += 1;
        else maxF += mx;
      }
      for (let t = 0; t < k; t += 1) {
        const a = r.coefs[t];
        const othersMin = minInf - (mins[t] === -Infinity ? 1 : 0) > 0 ? -Infinity : minF - (mins[t] === -Infinity ? 0 : mins[t]);
        const othersMax = maxInf - (maxs[t] === Infinity ? 1 : 0) > 0 ? Infinity : maxF - (maxs[t] === Infinity ? 0 : maxs[t]);
        // a·x lies in [rhs − othersMax, rhs − othersMin].
        let l = (r.rhs - othersMax) / a;
        let h = (r.rhs - othersMin) / a;
        if (a < 0) [l, h] = [h, l];
        narrow(r.cols[t], Math.ceil(l), Math.floor(h), i);
      }
    }
    // Rounding one term can narrow another of the same row: look at the row again.
    if (changedRow && !queued[i]) {
      queued[i] = 1;
      queue.push(i);
    }
    if (head > 1_000_000) {
      queue = queue.slice(head);
      head = 0;
    }
  }
  for (let c = 0; c < n; c += 1) if (lo[c] > hi[c]) throw new Error(NOT_ADDING_UP);
  return causes;
}

/**
 * What a reader works out. lo/hi: the start ranges, narrowed in place; exactValue(c): the number of an exact
 * column, undefined for an unknown one. Returns { reduced (the sums solved exactly over the unknown columns),
 * rows (every row narrowed through), causes }.
 */
function readerModel(g, lo, hi, exactValue, maxSteps) {
  const eqs = g.sums.map((coefs, k) => {
    const row = { coefs: new Map(), rhs: 0n, comb: new Map([[k, 1n]]) };
    for (const [c, v] of coefs) {
      const x = exactValue(c);
      if (x === undefined) row.coefs.set(c, v);
      else row.rhs -= v * BigInt(x);
    }
    return row;
  });
  const reduced = reduceRows(eqs);
  const rows = [...g.rows];
  for (const r of reduced) {
    const row = numberRow(r.coefs, r.rhs, { reduced: r });
    if (row) rows.push(row);
  }
  const causes = propagate(rows, g.ids.length, lo, hi, maxSteps);
  return { reduced, rows, causes };
}

/**
 * What a reader could work out: Map id → { lo, hi }. `known`: Map id → the value the reader has (a number,
 * LT5, HIDDEN, WITHHELD, or nothing for a cell that is never shown). Exported so a test can run it on what was
 * sent. opts: { maxSteps, atLeastOne: ids of rows that are only there when their count is at least 1 }.
 */
export function rangeCheck(known, relations, { maxSteps = MAX_STEPS, atLeastOne = new Set() } = {}) {
  const g = compile(relations, known.keys());
  const n = g.ids.length;
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  g.ids.forEach((id, c) => {
    [lo[c], hi[c]] = startRange(known.get(id), atLeastOne.has(id));
  });
  readerModel(
    g,
    lo,
    hi,
    (c) => {
      const v = known.get(g.ids[c]);
      return typeof v === 'number' ? v : undefined;
    },
    maxSteps,
  );
  return new Map(g.ids.map((id, c) => [id, { lo: lo[c], hi: hi[c] }]));
}

/** Every declared sum must hold for the true numbers (else the masking would reason from something false). */
function checkSums(cells, relations) {
  const v = (id) => cells.get(id).value;
  for (const r of relations) {
    if (r.kind === 'subset') {
      if (typeof v(r.sub) === 'number' && typeof v(r.sup) === 'number' && v(r.sub) > v(r.sup)) throw new Error(`Masking: ${r.sub} is more than ${r.sup}`);
      continue;
    }
    const all = [r.total, ...r.parts].map(v);
    if (all.every((x) => typeof x === 'number') && all[0] !== all.slice(1).reduce((a, b) => a + b, 0)) throw new Error(`Masking: the sum ${r.total} does not add up`);
  }
}

/**
 * Hides small numbers for hospital admins. cells: Map id → { value (a number, or null for "not applicable"),
 * shown (true if it is on a page), atLeastOne (optional: the row is only there when its count is at least 1) };
 * relations: partitions and subsets over those ids. opts: { maxSteps } (the range check's safety stop).
 * Returns { values: Map id → number | LT5 | HIDDEN | WITHHELD | null (shown cells only), sensitive: Set of the
 * virtual ids whose value is 1 to 4, hiddenForProtection: the ids hidden in step 3, in order, withheld: the ids
 * withheld (see below) }.
 *
 * Numbers that are the same by construction are masked as one (sameNumberGroups). Then, each round:
 *  - a small number fixed exactly by the sums (a combination of sums leaves it alone): of the exact numbers the
 *    combination uses (net coefficient not 0), the smallest that is not 0 is hidden;
 *  - otherwise a small number pinned by the ranges: the smallest exact non-zero number of a row that narrowed it
 *    is hidden – first in those rows, then in the rows that narrowed those, and so on.
 * Every small number pinned in a round is dealt with before the check runs again. When no exact number is left
 * to hide (only small numbers and zeros pin each other, for example 4 = 1 + 1 + 1 + 1 + 0 in a very small
 * hospital), hiding cannot help: a hidden number is known to be 5 or more. The small numbers and zeros of the
 * nearest of those rows are then WITHHELD instead: shown as "Not shown", and known only to be between 0 and 4.
 * If even that leaves nothing to do, it throws, and nothing is sent.
 */
export function maskForAdmin(cells, relations, { maxSteps = MAX_STEPS } = {}) {
  const membersOf = (r) => (r.kind === 'subset' ? [r.sub, r.sup] : [r.total, ...r.parts]);
  for (const r of relations) for (const id of membersOf(r)) if (!cells.has(id)) throw new Error(`Masking: a relation names an unknown cell ${id}`);
  checkSums(cells, relations);

  // One number per group of numbers that are the same by construction.
  const ids = [...cells.keys()];
  const at = new Map(ids.map((id, c) => [id, c]));
  const first = sameNumberGroups(
    ids.length,
    relations.filter((r) => r.kind !== 'subset').map((r) => sumCoefs(r, (id) => at.get(id))),
  );
  const groupOf = (id) => ids[first[at.get(id)]];
  const groups = new Map();
  for (const id of ids) {
    const k = groupOf(id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(id);
  }
  const merged = new Map();
  for (const [k, members] of groups) {
    const cs = members.map((id) => cells.get(id));
    if (cs.some((c) => c.value !== cs[0].value)) throw new Error(`Masking: ${members.join(', ')} are the same number by their sums but differ`);
    merged.set(k, { value: cs[0].value, shown: cs.some((c) => c.shown), atLeastOne: cs.some((c) => c.atLeastOne) });
  }
  const groupRelations = relations.map((r) =>
    r.kind === 'subset' ? { kind: 'subset', sub: groupOf(r.sub), sup: groupOf(r.sup) } : { kind: 'partition', total: groupOf(r.total), parts: r.parts.map(groupOf) },
  );
  const core = maskGroups(merged, groupRelations, maxSteps);

  const shownMembers = (k) => groups.get(k).filter((id) => cells.get(id).shown);
  const values = new Map();
  for (const [id, cell] of cells) if (cell.shown) values.set(id, core.values.get(groupOf(id)));
  return {
    values,
    sensitive: new Set([...core.sensitive].flatMap((k) => groups.get(k))),
    hiddenForProtection: core.hidden.flatMap(shownMembers),
    withheld: core.withheld.flatMap(shownMembers),
  };
}

/** maskForAdmin over one cell per group of equal numbers. */
function maskGroups(cells, relations, maxSteps) {
  const g = compile(relations, cells.keys());
  const n = g.ids.length;
  const value = (c) => cells.get(g.ids[c]).value;

  // Step 1, primary: shown 1–4 → "fewer than 5"; virtual 1–4 → sensitive.
  const EXACT = 1;
  const SMALL = 2;
  const HID = 3;
  const HELD = 4;
  const state = new Uint8Array(n); // 0: virtual or "not applicable"
  const sensitive = new Set();
  g.ids.forEach((id, c) => {
    const cell = cells.get(id);
    if (!cell.shown) {
      if (isSmall(cell.value)) sensitive.add(c);
    } else if (cell.value != null) state[c] = isSmall(cell.value) ? SMALL : EXACT;
  });
  const hideable = (c) => state[c] === EXACT && value(c) > 0; // exact and not zero: 5 or more
  const holdable = (c) => state[c] === SMALL || (state[c] === EXACT && value(c) === 0);
  const bySize = (a, b) => value(a) - value(b) || (g.ids[a] < g.ids[b] ? -1 : 1);
  const smaller = (best, c) => (best < 0 || bySize(c, best) < 0 ? c : best);
  // Must stay unknown: shown small numbers (also when withheld) and small numbers never shown.
  const mustStayUnknown = (c) => state[c] === SMALL || (state[c] === HELD && value(c) >= 1) || sensitive.has(c);
  const hidden = [];
  const withheld = [];
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);

  /** The exact columns a reduced row uses, with their net coefficient (Σ over its sums of comb × coefficient). */
  const netExact = (r) => {
    const net = new Map();
    for (const [k, m] of r.comb) {
      for (const [c, v] of g.sums[k]) {
        if (state[c] !== EXACT) continue;
        const x = (net.get(c) ?? 0n) + m * v;
        if (x === 0n) net.delete(c);
        else net.set(c, x);
      }
    }
    return net;
  };

  // Steps 2 and 3: work out what a reader could calculate; while a small number is pinned, hide more.
  for (;;) {
    for (let c = 0; c < n; c += 1) {
      if (state[c] === EXACT) lo[c] = hi[c] = value(c);
      else [lo[c], hi[c]] = startRange([undefined, undefined, LT5, HIDDEN, WITHHELD][state[c]], cells.get(g.ids[c]).atLeastOne);
    }
    const { reduced, rows, causes } = readerModel(g, lo, hi, (c) => (state[c] === EXACT ? value(c) : undefined), maxSteps);
    const toHide = [];
    const toHold = new Set();
    const dealtWith = (cs) => cs.some((c) => toHide.includes(c) || toHold.has(c));

    // (a) Fixed exactly by the sums: hide the smallest exact non-zero number the combination uses.
    const fixed = reduced.filter((r) => r.coefs.size === 1 && mustStayUnknown(r.pivot));
    for (const r of fixed) {
      const a = r.coefs.get(r.pivot);
      if (r.rhs % a !== 0n || Number(r.rhs / a) !== value(r.pivot)) throw new Error(`Masking: ${g.ids[r.pivot]} is worked out wrongly`);
      const net = netExact(r);
      if (dealtWith([...net.keys()])) continue; // a number hidden for another one this round is in it
      let best = -1;
      for (const c of net.keys()) if (hideable(c)) best = smaller(best, c);
      if (best >= 0) {
        toHide.push(best);
        continue;
      }
      const held = [...net.keys()].filter(holdable);
      if (holdable(r.pivot)) held.push(r.pivot);
      if (!held.length) throw new Error(`Masking: ${g.ids[r.pivot]} can be worked out and nothing is left to hide`);
      for (const c of held) toHold.add(c);
    }

    // (b) Otherwise pinned by the ranges: the rows that narrowed it, then the rows that narrowed those.
    if (!fixed.length) {
      const memo = new Map();
      const members = (i) => {
        if (!memo.has(i)) {
          const r = rows[i];
          memo.set(i, r.subset ? [r.sub, r.sup] : r.reduced ? [...r.cols, ...netExact(r.reduced).keys()] : [...r.cols]);
        }
        return memo.get(i);
      };
      for (let t = 0; t < n; t += 1) {
        if (!mustStayUnknown(t) || lo[t] !== hi[t]) continue;
        const firstRows = [...(causes[t] ?? [])].sort((x, y) => x - y);
        if (firstRows.some((i) => dealtWith(members(i)))) continue;
        let chosen = -1;
        let hold = null; // the small numbers and zeros of the nearest rows that have any
        const seenCells = new Set([t]);
        const seenRows = new Set();
        let level = firstRows;
        while (level.length && chosen < 0) {
          for (const i of level) for (const x of members(i)) if (!seenCells.has(x) && hideable(x)) chosen = smaller(chosen, x);
          if (chosen >= 0) break;
          if (!hold) {
            const h = [...new Set(level.flatMap(members))].filter(holdable);
            if (h.length) hold = h;
          }
          const next = [];
          for (const i of level) {
            seenRows.add(i);
            for (const x of members(i)) {
              if (seenCells.has(x)) continue;
              seenCells.add(x);
              for (const j of causes[x] ?? []) if (!seenRows.has(j)) next.push(j);
            }
          }
          level = [...new Set(next)].sort((x, y) => x - y);
        }
        if (chosen >= 0) {
          toHide.push(chosen);
          continue;
        }
        if (holdable(t)) (hold ??= []).push(t);
        if (!hold?.length) throw new Error(`Masking: ${g.ids[t]} can be worked out and nothing is left to hide`);
        for (const c of hold) toHold.add(c);
      }
    }

    if (!toHide.length && !toHold.size) break;
    for (const c of toHide) {
      state[c] = HID;
      hidden.push(g.ids[c]);
    }
    for (const c of toHold) {
      state[c] = HELD;
      withheld.push(g.ids[c]);
    }
  }

  const values = new Map();
  g.ids.forEach((id, c) => {
    if (!cells.get(id).shown) return;
    values.set(id, [null, value(c), LT5, HIDDEN, WITHHELD][state[c]]);
  });
  return { values, sensitive: new Set([...sensitive].map((c) => g.ids[c])), hidden, withheld };
}
