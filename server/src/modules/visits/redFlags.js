// Red-flag alerts (as in Perinexa's redflags/redFlags.js): warnings worked out from values recorded for a patient –
// the latest visit of her care, the visit before it (weight gain), and her latest lab results that were reported
// within the last few days. Only the hospital's APPROVED red-flag rules are used. Decision support: a flag is raised
// only from values actually recorded (a missing value never raises or clears one), every flag says which value raised
// it and when, and flags are worked out when read – never stored. PURE – no database.
import { config } from '../../config/index.js';

const DAY = 86400000;
const URINE_ORDER = ['nil', 'trace', '1+', '2+', '3+', '4+'];
const OEDEMA_ORDER = ['none', 'mild', 'moderate', 'severe'];
const GRADE_ORDER = { urineAlbumin: URINE_ORDER, urineSugar: URINE_ORDER, labUrineAlbumin: URINE_ORDER, oedema: OEDEMA_ORDER };
// A rule joining values from different places (a visit and the lab) is raised only when they were recorded this close.
export const RULE_VALUES_WITHIN_DAYS = 7;

// Lab result → factor: which test and value give it (Perinexa's LAB_FACTOR_SOURCES).
const LAB_SOURCES = {
  labHb: { cbc: 'hb', hb: 'hb', nb_cbc: 'hb' },
  labPlatelets: { cbc: 'platelets', nb_cbc: 'platelets' },
  labFastingGlucose: { fbs: 'fbs' },
  labOgtt2h: { ogtt: 'glucose2h' },
  labPostMealGlucose: { ppbs: 'ppbs' },
  labRandomGlucose: { rbs: 'rbs' },
  labTsh: { tsh: 'tsh', nb_tsh: 'tsh' },
  labUrineAlbumin: { urine: 'albumin' },
  labBabyGlucose: { nb_sugar: 'glucose' },
  labBilirubinTotal: { nb_bilirubin: 'total' },
  labBilirubinDirect: { nb_bilirubin: 'direct' },
};

const numberOf = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, '').trim());
  return v === '' || v == null || Number.isNaN(n) ? null : n;
};
const lower = (v) => (typeof v === 'string' ? v.toLowerCase() : v);

/**
 * The facts the rules look at: { factor: { value, source: 'visit'|'lab', at } }.
 * visit: the latest visit of this care; previous: the visit before it with a weight; labOrders: her reported orders
 * (newest first); edd: her due date (weeks of pregnancy); since: the start of this care (lab results before it are
 * left out).
 */
export function redFlagFacts({ visit, previous = null, labOrders = [], edd = null, since = null }) {
  const facts = {};
  const put = (factor, value, source, at) => {
    if (value === null || value === undefined || value === '') return;
    facts[factor] = { value: lower(value), source, at };
  };
  if (visit) {
    const at = visit.visitOn;
    const v = visit.vitals ?? {};
    const d = visit.details ?? {};
    for (const k of ['bpSystolic', 'bpDiastolic', 'pulse', 'temperatureF', 'spo2', 'hb', 'urineAlbumin', 'urineSugar']) put(k, v[k], 'visit', at);
    for (const k of ['fetalHeartRate', 'presentation', 'fetalMovements', 'oedema']) put(k, d[k], 'visit', at);
    if (edd) {
      const days = Math.floor((new Date(visit.visitOn) - (new Date(edd) - config.patients.eddDays * DAY)) / DAY);
      if (days >= 0) {
        put('weeksToday', Math.floor(days / 7), 'visit', at);
        if (d.fundalHeightCm != null) put('fundalHeightGap', Math.abs(d.fundalHeightCm - Math.floor(days / 7)), 'visit', at);
      }
    }
    if (previous?.vitals?.weightKg != null && v.weightKg != null) {
      const weeks = (new Date(visit.visitOn) - new Date(previous.visitOn)) / (7 * DAY);
      if (weeks >= 1) put('weightGainPerWeek', Math.round(((v.weightKg - previous.vitals.weightKg) / weeks) * 10) / 10, 'visit', at);
    }
  }
  // the latest reported value of each lab factor, newest order first; an amended report already replaced its values
  for (const order of labOrders) {
    if (!['reported', 'reviewed'].includes(order.status)) continue;
    const at = order.reported?.at ?? order.updatedAt;
    if (since && at < since) continue;
    for (const [factor, tests] of Object.entries(LAB_SOURCES)) {
      if (facts[factor]) continue;
      for (const t of order.tests) {
        const key = tests[t.key];
        const value = key && t.values.find((x) => x.key === key)?.value;
        if (value == null || value === '') continue;
        put(factor, factor === 'labUrineAlbumin' ? value : numberOf(value), 'lab', at);
        break;
      }
    }
  }
  return facts;
}

function check(c, facts) {
  const f = facts[c.factor];
  if (!f) return null;
  const v = f.value;
  if (c.op) {
    if (typeof v !== 'number') return null;
    return { lt: v < c.value, lte: v <= c.value, gt: v > c.value, gte: v >= c.value, eq: v === c.value }[c.op] ?? null;
  }
  if (c.grade) {
    const order = GRADE_ORDER[c.factor] ?? URINE_ORDER;
    const at = order.indexOf(v);
    const min = order.indexOf(lower(c.grade));
    return at < 0 || min < 0 ? null : at >= min;
  }
  if (c.choices) return c.choices.map(lower).includes(v);
  return null;
}

/**
 * The flags raised: [{ key, label, level, message, text, values: [{ factor, value, source, at }] }], Urgent first.
 * rules: the approved rules in use; careType: the patient's type of care; weeks / ageDays: for the rules' windows.
 */
export function evaluateRedFlags(rules, facts, { careType, weeks = null }) {
  const out = [];
  for (const r of rules) {
    if (r.active === false) continue;
    if (!(r.appliesTo?.length ? r.appliesTo : ['antenatal']).includes(careType)) continue;
    if ((r.fromWeek != null || r.toWeek != null) && (weeks == null || (r.fromWeek != null && weeks < r.fromWeek) || (r.toWeek != null && weeks > r.toWeek))) continue;
    const results = r.conditions.map((c) => check(c, facts));
    if (!results.length || results.some((x) => x !== true)) continue;
    const used = r.conditions.map((c) => ({ factor: c.factor, ...facts[c.factor] }));
    const times = used.map((u) => new Date(u.at).getTime());
    if (Math.max(...times) - Math.min(...times) > RULE_VALUES_WITHIN_DAYS * DAY) continue;
    out.push({ key: r.key, label: r.label, level: r.level, message: r.message, text: r.text, values: used });
  }
  // the same label raised twice (e.g. systolic and diastolic) shows once
  const seen = new Set();
  return out
    .sort((a, b) => (a.level === b.level ? 0 : a.level === 'urgent' ? -1 : 1))
    .filter((f) => (seen.has(f.label) ? false : seen.add(f.label)));
}
