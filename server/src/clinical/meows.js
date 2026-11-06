// MEOWS – the Modified Early Obstetric Warning Score chart (Clinical Requirements Group B, item 8 – PX-OBG-11).
// DRAFT, built from published guidance before the manual page OBG-F-05 was given (owner's choice, 6 Nov 2026): every
// trigger below is to be checked against OBG-F-05 by the Lead Obstetrician and replaced by it. Needs the owner's
// approval as clinical content before it goes to main.
// Source: CEMACH, Saving Mothers' Lives 2003–2005 (2007) – the recommended MEOWS chart; Singh S et al., A validation
// study of the CEMACH recommended modified early obstetric warning system (MEOWS), Anaesthesia 2012;67:12–18.
// Rule: one red reading, or two yellow readings at the same time, is a TRIGGER – tell the doctor now (urgent medical
// review). One yellow reading: watch – repeat the observations sooner. Nothing is decided by the chart: it says who
// to tell; the doctor decides.
// The website keeps the same table (client/src/pages/inpatient/meowsRules.js); a server test checks both copies.

export const MEOWS_SOURCE = "CEMACH, Saving Mothers' Lives 2003–2005 (2007) – recommended MEOWS chart; Singh S et al., Anaesthesia 2012;67:12–18";

// Each parameter: its label, unit, and the ranges that are red or yellow (anything else is normal). [low, high)
// ranges use "below" and "from" (inclusive) so every value lands in exactly one band.
export const MEOWS_PARAMETERS = [
  { key: 'rr', label: 'Respiratory rate', unit: '/min', min: 0, max: 80, red: [{ below: 10 }, { from: 31 }], yellow: [{ from: 21, below: 31 }] },
  { key: 'spo2', label: 'SpO2', unit: '%', min: 50, max: 100, red: [{ below: 95 }], yellow: [] },
  { key: 'tempC', label: 'Temperature', unit: '°C', min: 30, max: 43, red: [{ below: 35 }, { from: 38 }], yellow: [{ from: 35, below: 36 }] },
  { key: 'sbp', label: 'Systolic BP', unit: 'mmHg', min: 40, max: 260, red: [{ below: 90 }, { from: 160 }], yellow: [{ from: 90, below: 100 }, { from: 150, below: 160 }] },
  { key: 'dbp', label: 'Diastolic BP', unit: 'mmHg', min: 20, max: 160, red: [{ from: 100 }], yellow: [{ from: 90, below: 100 }] },
  { key: 'hr', label: 'Heart rate', unit: '/min', min: 20, max: 250, red: [{ below: 40 }, { from: 120 }], yellow: [{ from: 40, below: 50 }, { from: 100, below: 120 }] },
];
// Consciousness (AVPU): Alert normal; Voice yellow; Pain or Unresponsive red.
export const AVPU = { A: 'Alert', V: 'Responds to voice', P: 'Responds to pain', U: 'Unresponsive' };
const AVPU_BAND = { A: 'normal', V: 'yellow', P: 'red', U: 'red' };

const inRange = (v, r) => (r.from == null || v >= r.from) && (r.below == null || v < r.below);
/** The band of one reading: 'red', 'yellow', 'normal', or null when not recorded. PURE. */
export function bandOf(key, value) {
  if (value == null || value === '') return null;
  if (key === 'avpu') return AVPU_BAND[value] ?? null;
  const p = MEOWS_PARAMETERS.find((x) => x.key === key);
  const v = Number(value);
  if (!p || !Number.isFinite(v)) return null;
  if (p.red.some((r) => inRange(v, r))) return 'red';
  if (p.yellow.some((r) => inRange(v, r))) return 'yellow';
  return 'normal';
}

export const MEOWS_KEYS = [...MEOWS_PARAMETERS.map((p) => p.key), 'avpu'];

/**
 * The whole set: each reading's band, how many red and yellow, and the level – 'trigger' (one red or two yellow:
 * tell the doctor now), 'watch' (one yellow: repeat sooner) or 'normal' – and which readings were not recorded. PURE.
 */
export function meowsResult(values = {}) {
  const bands = Object.fromEntries(MEOWS_KEYS.map((k) => [k, bandOf(k, values[k])]));
  const reds = MEOWS_KEYS.filter((k) => bands[k] === 'red').length;
  const yellows = MEOWS_KEYS.filter((k) => bands[k] === 'yellow').length;
  const level = reds >= 1 || yellows >= 2 ? 'trigger' : yellows === 1 ? 'watch' : 'normal';
  return { bands, reds, yellows, level, missing: MEOWS_KEYS.filter((k) => bands[k] == null) };
}

/** °F → °C, one decimal. PURE. */
export const toCelsius = (f) => Math.round(((Number(f) - 32) * 5) / 9 * 10) / 10;
