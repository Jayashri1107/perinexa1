// Labels for the automatic risk level and risk rules.
import { Check, CircleDashed, TriangleAlert } from 'lucide-react';
import { CONDITION_LABELS, PAST_COMPLICATION_LABELS, PREGNANCY_FINDING_LABELS } from './patientFormat.js';

export const RISK_LABELS = { high: 'High risk', moderate: 'Moderate risk', low: 'Low risk', incomplete: 'Incomplete' };
export const RISK_SHORT = { high: 'High', moderate: 'Moderate', low: 'Low', incomplete: 'Incomplete' };
// How each level shows as a status pill (brand guide: colour + icon + word, one source for every screen).
// "Incomplete" uses a dashed circle ("not known yet"), not the X that means closed or inactive.
export const RISK_STATUS = {
  high: { tone: 'high', icon: TriangleAlert, label: 'High-risk' },
  moderate: { tone: 'watch', icon: TriangleAlert, label: 'Moderate-risk' },
  low: { tone: 'stable', icon: Check, label: 'Low-risk' },
  incomplete: { tone: 'watch', icon: CircleDashed, label: 'Incomplete' }, // information missing: needs review, may be higher
};
export const RISK_HINTS = {
  high: 'At least one high-risk factor applies.',
  moderate: 'At least one moderate-risk factor applies.',
  low: 'All rules were checked and none applies (free-text notes are not checked).',
  incomplete: 'Some information needed for the rules is missing, so the risk cannot be called low yet.',
};

export const RISK_FACTOR_LABELS = {
  age: 'Age (years)',
  heightCm: 'Height (cm)',
  weightKg: 'Weight (kg)',
  bmi: 'BMI',
  gravida: 'Gravida',
  para: 'Para',
  abortions: 'Abortions / miscarriages',
  previousCaesareans: 'Previous caesareans',
  rhNegative: 'Rh-negative blood group',
  condition: 'Pre-existing condition',
  pastComplication: 'Problem in a previous pregnancy',
  // This pregnancy: a finding ticked on the record, and the readings from visits and reviewed lab results
  finding: 'Finding in this pregnancy',
  lowestHb: 'Lowest haemoglobin in this pregnancy (g/dL)',
  bpSystolic: 'Latest blood pressure – upper number',
  bpDiastolic: 'Latest blood pressure – lower number',
};
export const NUMBER_FACTORS = ['age', 'heightCm', 'weightKg', 'bmi', 'gravida', 'para', 'abortions', 'previousCaesareans', 'lowestHb', 'bpSystolic', 'bpDiastolic'];
export const OP_LABELS = { lt: 'under', lte: 'at most', gt: 'over', gte: 'at least', eq: 'exactly' };

export function ruleText(r) {
  if (r.factor === 'condition') return `Condition: ${CONDITION_LABELS[r.condition] ?? r.condition}`;
  if (r.factor === 'pastComplication') return `Previous pregnancy: ${PAST_COMPLICATION_LABELS[r.complication] ?? r.complication}`;
  if (r.factor === 'finding') return `Ticked for this pregnancy: ${PREGNANCY_FINDING_LABELS[r.finding] ?? r.finding}`;
  if (r.factor === 'rhNegative') return 'Blood group is Rh negative';
  return `${RISK_FACTOR_LABELS[r.factor] ?? r.factor} ${OP_LABELS[r.op] ?? r.op} ${r.value}`;
}

/**
 * Readings a rule needs that nobody has measured yet in this pregnancy, in words (null when there are none):
 * "Not measured yet in this pregnancy: Haemoglobin (Hb) · Blood pressure. The rules on them are checked once a
 * value is recorded at a visit (for haemoglobin: or a lab result is reviewed)."
 */
export function notMeasuredText(risk) {
  const list = risk?.notMeasured ?? [];
  if (!list.length) return null;
  return {
    lead: 'Not measured yet in this pregnancy:',
    list: list.join(' · '),
    rest: `The ${list.length === 1 ? 'rules on it are' : 'rules on them are'} checked once a value is recorded at a visit${list.some((x) => /haemoglobin/i.test(x)) ? ' (haemoglobin: also when a doctor reviews a lab result)' : ''}.`,
  };
}

/**
 * Findings ticked for this pregnancy that the hospital's risk rules have no rule for (a rule set approved before
 * such rules existed): { lead, list, rest } for the risk card, or null. The doctor must assess them – the tick
 * was not taken into account.
 */
export function findingsNotCheckedText(risk) {
  const list = (risk?.findingsNotChecked ?? []).map((k) => PREGNANCY_FINDING_LABELS[k] ?? k);
  if (!list.length) return null;
  return {
    lead: 'Doctor to assess:',
    list: list.join(', '),
    rest: `ticked for this pregnancy, but the hospital's risk rules have no rule for ${list.length === 1 ? 'it' : 'them'}, so the level does not count ${list.length === 1 ? 'it' : 'them'}.`,
  };
}

/**
 * Readings recorded in this pregnancy (lowest haemoglobin, latest blood pressure) that the hospital's risk rules
 * have no rule for – a rule set approved before such rules existed: { lead, list, rest } for the risk card, or
 * null. The value is shown on the record, but the level did not count it, and the card must say so.
 * readings: patient.pregnancy.readings (for the values).
 */
export function readingsNotCheckedText(risk, readings) {
  const list = (risk?.readingsNotChecked ?? []).map((k) => {
    if (k === 'lowestHb') return readings?.lowestHb ? `Lowest Hb ${readings.lowestHb.value} g/dL` : 'Haemoglobin (Hb)';
    if (k === 'latestBp') return readings?.latestBp ? `Latest BP ${readings.latestBp.systolic}/${readings.latestBp.diastolic}` : 'Blood pressure';
    return k;
  });
  if (!list.length) return null;
  return {
    lead: 'Doctor to assess:',
    list: list.join(', '),
    rest: `recorded in this pregnancy, but the hospital's risk rules have no rule for ${list.length === 1 ? 'it' : 'them'}, so the level does not count ${list.length === 1 ? 'it' : 'them'}.`,
  };
}

/**
 * The line under the level when no rule applies. "Nothing found in the recorded information" is only said when
 * everything recorded was really checked: with a ticked finding or a reading the rules have no rule for, it
 * says that not everything was counted.
 */
export function noReasonText(risk) {
  const uncounted = (risk?.findingsNotChecked ?? []).length + (risk?.readingsNotChecked ?? []).length > 0;
  if (uncounted) return 'No risk rule applies – but not everything recorded was counted. See “Doctor to assess” below.';
  return risk?.level === 'low' || risk?.computedLevel === 'low' ? 'No risk factor found in the recorded information.' : 'No risk factor found so far.';
}

// Things the automatic check cannot see (shown so nobody relies on it alone).
export const NOT_CHECKED_YET =
  "Not checked automatically: conditions typed as free text, lab results other than haemoglobin, scan findings, and problems in this pregnancy that are not ticked on the record (e.g. malpresentation, growth problems). A finding ticked for this pregnancy, the haemoglobin and the blood pressure count only where the hospital's risk rules have a rule for them. Doctors must still assess these clinically.";
