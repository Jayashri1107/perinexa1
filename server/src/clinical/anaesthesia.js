// The pre-anaesthesia check-up (PAC) and the pain chart (Clinical Requirements Group B, items 9 and 10 – PX-ANA-01,
// PX-ANA-03). DRAFT, built from published guidance before the manual pages ANA-F-01, F-02, F-11 and F-03 were given
// (developer's request, 6 Nov 2026): to be checked against them by the Lead Anaesthetist and replaced by them. Needs the
// owner's approval as clinical content before it goes to main. The order sets A–D (PX-ANA-04) are not here: they wait
// for their formulary rows to be verified (owner's decision 9).
// Sources: ASA Physical Status Classification System (2020); Mallampati / Samsoon and Young (1987); ASA Practice
// Guidelines for Preoperative Fasting (2017); WHO pain ladder bands; Pasero Opioid-induced Sedation Scale (POSS, 2009).
// The website keeps the same lists (client/src/pages/anaesthesia/anaesthesiaRules.js); a server test checks both.

export const PAC_SOURCE = 'ASA Physical Status Classification (2020); modified Mallampati (Samsoon and Young 1987); ASA preoperative fasting guidelines (2017)';
export const PAIN_SOURCE = 'Numerical pain score 0–10 (mild 1–3, moderate 4–6, severe 7–10); Pasero Opioid-induced Sedation Scale (POSS, 2009)';

export const ASA = {
  1: 'ASA I – a normal healthy patient',
  2: 'ASA II – mild systemic disease (pregnancy is ASA II)',
  3: 'ASA III – severe systemic disease',
  4: 'ASA IV – severe systemic disease that is a constant threat to life',
  5: 'ASA V – moribund, not expected to survive without the operation',
};
export const MALLAMPATI = { 1: 'Class I – soft palate, fauces, uvula, pillars seen', 2: 'Class II – soft palate, fauces, uvula seen', 3: 'Class III – soft palate, base of uvula seen', 4: 'Class IV – hard palate only' };
export const COMORBIDITIES = {
  hypertension: 'Hypertension or pre-eclampsia',
  diabetes: 'Diabetes (including GDM)',
  asthma: 'Asthma or other lung disease',
  heart: 'Heart disease',
  thyroid: 'Thyroid disease',
  anaemia: 'Anaemia',
  bleeding: 'Bleeding disorder or on anticoagulants',
  epilepsy: 'Epilepsy',
  obesity: 'Obesity (BMI 35 or more)',
  kidney: 'Kidney or liver disease',
  other: 'Other',
};
export const PLANNED_ANAESTHESIA = { spinal: 'Spinal', epidural: 'Epidural', combined: 'Combined spinal-epidural', general: 'General', local: 'Local', sedation: 'Sedation' };
export const FITNESS = { fit: 'Fit for anaesthesia', conditions: 'Fit, with conditions', defer: 'Defer – optimise first', unfit: 'Not fit' };
// ASA 2017: clear fluids up to 2 hours before, a light meal 6 hours, a fatty meal 8 hours (shown as a hint only).
export const FASTING = { clearHours: 2, lightMealHours: 6, fattyMealHours: 8 };

/** What the PAC still needs: { field: message } (empty when it can be saved). PURE. */
export function pacMissing(p = {}) {
  const out = {};
  if (!p.asa) out.asa = 'Choose the ASA grade';
  if (!p.airwayMallampati) out.airwayMallampati = 'Choose the Mallampati class';
  if (!p.plannedAnaesthesia) out.plannedAnaesthesia = 'Choose the planned anaesthesia';
  if (!p.fitness) out.fitness = 'Choose fit, fit with conditions, defer or not fit';
  if ((p.fitness === 'conditions' || p.fitness === 'defer' || p.fitness === 'unfit') && !String(p.fitnessNote ?? '').trim()) out.fitnessNote = 'Write the conditions or the reason';
  if ((p.comorbidities ?? []).includes('other') && !String(p.comorbidityNote ?? '').trim()) out.comorbidityNote = 'Write the other condition';
  if (!p.risksExplained) out.risksExplained = 'Explain the anaesthesia and its risks to her, then tick this';
  return out;
}

/** Hours since the last solid food and clear fluid, against the fasting hints. PURE. */
export function fastingHours(at, lastSolidAt, lastClearAt) {
  const h = (t) => (t ? Math.round(((new Date(at) - new Date(t)) / 3600000) * 10) / 10 : null);
  const solid = h(lastSolidAt);
  const clear = h(lastClearAt);
  return { solid, clear, solidOk: solid == null ? null : solid >= FASTING.lightMealHours, clearOk: clear == null ? null : clear >= FASTING.clearHours };
}

// Pain chart: a numerical score 0–10, the POSS sedation score (1–4), nausea.
export const POSS = { 1: '1 – Awake and alert', 2: '2 – Slightly drowsy, easily roused', 3: '3 – Frequently drowsy, drifts off while talking', 4: '4 – Somnolent, little or no response' };
export const NAUSEA = { none: 'None', nausea: 'Nausea', vomiting: 'Vomiting' };
/** Pain band from the score. PURE. */
export function painBand(score) {
  if (score == null) return null;
  if (score >= 7) return { band: 'red', words: 'Severe pain (7–10)' };
  if (score >= 4) return { band: 'yellow', words: 'Moderate pain (4–6)' };
  if (score >= 1) return { band: 'normal', words: 'Mild pain (1–3)' };
  return { band: 'normal', words: 'No pain' };
}
/** POSS 3 or 4: stop opioids and tell the anaesthetist (Pasero). PURE. */
export function sedationBand(poss) {
  if (poss == null) return null;
  if (poss >= 3) return { band: 'red', words: 'Too sedated – hold opioids and tell the anaesthetist now' };
  return { band: 'normal', words: 'Acceptable sedation' };
}
