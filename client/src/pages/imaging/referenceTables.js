// Sonography stage 2 (docs/USG_APPS_REVIEW.md U1, U3, U5): reading the hospital's approved reference tables
// (server/src/routes/usgReferences.js – copied in by a doctor from a named published chart, approved by a doctor).
// PURE. No numbers are built in here: with no approved table nothing is judged.

/** The 5th, 50th and 95th centile at `weeks` (decimal), straight between the table's weeks; null outside the table. */
export function bandAt(table, weeks) {
  const rows = table?.rows ?? [];
  if (!rows.length || weeks == null) return null;
  if (weeks < rows[0].week || weeks > rows[rows.length - 1].week) return null;
  const hi = rows.findIndex((r) => r.week >= weeks);
  const b = rows[hi];
  if (b.week === weeks || hi === 0) return { p5: b.p5, p50: b.p50, p95: b.p95 };
  const a = rows[hi - 1];
  const t = (weeks - a.week) / (b.week - a.week);
  const mix = (k) => a[k] + (b[k] - a[k]) * t;
  return { p5: mix('p5'), p50: mix('p50'), p95: mix('p95') };
}

/** Where a value lies: 'below' the 5th, 'within' 5th–95th, 'above' the 95th – or null (no table for these weeks). */
export function bandOf(table, weeks, value) {
  const b = bandAt(table, weeks);
  const v = Number(value);
  if (!b || value === '' || value == null || !Number.isFinite(v)) return null;
  return v < b.p5 ? 'below' : v > b.p95 ? 'above' : 'within';
}
export const BAND_WORDS = { below: 'below the 5th centile', within: 'between the 5th and 95th centile', above: 'above the 95th centile' };

/** The cerebroplacental ratio, MCA PI ÷ UA PI (two decimals), or null. */
export function cprOf(values) {
  const mca = Number(values?.mcaPi);
  const ua = Number(values?.uaPi);
  if (!(mca > 0) || !(ua > 0)) return null;
  return Math.round((mca / ua) * 100) / 100;
}

/** The Doppler indices of a scan, each with its band from the approved tables (CPR worked out). */
export const DOPPLER_INDICES = [
  ['uaPi', 'Umbilical artery PI'],
  ['mcaPi', 'Middle cerebral artery PI'],
  ['cpr', 'Cerebroplacental ratio (MCA PI ÷ UA PI)'],
  ['utaPi', 'Uterine arteries mean PI'],
  ['dvPi', 'Ductus venosus PIV'],
];
export function dopplerRows(values, weeks, references) {
  const v = { ...values, cpr: cprOf(values) };
  return DOPPLER_INDICES.filter(([k]) => v[k] != null && v[k] !== '').map(([k, name]) => {
    const table = references?.[k] ?? null;
    return { key: k, name, value: v[k], band: table ? bandOf(table, weeks, v[k]) : null, source: table?.source ?? null, noTable: !table };
  });
}
