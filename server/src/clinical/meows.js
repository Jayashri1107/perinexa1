// MEOWS – the Modified Early Obstetric Warning Score chart (Clinical Requirements Group B, item 8 – PX-OBG-11), as the
// hospital manual's page OBG-F-05 v1.0 gives it (field schema docs/field_schemas/build8_meows.json; escalation from
// OBG-SOP-11 §1–2 and OBG-SOP-12 §2). The owner approved the schema as clinical content (7 Nov 2026, through the
// developer); v1.0 masters, the department lead's sign-off on fake data is still to come.
// Rule: one RED reading, or two AMBER readings at the same time, is a TRIGGER (E1: the resident at the bedside within
// 30 min, observations repeated within 30 min, the consultant told). Two RED (or E1 for 60 min without improvement) is
// E2. A shock index of 0.9 or more is E3. Nurse concern alone is a valid trigger (counts as one red – SOP-11 §1).
// Nothing is decided by the chart: it says who to tell and when; the doctor decides.
// The website keeps the same table (client/src/pages/inpatient/meowsRules.js); a server test checks both copies.

export const MEOWS_SOURCE = 'OBG-F-05 v1.0; OBG-SOP-11 §1–2; OBG-SOP-12 §2';
export const MEOWS_FORM = { code: 'OBG-F-05', version: '1.0' };

// Ranges: `from` (≥), `to` (≤), `below` (<), `above` (>). Each reading lands in red, amber or normal; red is checked
// first. "35–36" on the page is read as 35.0 to 36.0 °C inclusive, "37.5–37.9" as 37.5 up to (not including) 38.
export const MEOWS_PARAMETERS = [
  { key: 'rr', label: 'Respiratory rate', unit: '/min', min: 4, max: 60, red: [{ below: 10 }, { above: 30 }], amber: [{ from: 21, to: 30 }], redText: '<10 or >30', amberText: '21–30' },
  { key: 'spo2', label: 'SpO2', unit: '%', min: 50, max: 100, red: [{ below: 92 }], amber: [{ from: 92, to: 94 }], redText: '<92', amberText: '92–94' },
  { key: 'tempC', label: 'Temperature', unit: '°C', min: 33, max: 42, red: [{ below: 35 }, { from: 38 }], amber: [{ from: 35, to: 36 }, { from: 37.5, below: 38 }], redText: '<35 or ≥38', amberText: '35–36 or 37.5–37.9' },
  { key: 'hr', label: 'Pulse', unit: '/min', min: 20, max: 220, red: [{ below: 40 }, { above: 120 }], amber: [{ from: 40, to: 50 }, { from: 100, to: 120 }], redText: '<40 or >120', amberText: '40–50 or 100–120' },
  { key: 'sbp', label: 'Systolic BP', unit: 'mmHg', min: 40, max: 260, red: [{ below: 90 }, { from: 160 }], amber: [{ from: 90, to: 100 }, { from: 150, below: 160 }], redText: '<90 or ≥160', amberText: '90–100 or 150–159' },
  { key: 'dbp', label: 'Diastolic BP', unit: 'mmHg', min: 20, max: 160, red: [{ from: 110 }], amber: [{ from: 90, below: 110 }], redText: '≥110', amberText: '90–109' },
  { key: 'urine4h', label: 'Urine in 4 h', unit: 'mL', min: 0, max: 3000, red: [{ below: 100 }], amber: [{ from: 100, to: 120 }], redText: '<100', amberText: '100–120', optional: true },
  { key: 'pain', label: 'Pain score', unit: '/10', min: 0, max: 10, red: [], amber: [{ from: 7 }], redText: '', amberText: '≥7', optional: true },
];

// Consciousness (AVPU), with new confusion: one row on the page – Pain or Unresponsive red; Voice or new confusion amber.
export const AVPU = { A: 'Alert', V: 'Responds to voice', P: 'Responds to pain', U: 'Unresponsive' };
const AVPU_BAND = { A: 'normal', V: 'amber', P: 'red', U: 'red' };
export const LOCHIA = { normal: 'Normal', heavy: 'Heavy', offensive: 'Offensive', heavy_and_offensive: 'Heavy and offensive', na: 'Not applicable' };
const LOCHIA_BAND = { normal: 'normal', heavy: 'red', offensive: 'red', heavy_and_offensive: 'red', na: null };
export const FUNDUS = { firm: 'Firm', soft: 'Soft', rising: 'Rising', na: 'Not applicable' };
const FUNDUS_BAND = { firm: 'normal', soft: 'red', rising: 'red', na: null };
export const WOUND = { normal: 'Normal', concern: 'Concern', na: 'Not applicable' };

// The rows of the page that are counted, in its order; nurse concern counts as one red.
export const CHOICE_ROWS = [
  { key: 'avpu', label: 'Consciousness (AVPU) / new confusion', redText: 'P or U', amberText: 'V or new confusion' },
  { key: 'lochia', label: 'Lochia / PV loss', redText: 'Heavy or offensive', amberText: '' },
  { key: 'fundus', label: 'Fundus', redText: 'Soft or rising', amberText: '' },
  { key: 'nurseConcern', label: 'Nurse concern', redText: 'Yes', amberText: '' },
];
export const MEOWS_KEYS = [...MEOWS_PARAMETERS.map((p) => p.key), ...CHOICE_ROWS.map((r) => r.key)];
// The core observations: "not recorded" is said for these (urine and pain are optional on the page).
export const CORE_KEYS = ['rr', 'spo2', 'tempC', 'hr', 'sbp', 'dbp', 'avpu'];

// Chart header: the context and how often the doctor ordered the observations (minutes). 5 is kept for the PPH chart
// (Build 15), which may set it later; the ward's choice list is the page's.
export const CONTEXTS = { antenatal: 'Antenatal', postnatal: 'Postnatal', post_operative: 'Post-operative', hdu: 'HDU' };
export const FREQUENCIES = [5, 15, 30, 60, 240, 480];
export const ORDERABLE_FREQUENCIES = [15, 30, 60, 240, 480];
export const OVERDUE_GRACE_MINUTES = 15; // E4: overdue at the ordered frequency + 15 min
export const E1_REPEAT_MINUTES = 30; // E1: repeat the observations within 30 min; the resident at the bedside within 30 min
export const E2_NO_IMPROVEMENT_MINUTES = 60; // E2: E1 open for 60 min without improvement
export const SHOCK_INDEX_RED = 0.9;

const inRange = (v, r) => (r.from == null || v >= r.from) && (r.to == null || v <= r.to) && (r.below == null || v < r.below) && (r.above == null || v > r.above);
const blank = (v) => v == null || v === '';

/** The band of one reading: 'red', 'amber', 'normal', or null when not recorded. PURE. */
export function bandOf(key, value, values = {}) {
  if (key === 'avpu') {
    const a = blank(value) ? null : (AVPU_BAND[value] ?? null);
    if (a === 'red') return 'red';
    if (values.confusion === true) return 'amber';
    return a;
  }
  if (key === 'nurseConcern') return value === true ? 'red' : value === false ? 'normal' : null;
  if (key === 'lochia') return blank(value) ? null : (LOCHIA_BAND[value] ?? null);
  if (key === 'fundus') return blank(value) ? null : (FUNDUS_BAND[value] ?? null);
  if (blank(value)) return null;
  const p = MEOWS_PARAMETERS.find((x) => x.key === key);
  const v = Number(value);
  if (!p || !Number.isFinite(v)) return null;
  if (p.red.some((r) => inRange(v, r))) return 'red';
  if (p.amber.some((r) => inRange(v, r))) return 'amber';
  return 'normal';
}

/** Shock index = pulse ÷ systolic BP, two decimals, or null. PURE. */
export function shockIndex(hr, sbp) {
  if (blank(hr) || blank(sbp)) return null;
  const h = Number(hr);
  const s = Number(sbp);
  if (!Number.isFinite(h) || !Number.isFinite(s) || s <= 0) return null;
  return Math.round((h / s) * 100) / 100;
}

/** Systolic 160 or more, or diastolic 110 or more: treat within 30 min (OBG-SOP-03; OBG-F-15). PURE. */
export const hypertensiveEmergency = (sbp, dbp) => (!blank(sbp) && Number(sbp) >= 160) || (!blank(dbp) && Number(dbp) >= 110);

/**
 * The whole set: each row's band, how many red and amber, the level – 'trigger' (E1: one red or two amber), 'watch'
 * (one amber: repeat sooner) or 'normal' – the escalation rules it meets on its own (E1, E2 for two red, E3 for the
 * shock index), the shock index, the hypertensive emergency, and which core observations were not recorded. PURE.
 */
export function meowsResult(values = {}) {
  const bands = Object.fromEntries(MEOWS_KEYS.map((k) => [k, bandOf(k, values[k], values)]));
  const reds = MEOWS_KEYS.filter((k) => bands[k] === 'red').length;
  const ambers = MEOWS_KEYS.filter((k) => bands[k] === 'amber').length;
  const level = reds >= 1 || ambers >= 2 ? 'trigger' : ambers === 1 ? 'watch' : 'normal';
  const si = shockIndex(values.hr, values.sbp);
  const shockRed = si != null && si >= SHOCK_INDEX_RED;
  const escalation = [...(level === 'trigger' ? ['E1'] : []), ...(reds >= 2 ? ['E2'] : []), ...(shockRed ? ['E3'] : [])];
  return { bands, reds, ambers, level, escalation, shockIndex: si, shockIndexRed: shockRed, hypertensiveEmergency: hypertensiveEmergency(values.sbp, values.dbp), missing: CORE_KEYS.filter((k) => bands[k] == null) };
}

/**
 * When the next observations are due (E1 brings it forward to 30 min after the trigger) and whether they are overdue
 * (E4: more than 15 min past due). last: the latest set's clinical time and level (or null: due from `since`, the
 * chart's start). frequency: the ordered minutes (null: nothing ordered – overdue only after a trigger). PURE.
 */
export function nextDue({ frequency, last, since }, now) {
  const from = last?.at ?? since;
  const after = (m) => new Date(from).getTime() + m * 60_000;
  const times = [...(frequency && from ? [after(frequency)] : []), ...(last?.level === 'trigger' ? [after(E1_REPEAT_MINUTES)] : [])];
  if (!times.length) return { dueAt: null, overdue: false };
  const due = Math.min(...times);
  return { dueAt: new Date(due), overdue: new Date(now).getTime() > due + OVERDUE_GRACE_MINUTES * 60_000 };
}

/** °F → °C, one decimal. PURE. */
export const toCelsius = (f) => Math.round(((Number(f) - 32) * 5) / 9 * 10) / 10;
