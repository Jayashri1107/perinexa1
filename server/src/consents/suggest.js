// Which consent forms to suggest for a patient now, and what to fill in for them (pure, no database).
// Each form says when it is suggested (models/ConsentForm.js SUGGEST_RULES); the rules only use facts the
// app already has: the type of care, the risk level, previous caesareans, weeks of pregnancy and the care
// plan's scans and HIV test that are due. Information forms (e.g. PIH, GDM) also use the ticked conditions, the
// blood group, the latest visit's red flags and lab results of this pregnancy (findings, gathered by the route).
// Decision support only – the doctor decides which consents to take and what to explain.

import { gaOn, utcDay } from '../careplans/dates.js';
import { currentAge } from '../models/Patient.js';
import { formBlanks } from './consentText.js';

const DUE = ['due', 'overdue'];

const time = (d) => (d ? new Date(d).getTime() : 0);

/**
 * The scans to fill in: those due now; otherwise only the one that became overdue last (earlier overdue scans,
 * such as a dating scan whose weeks have long passed, are for the doctor to decide on the Care plan tab).
 */
function scansToFill(scans) {
  const now = scans.filter((i) => i.status === 'due');
  if (now.length) return now;
  return scans.filter((i) => i.status === 'overdue').sort((a, b) => time(b.dueBy) - time(a.dueBy)).slice(0, 1);
}

// Red flags of the latest visit that point to a condition.
const BP_FLAGS = ['bp_severe_sys', 'bp_severe_dia', 'pe_sys', 'pe_dia', 'htn_sys', 'htn_dia'];
const ANAEMIA_FLAGS = ['hb_severe', 'hb_moderate', 'hb_mild'];
// Problems in earlier pregnancies, as printed on the bad-obstetric-history sheet (the website's words too).
const PAST_COMPLICATION_WORDS = {
  stillbirth_or_neonatal_death: 'stillbirth or newborn death',
  preterm_birth: 'preterm birth',
  pre_eclampsia: 'pre-eclampsia / eclampsia',
  congenital_anomaly: 'baby with a congenital anomaly',
  low_birth_weight_baby: 'baby under 2.5 kg',
  big_baby: 'baby over 4 kg',
  obstructed_labour: 'obstructed labour',
  pph: 'heavy bleeding after delivery (PPH)',
  rh_isoimmunisation: 'Rh sensitisation',
};
/** The earlier problems in words: ticked complications, and "2 miscarriages / abortions" from 2 or more. */
function pastProblems(patient) {
  const o = patient.obstetric ?? {};
  const words = (o.pastComplications ?? []).map((k) => PAST_COMPLICATION_WORDS[k] ?? k);
  if ((o.abortions ?? 0) >= 2) words.push(`${o.abortions} miscarriages / abortions`);
  return words;
}

/**
 * The facts the rules use. planItems: the current care plan's items with today's status
 * ([{ kind, name, status, dueBy }], empty without a plan); today: the hospital's date; findings: the latest
 * visit's red-flag keys and lab results of this pregnancy ({ flagKeys, ogttHigh, tshHigh, hbLow }).
 */
export function consentFacts(patient, planItems = [], today = new Date(), findings = {}) {
  const antenatal = patient.careType === 'antenatal';
  const edd = antenatal ? utcDay(patient.pregnancy?.effectiveEdd) : null;
  const scans = planItems.filter((i) => i.kind === 'scan' && DUE.includes(i.status));
  return {
    careType: patient.careType,
    antenatal,
    riskHigh: patient.risk?.level === 'high',
    highReasons: (patient.risk?.reasons ?? []).filter((r) => r.level === 'high').map((r) => r.label),
    previousCaesareans: patient.obstetric?.previousCaesareans ?? 0,
    weeks: edd ? (gaOn(edd, today)?.weeks ?? null) : null,
    scanDue: scans.length > 0,
    dueScans: scansToFill(scans).map((i) => i.name),
    hivTestDue: planItems.some((i) => i.kind === 'investigation' && /\bHIV\b/i.test(i.name) && DUE.includes(i.status)),
    conditions: patient.medical?.conditions ?? [],
    pastProblems: pastProblems(patient),
    age: currentAge(patient, today),
    bmi: patient.medical?.heightCm && patient.medical?.weightKg ? patient.medical.weightKg / (patient.medical.heightCm / 100) ** 2 : null,
    hbsagReactive: Boolean(findings.hbsagReactive),
    rhNegative: Boolean(patient.medical?.bloodGroup?.endsWith('-')),
    flagKeys: findings.flagKeys ?? [],
    ogttHigh: Boolean(findings.ogttHigh),
    tshHigh: Boolean(findings.tshHigh),
    hbLow: Boolean(findings.hbLow),
  };
}

/** Whether a form is listed for this type of care (no types = every type). */
export const formIsFor = (form, careType) => !form.careTypes?.length || form.careTypes.includes(careType);

const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * The suggestion for one form: null, or { why, prefill } – why is the form's rule; prefill fills the typed
 * blanks the form uses (the due scans for {procedure}; the high-risk reasons for {reason}).
 */
export function suggestion(form, facts) {
  if (!formIsFor(form, facts.careType)) return null;
  const blanks = formBlanks(form);
  const hit = (prefill = {}) => ({ why: form.suggestWhen, prefill });
  switch (form.suggestWhen) {
    case 'always':
      return hit();
    case 'high_risk':
      if (!facts.antenatal || !facts.riskHigh) return null;
      return hit(blanks.has('reason') && facts.highReasons.length ? { reason: cut(facts.highReasons.join('; '), 300) } : {});
    case 'previous_caesarean':
      return facts.antenatal && facts.previousCaesareans >= 1 ? hit() : null;
    case 'scan_due':
      if (!facts.antenatal || !facts.scanDue) return null;
      return hit(blanks.has('procedure') ? { procedure: cut(facts.dueScans.join(', '), 200) } : {});
    case 'hiv_test_due':
      return facts.antenatal && facts.hivTestDue ? hit() : null;
    case 'from_37_weeks':
      return facts.antenatal && facts.weeks != null && facts.weeks >= 37 ? hit() : null;
    case 'from_40_weeks':
      return facts.antenatal && facts.weeks != null && facts.weeks >= 40 ? hit() : null;
    case 'blood_pressure':
      return facts.conditions.includes('hypertension') || facts.flagKeys.some((k) => BP_FLAGS.includes(k)) ? hit() : null;
    case 'diabetes':
      return facts.conditions.includes('diabetes') || facts.ogttHigh ? hit() : null;
    case 'thyroid':
      return facts.conditions.includes('thyroid') || facts.tshHigh ? hit() : null;
    case 'anaemia':
      return facts.conditions.includes('anaemia') || facts.hbLow || facts.flagKeys.some((k) => ANAEMIA_FLAGS.includes(k)) ? hit() : null;
    case 'rh_negative':
      return facts.rhNegative ? hit() : null;
    case 'bad_obstetric_history':
      if (!facts.antenatal || !facts.pastProblems?.length) return null;
      return hit(blanks.has('condition') ? { condition: cut(facts.pastProblems.join('; '), 200) } : {});
    case 'reduced_movements':
      return facts.flagKeys.includes('fm_reduced') ? hit() : null;
    case 'heart_disease':
      return facts.conditions.includes('heart_disease') ? hit() : null;
    case 'epilepsy':
      return facts.conditions.includes('epilepsy') ? hit() : null;
    case 'hepatitis_b':
      return facts.conditions.includes('hepatitis_b') || facts.hbsagReactive ? hit() : null;
    case 'obesity':
      return facts.antenatal && facts.bmi != null && facts.bmi >= 30 ? hit() : null;
    case 'age_35_plus':
      return facts.antenatal && facts.age != null && facts.age >= 35 ? hit() : null;
    case 'not_head_down':
      return facts.flagKeys.includes('malpresentation') ? hit() : null;
    default:
      return null;
  }
}
