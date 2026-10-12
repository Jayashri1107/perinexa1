// A second reader of what a hospital admin receives (Analytics specification, sections 3.5 and 6.5), written apart
// from src/analytics/mask.js so that the tests do not only trust the masking's own check.
//
// It works out what a reader could calculate from the numbers sent and the declared sums:
//  1. the sums with the numbers sent filled in, solved modulo two large primes (a small number that one of them
//     fixes counts as worked out);
//  2. ranges narrowed through every sum, every "at most" and every solved equation, over and over until nothing
//     changes.
// Fake data only; used by analytics-units.test.js and analytics.test.js.

export const MOD = 67_108_859; // a prime below 2^26: every product of two numbers below it is exact in a double
export const MOD2 = 67_108_837; // the next prime below it

export function powMod(b, e, mod = MOD) {
  let r = 1;
  let x = b % mod;
  let k = e;
  while (k > 0) {
    if (k % 2 === 1) r = (r * x) % mod;
    x = (x * x) % mod;
    k = Math.floor(k / 2);
  }
  return r;
}

/**
 * Rows kept in echelon form over the integers mod `mod` (a pivot of 1, zeros before it), sorted by pivot.
 * widthNow(): the columns in use (columns are only ever added at the end, so later ones are zero).
 */
export function echelon(widthNow, mod = MOD) {
  const rows = [];
  const reduceBy = (v, width) => {
    for (const r of rows) {
      const f = v[r.pivot];
      if (f === 0) continue;
      const m = mod - f;
      for (let j = r.pivot; j < width; j += 1) if (r.v[j] !== 0) v[j] = (v[j] + m * r.v[j]) % mod;
    }
    return v;
  };
  return {
    rows,
    /** Adds a row; true if it was independent of the rows already there. */
    add(values) {
      const width = widthNow();
      const v = reduceBy(Float64Array.from(values), width);
      const pivot = v.findIndex((x) => x !== 0);
      if (pivot < 0) return false;
      const inv = powMod(v[pivot], mod - 2, mod);
      for (let j = pivot; j < width; j += 1) if (v[j] !== 0) v[j] = (v[j] * inv) % mod;
      const at = rows.findIndex((r) => r.pivot > pivot);
      rows.splice(at < 0 ? rows.length : at, 0, { pivot, v });
      return true;
    },
    /** Reduces a copy of a row by these rows: all zeros means it lies in their span. */
    reduce(values) {
      return reduceBy(Float64Array.from(values), widthNow());
    },
    /** Clears every pivot column from the rows above it (reduced row echelon form), in place. */
    backSubstitute() {
      const width = widthNow();
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        for (let k = 0; k < i; k += 1) {
          const f = rows[k].v[rows[i].pivot];
          if (f === 0) continue;
          for (let j = rows[i].pivot; j < width; j += 1) if (rows[i].v[j] !== 0) rows[k].v[j] = (rows[k].v[j] + (mod - f) * rows[i].v[j]) % mod;
        }
      }
      return rows;
    },
  };
}

const members = (r) => (r.kind === 'subset' ? [r.sub, r.sup] : [r.total, ...r.parts]);

function startRange(v, atLeastOne) {
  if (typeof v === 'number') return [v, v];
  if (v?.masked === 'lt5') return [1, 4];
  if (v?.masked === 'hidden') return [5, Infinity];
  if (v?.masked === 'withheld') return [atLeastOne ? 1 : 0, 4];
  return [0, Infinity];
}

/**
 * cells: Map id → { value } (the true numbers); relations: the declared sums; values: Map id → what was sent
 * (a number or { masked }); sensitive: ids never shown whose number is 1 to 4; atLeastOne: ids of rows that are
 * only there when their count is at least 1.
 * Returns { pinned: small numbers a reader can work out exactly, wrong: numbers worked out as something they are
 * not (a fault in this reader) }.
 */
export function readerPins(cells, relations, values, { sensitive = new Set(), atLeastOne = new Set() } = {}) {
  const ids = [...new Set([...cells.keys(), ...relations.flatMap(members)])];
  const sent = (id) => values.get(id);
  const exact = (id) => (typeof sent(id) === 'number' ? sent(id) : undefined);
  const trueValue = (id) => cells.get(id)?.value;
  const mustStayUnknown = (id) => {
    const v = sent(id);
    const t = trueValue(id);
    return v?.masked === 'lt5' || (v?.masked === 'withheld' && t >= 1) || sensitive.has(id);
  };
  const unknown = ids.filter((id) => exact(id) === undefined);
  const col = new Map(unknown.map((id, j) => [id, j]));
  const U = unknown.length;
  const W = U + 1; // the last column holds the numbers sent, moved to the right
  const sums = relations.filter((r) => r.kind === 'partition');
  const pinned = new Set();
  const wrong = [];
  const signed = (v, mod) => (v > mod / 2 ? v - mod : v);

  // 1. The sums solved modulo each prime.
  let reducedRows = [];
  for (const mod of [MOD, MOD2]) {
    const ech = echelon(() => W, mod);
    for (const r of sums) {
      const v = new Float64Array(W);
      const add = (id, c) => {
        const x = exact(id);
        if (x === undefined) v[col.get(id)] = (v[col.get(id)] + c + mod) % mod;
        else v[U] = (v[U] + ((((-c * x) % mod) + mod) % mod)) % mod;
      };
      add(r.total, 1);
      for (const p of r.parts) add(p, -1);
      ech.add(v);
    }
    const rows = ech.backSubstitute();
    if (rows.some((r) => r.pivot === U)) throw new Error('The sums with the numbers sent do not add up');
    for (const r of rows) {
      let alone = true;
      for (let j = 0; j < U && alone; j += 1) if (j !== r.pivot && r.v[j] !== 0) alone = false;
      if (!alone) continue;
      const id = unknown[r.pivot];
      const worked = signed(r.v[U], mod);
      if (trueValue(id) != null && worked !== trueValue(id)) wrong.push(`${id} = ${trueValue(id)} solved as ${worked}`);
      if (mustStayUnknown(id)) pinned.add(id);
    }
    if (mod === MOD) reducedRows = rows;
  }

  // 2. Ranges. A solved row is used with whole-number coefficients: it is multiplied by the smallest number up to
  // 64 that makes every coefficient small (a row that needs more is left out, which only makes this reader weaker).
  const lo = new Map();
  const hi = new Map();
  for (const id of ids) {
    const [a, b] = startRange(sent(id), atLeastOne.has(id));
    lo.set(id, a);
    hi.set(id, b);
  }
  const eqs = [];
  for (const r of sums) eqs.push({ terms: [[r.total, 1], ...r.parts.map((p) => [p, -1])], rhs: 0 });
  for (const r of reducedRows) {
    for (let m = 1; m <= 64; m += 1) {
      const terms = [];
      let ok = true;
      for (let j = 0; j < U && ok; j += 1) {
        if (r.v[j] === 0) continue;
        const c = signed((r.v[j] * m) % MOD, MOD);
        if (Math.abs(c) > 1e6) ok = false;
        else terms.push([unknown[j], c]);
      }
      const rhs = signed((r.v[U] * m) % MOD, MOD);
      if (ok && Math.abs(rhs) < 1e9) {
        eqs.push({ terms, rhs });
        break;
      }
    }
  }
  const subsets = relations.filter((r) => r.kind === 'subset');
  const narrow = (id, a, b) => {
    let changed = false;
    if (a > lo.get(id)) {
      lo.set(id, a);
      changed = true;
    }
    if (b < hi.get(id)) {
      hi.set(id, b);
      changed = true;
    }
    return changed;
  };
  let passes = 0;
  for (let changed = true; changed; passes += 1) {
    if (passes > 100_000) throw new Error('The ranges did not settle');
    changed = false;
    for (const { terms, rhs } of eqs) {
      for (const [id, c] of terms) {
        // c·x = rhs − Σ others
        let oMin = 0;
        let oMax = 0;
        for (const [o, k] of terms) {
          if (o === id) continue;
          oMin += k > 0 ? k * lo.get(o) : k * hi.get(o);
          oMax += k > 0 ? k * hi.get(o) : k * lo.get(o);
        }
        // An id named twice in one sum: leave that sum to the solved rows.
        if (terms.filter(([o]) => o === id).length > 1) continue;
        let a = (rhs - oMax) / c;
        let b = (rhs - oMin) / c;
        if (c < 0) [a, b] = [b, a];
        if (narrow(id, Number.isNaN(a) ? -Infinity : Math.ceil(a), Number.isNaN(b) ? Infinity : Math.floor(b))) changed = true;
      }
    }
    for (const r of subsets) {
      if (narrow(r.sub, -Infinity, hi.get(r.sup))) changed = true;
      if (narrow(r.sup, lo.get(r.sub), Infinity)) changed = true;
    }
  }
  for (const id of ids) {
    const t = trueValue(id);
    if (t != null && !(lo.get(id) <= t && t <= hi.get(id))) wrong.push(`${id} = ${t} outside [${lo.get(id)}, ${hi.get(id)}]`);
    if (mustStayUnknown(id) && lo.get(id) === hi.get(id)) pinned.add(id);
  }
  return { pinned: [...pinned].sort(), wrong };
}
