// Automatic risk assessment for antenatal patients.
//
// The rules come from the patient's care-plan template (doctor-approved), so doctors control them.
// This is DECISION SUPPORT: it shows the level together with the reasons, never hides missing
// information ("incomplete" instead of "low"), and a doctor can always override it with a reason.

import { currentAge } from '../models/Patient.js';
import { currentFindingEntries } from '../patients/pregnancyFindings.js';
import { dateWords, toHospitalDate } from './dates.js';

export const RISK_LEVELS = ['high', 'moderate']; // levels a rule can raise
export const ASSESSED_LEVELS = ['high', 'moderate', 'low', 'incomplete']; // results
export const OVERRIDE_LEVELS = ['high', 'moderate', 'low'];
export const RISK_OPS = ['lt', 'lte', 'gt', 'gte', 'eq'];
// Increase whenever the meaning of the evaluation in this file changes; results from older logic are recalculated.
// 1 = first version (7723c3d), 2 = explicit 'none known', may-be-higher, review flags, age re-check date,
// 3 = missing G, P and A named one by one, 4 = findings in this pregnancy and measured readings (lowest
// haemoglobin, latest blood pressure), with what was recorded but has no rule ("doctor to assess").
export const RISK_ENGINE_VERSION = 4;

// What the rules can look at. `needs` = the information that must be recorded for the rule to be checked.
export const RISK_FACTORS = {
  age: { label: 'Age', unit: 'years', type: 'number', needs: 'Age' },
  heightCm: { label: 'Height', unit: 'cm', type: 'number', needs: 'Height' },
  weightKg: { label: 'Weight', unit: 'kg', type: 'number', needs: 'Weight' },
  // BMI needs both height and weight; only the missing one(s) are listed.
  bmi: { label: 'BMI', unit: 'kg/m²', type: 'number', needs: (f) => [f.heightCm == null && 'Height', f.weightKg == null && 'Weight'].filter(Boolean) },
  // Each count names itself, so one blank number doesn't read as if the whole G P L A were missing.
  gravida: { label: 'Gravida', unit: '', type: 'number', needs: 'Gravida (G) – number of pregnancies' },
  para: { label: 'Para', unit: '', type: 'number', needs: 'Para (P) – number of deliveries' },
  abortions: { label: 'Abortions / miscarriages', unit: '', type: 'number', needs: 'Abortions / miscarriages (A) – enter 0 if none' },
  previousCaesareans: { label: 'Previous caesareans', unit: '', type: 'number', needs: 'Number of previous caesareans' },
  rhNegative: { label: 'Rh-negative blood group', type: 'flag', needs: 'Blood group' },
  // Nothing ticked is NOT the same as "none": the list counts as known only if something is ticked or
  // staff confirmed "none known" (for previous pregnancies: or this is the first pregnancy).
  condition: { label: 'Pre-existing condition', type: 'condition', needs: 'Pre-existing conditions (tick any, or confirm none known)' },
  pastComplication: { label: 'Problem in a previous pregnancy', type: 'complication', needs: 'Problems in previous pregnancies (tick any, or confirm none)' },
  // A finding ticked on the record for THIS pregnancy. Unticked means "not found so far" – never "unknown":
  // findings arise as the pregnancy goes on, so there is nothing to confirm as "none".
  finding: { label: 'Finding in this pregnancy', type: 'finding' },
  // Readings of this pregnancy (careplans/readings.js). `measured` = the reading by name: a rule on a reading
  // that was not measured yet is not checked and the reading is listed as "not measured yet" – it never makes
  // the result "incomplete" (a reading is found over time, like the findings above).
  lowestHb: { label: 'Lowest haemoglobin in this pregnancy', unit: 'g/dL', type: 'number', measured: 'Haemoglobin (Hb)' },
  bpSystolic: { label: 'Latest blood pressure, upper number (systolic)', unit: 'mmHg', type: 'number', measured: 'Blood pressure' },
  bpDiastolic: { label: 'Latest blood pressure, lower number (diastolic)', unit: 'mmHg', type: 'number', measured: 'Blood pressure' },
};

// The readings of this pregnancy and the rule factors that look at each of them.
export const READING_FACTORS = { lowestHb: ['lowestHb'], latestBp: ['bpSystolic', 'bpDiastolic'] };

const OP_TEXT = { lt: 'under', lte: 'at most', gt: 'over', gte: 'at least', eq: 'exactly' };
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * A current first pregnancy: antenatal, gravida 1, and nothing recorded that shows an earlier pregnancy.
 * Then there are no previous pregnancies to have had problems in.
 */
export function isFirstPregnancy(patient) {
  const o = patient.obstetric ?? {};
  return patient.careType === 'antenatal' && o.gravida === 1 && !(o.para > 0) && !(o.abortions > 0) && !(o.previousCaesareans > 0);
}

/** The facts about a patient that rules can check (null = not recorded). */
export function patientFacts(patient, now = new Date()) {
  const m = patient.medical ?? {};
  const o = patient.obstetric ?? {};
  const bmi = m.heightCm && m.weightKg ? round1(m.weightKg / (m.heightCm / 100) ** 2) : null;
  const readings = patient.pregnancy?.readings ?? null;
  return {
    age: currentAge(patient, now),
    heightCm: m.heightCm ?? null,
    weightKg: m.weightKg ?? null,
    bmi,
    gravida: o.gravida ?? null,
    para: o.para ?? null,
    abortions: o.abortions ?? null,
    previousCaesareans: o.previousCaesareans ?? null,
    rhNegative: m.bloodGroup ? m.bloodGroup.endsWith('-') : null,
    bloodGroup: m.bloodGroup || null,
    conditions: m.conditions ?? [],
    conditionsKnown: (m.conditions?.length ?? 0) > 0 || m.conditionsReviewed === true,
    pastComplications: o.pastComplications ?? [],
    complicationsKnown: (o.pastComplications?.length ?? 0) > 0 || o.complicationsReviewed === true || isFirstPregnancy(patient),
    otherConditionsText: (m.otherConditions ?? '').trim(),
    // Findings ticked for this pregnancy: key → who recorded it and when
    findings: Object.fromEntries(currentFindingEntries(patient, now).map((f) => [f.key, { byName: f.byName ?? null, at: f.at ?? null }])),
    // Readings of this pregnancy (null = not measured yet)
    lowestHb: readings?.lowestHb?.value ?? null,
    bpSystolic: readings?.latestBp?.systolic ?? null,
    bpDiastolic: readings?.latestBp?.diastolic ?? null,
    readings,
  };
}

// What a met rule on a reading says: the value, the day it was measured and where it comes from.
function readingText(factor, facts) {
  const r = facts.readings ?? {};
  if (factor === 'lowestHb') return `Lowest Hb ${facts.lowestHb} g/dL on ${dateWords(r.lowestHb?.on)} (${r.lowestHb?.source === 'lab' ? 'lab result' : 'visit'})`;
  return `BP ${facts.bpSystolic}/${facts.bpDiastolic} mmHg on ${dateWords(r.latestBp?.on)}`;
}

function compare(op, a, b) {
  switch (op) {
    case 'lt':
      return a < b;
    case 'lte':
      return a <= b;
    case 'gt':
      return a > b;
    case 'gte':
      return a >= b;
    case 'eq':
      return a === b;
    default:
      return false;
  }
}

/**
 * Checks one rule. Returns { status: 'met' | 'not_met' | 'unknown' | 'not_measured', detail }.
 * 'unknown' means the information needed for this rule isn't recorded yet; 'not_measured' that the rule is on
 * a reading of this pregnancy (haemoglobin, blood pressure) that nobody has measured yet.
 */
export function evaluateRule(rule, facts) {
  const f = RISK_FACTORS[rule.factor];
  if (!f) return { status: 'unknown', detail: 'Unknown rule type' };

  if (f.type === 'condition') {
    if (facts.conditions.includes(rule.condition)) return { status: 'met', detail: 'Recorded at registration' };
    return { status: facts.conditionsKnown ? 'not_met' : 'unknown', detail: '' };
  }
  if (f.type === 'complication') {
    if (facts.pastComplications.includes(rule.complication)) return { status: 'met', detail: 'Recorded in obstetric history' };
    return { status: facts.complicationsKnown ? 'not_met' : 'unknown', detail: '' };
  }
  if (f.type === 'flag') {
    const v = facts[rule.factor];
    if (v === null || v === undefined) return { status: 'unknown', detail: '' };
    return { status: v ? 'met' : 'not_met', detail: v ? `Blood group ${facts.bloodGroup}` : '' };
  }
  if (f.type === 'finding') {
    const found = facts.findings?.[rule.finding];
    if (!found) return { status: 'not_met', detail: '' };
    return { status: 'met', detail: `Recorded${found.byName ? ` by ${found.byName}` : ''}${found.at ? ` on ${dateWords(toHospitalDate(found.at))}` : ''}` };
  }
  const v = facts[rule.factor];
  if (v === null || v === undefined) return { status: f.measured ? 'not_measured' : 'unknown', detail: '' };
  const met = compare(rule.op, v, rule.value);
  if (!met) return { status: 'not_met', detail: '' };
  const what = f.measured ? readingText(rule.factor, facts) : `${f.label} ${v}${f.unit ? ` ${f.unit}` : ''}`;
  return { status: 'met', detail: `${what} (rule: ${OP_TEXT[rule.op]} ${rule.value})` };
}

/**
 * Assesses a patient against a template's risk rules.
 * Result: { computedLevel, reasons[], missing[], notMeasured[], findingsNotChecked[], readingsNotChecked[], mayBeHigher,
 *           freeTextNotChecked, rulesChecked, template info, computedAt }
 *  - high / moderate: at least one rule of that level is met (reasons list which)
 *  - incomplete: no rule met, but some rules couldn't be checked because information is missing
 *  - low: every rule was checked and none was met
 *  - mayBeHigher: the result is moderate but a HIGH rule couldn't be checked (information missing)
 *  - notMeasured: readings of this pregnancy that a rule needs and nobody has measured yet. They are shown with
 *    the level, but do not make it "incomplete": readings (like findings) are found as the pregnancy goes on.
 *  - findingsNotChecked: findings ticked for this pregnancy that these rules have no rule for (for example an
 *    approved rule set from before such rules existed). Shown as "doctor to assess", so a tick never looks as
 *    if it had been taken into account when it was not.
 *  - readingsNotChecked: the same for the readings ('lowestHb', 'latestBp'): a value was recorded in this
 *    pregnancy, but these rules have no rule that looks at it. Without this a haemoglobin of 6.5 would stand next
 *    to "Low risk" as if it had been counted.
 */
export function assessRisk(patient, template, now = new Date()) {
  const rules = template?.riskRules ?? [];
  const facts = patientFacts(patient, now);
  const reasons = [];
  const missing = new Set();
  const notMeasured = new Set();
  const uncheckedLevels = new Set();

  for (const rule of rules) {
    const r = evaluateRule(rule, facts);
    if (r.status === 'met') reasons.push({ key: rule.key, label: rule.label, level: rule.level, detail: r.detail });
    else if (r.status === 'not_measured') notMeasured.add(RISK_FACTORS[rule.factor].measured);
    else if (r.status === 'unknown') {
      uncheckedLevels.add(rule.level);
      const needs = RISK_FACTORS[rule.factor]?.needs;
      for (const n of [typeof needs === 'function' ? needs(facts) : needs].flat()) if (n) missing.add(n);
      if (!RISK_FACTORS[rule.factor]) missing.add(`Rule "${rule.label}" uses an unknown check`);
    }
  }
  reasons.sort((a, b) => (a.level === b.level ? 0 : a.level === 'high' ? -1 : 1));
  const ruledFindings = new Set(rules.filter((r) => RISK_FACTORS[r.factor]?.type === 'finding').map((r) => r.finding));
  const findingsNotChecked = Object.keys(facts.findings).filter((k) => !ruledFindings.has(k));
  const ruledFactors = new Set(rules.map((r) => r.factor));
  const readingsNotChecked = Object.entries(READING_FACTORS)
    .filter(([reading, factors]) => facts.readings?.[reading] && !factors.some((f) => ruledFactors.has(f)))
    .map(([reading]) => reading);

  let computedLevel;
  if (!rules.length) computedLevel = 'incomplete';
  else if (reasons.some((r) => r.level === 'high')) computedLevel = 'high';
  else if (reasons.some((r) => r.level === 'moderate')) computedLevel = 'moderate';
  else if (missing.size) computedLevel = 'incomplete';
  else computedLevel = 'low';

  return {
    computedLevel,
    reasons,
    missing: [...missing],
    notMeasured: [...notMeasured],
    findingsNotChecked,
    readingsNotChecked,
    mayBeHigher: computedLevel === 'moderate' && uncheckedLevels.has('high'),
    freeTextNotChecked: Boolean(facts.otherConditionsText),
    rulesChecked: rules.length,
    engineVersion: RISK_ENGINE_VERSION,
    templateId: template?._id ?? null,
    templateName: template?.name ?? null,
    templateVersion: template?.version ?? null,
    templateApproved: template?.status === 'approved',
    computedAt: now,
  };
}

/** Level actually shown/used: the doctor's override if there is one, otherwise the automatic result. */
export const effectiveLevel = (risk) => risk?.override?.level ?? risk?.computedLevel ?? null;

/**
 * True if a doctor's override may be out of date: the automatic level changed, or a new reason
 * appeared since the override was made (even at the same level).
 */
export function overrideNeedsReview(risk) {
  const ov = risk?.override;
  if (!ov) return false;
  if (ov.computedLevelAtOverride !== risk.computedLevel) return true;
  const before = new Set(ov.reasonKeysAtOverride ?? []);
  return (risk.reasons ?? []).some((r) => !before.has(r.key));
}

const YEAR = 365.25 * 24 * 60 * 60 * 1000;
/** When the patient's current age next goes up by one (so age rules must be re-checked then). */
export function nextAgeChange(patient, now = new Date()) {
  if (patient.ageYears == null) return null;
  const since = new Date(patient.ageRecordedOn ?? patient.createdAt ?? now).getTime();
  const years = Math.max(0, Math.floor((now.getTime() - since) / YEAR));
  return new Date(since + (years + 1) * YEAR);
}
