// The website copy of server/src/lab/labCalcs.js (a test checks they agree): values worked out from others of the
// same test, shown in the result form while typing; the server works them out again when the results are saved.
// A value the lab types (an analyser's own MCV) is kept as typed.
// No imports: plain arithmetic only.
//
// Sources (standard formulas): red cell indices (Wintrobe); globulin and A/G ratio; Friedewald LDL (not valid with
// triglycerides of 400 mg/dL or more – then not worked out).

export const CALCS = {
  mcv: { inputs: ['pcv', 'rbc'], digits: 1, fn: (pcv, rbc) => (pcv / rbc) * 10 },
  mch: { inputs: ['hb', 'rbc'], digits: 1, fn: (hb, rbc) => (hb / rbc) * 10 },
  mchc: { inputs: ['hb', 'pcv'], digits: 1, fn: (hb, pcv) => (hb / pcv) * 100 },
  indirectBilirubin: { inputs: ['bilirubin', 'directBilirubin'], digits: 2, fn: (total, direct) => total - direct },
  globulin: { inputs: ['totalProtein', 'albumin'], digits: 1, fn: (total, albumin) => total - albumin },
  agRatio: { inputs: ['albumin', 'totalProtein'], digits: 2, fn: (albumin, total) => (total - albumin > 0 ? albumin / (total - albumin) : NaN) },
  ldl: { inputs: ['totalChol', 'hdl', 'tg'], digits: 0, fn: (chol, hdl, tg) => (tg >= 400 ? NaN : chol - hdl - tg / 5) },
  vldl: { inputs: ['tg'], digits: 0, fn: (tg) => (tg >= 400 ? NaN : tg / 5) },
  cholHdlRatio: { inputs: ['totalChol', 'hdl'], digits: 1, fn: (chol, hdl) => chol / hdl },
};

/** In words, for the result form and the printed report. */
export const CALC_WORDS = {
  mcv: 'PCV ÷ RBC × 10',
  mch: 'Hb ÷ RBC × 10',
  mchc: 'Hb ÷ PCV × 100',
  indirectBilirubin: 'total − direct bilirubin',
  globulin: 'total protein − albumin',
  agRatio: 'albumin ÷ globulin',
  ldl: 'Friedewald: total cholesterol − HDL − triglycerides ÷ 5 (not with triglycerides of 400 or more)',
  vldl: 'triglycerides ÷ 5',
  cholHdlRatio: 'total cholesterol ÷ HDL',
};

/**
 * The worked-out value as text ("85.3"), or null when an input is missing or not a number, or the answer is not a
 * positive number. numbers: { fieldKey: number } – the values typed for this test.
 */
export function calculate(name, numbers) {
  const c = CALCS[name];
  if (!c) return null;
  const args = c.inputs.map((k) => numbers[k]);
  if (args.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
  const out = c.fn(...args);
  if (!Number.isFinite(out) || out < 0) return null;
  return out.toFixed(c.digits);
}
