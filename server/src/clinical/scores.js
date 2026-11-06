// EPDS and the VTE risk score (Clinical Requirements Group A, item 5 – PX-OBG-19, PX-OBG-17 score and advice).
// DRAFT until checked against the manual's OBG-F-10 and OBG-F-11 by the Lead Obstetrician. The website keeps a copy of
// these tables (client/src/pages/scores/scoreRules.js); a server test checks that both are the same.
//
// EPDS: the questions are the copyright of the Royal College of Psychiatrists – showing them inside commercial software
// needs their written permission, and the Marathi and Hindi versions must be validated ones (PX-REQ-00 section 4). So
// Perinexa records the ten answers' scores (0–3 each) from the hospital's paper form and never shows the questions.
// Source: Cox, Holden & Sagovsky, Br J Psychiatry 1987;150:782-6 (scoring); thresholds as commonly used in India and
// in NICE CG192 guidance: 13 or more – likely depression, refer; 10–12 – possible depression, repeat in 2–4 weeks;
// any score on question 10 (thoughts of self-harm) – assess the same day.
//
// VTE: RCOG Green-top Guideline 37a (2015), Appendix I – the risk-factor table and what the score means. The dose is
// never given here: it comes from a verified formulary row (item 7). The spinal / epidural timing check belongs to the
// anaesthesia record (later).

export const EPDS_SOURCE = 'Cox, Holden & Sagovsky, Br J Psychiatry 1987 (scoring); thresholds 10 and 13, question 10 as in NICE CG192';
export const EPDS_ITEMS = 10;
export const EPDS_POSSIBLE = 10;
export const EPDS_LIKELY = 13;

/** The EPDS result from the ten scores (each 0–3). PURE. */
export function epdsResult(scores) {
  const total = scores.reduce((a, b) => a + b, 0);
  const selfHarm = scores[9] > 0;
  const band = total >= EPDS_LIKELY ? 'likely' : total >= EPDS_POSSIBLE ? 'possible' : 'unlikely';
  const advice = [
    ...(selfHarm ? ['Question 10 scored: assess her for thoughts of self-harm today, before she leaves.'] : []),
    band === 'likely' ? 'Score 13 or more: likely depression – refer for assessment by a psychiatrist or the mental-health team.' : band === 'possible' ? 'Score 10 to 12: possible depression – repeat the EPDS in 2 to 4 weeks and watch for symptoms.' : 'Score under 10: depression unlikely – repeat at the next scheduled screen.',
  ];
  return { total, band, selfHarm, advice };
}

export const VTE_SOURCE = 'RCOG Green-top Guideline 37a (2015), Appendix I';
// phase: 'any' (antenatal and postnatal), 'antenatal' or 'postnatal' (delivery factors)
export const VTE_FACTORS = [
  { key: 'previous_vte', label: 'Previous VTE (except a single event after major surgery)', score: 4, phase: 'any', high: true },
  { key: 'previous_vte_surgery', label: 'Previous VTE provoked by major surgery', score: 3, phase: 'any' },
  { key: 'thrombophilia_high', label: 'Known high-risk thrombophilia', score: 3, phase: 'any', high: true },
  { key: 'comorbidity', label: 'Medical illness: cancer, heart failure, active SLE, inflammatory bowel disease or polyarthropathy, nephrotic syndrome, type 1 diabetes with nephropathy, sickle cell disease, current IV drug use', score: 3, phase: 'any' },
  { key: 'family_history', label: 'Family history of unprovoked or oestrogen-related VTE in a first-degree relative', score: 1, phase: 'any' },
  { key: 'thrombophilia_low', label: 'Known low-risk thrombophilia (no VTE)', score: 1, phase: 'any' },
  { key: 'age_over_35', label: 'Age over 35', score: 1, phase: 'any' },
  { key: 'bmi_30', label: 'Obesity: BMI 30 to 39', score: 1, phase: 'any', group: 'bmi' },
  { key: 'bmi_40', label: 'Obesity: BMI 40 or more', score: 2, phase: 'any', group: 'bmi' },
  { key: 'parity_3', label: 'Parity 3 or more', score: 1, phase: 'any' },
  { key: 'smoker', label: 'Smoker', score: 1, phase: 'any' },
  { key: 'varicose_veins', label: 'Gross varicose veins', score: 1, phase: 'any' },
  { key: 'pre_eclampsia', label: 'Pre-eclampsia in this pregnancy', score: 1, phase: 'any' },
  { key: 'art', label: 'ART or IVF (antenatal only)', score: 1, phase: 'antenatal' },
  { key: 'multiple', label: 'Multiple pregnancy', score: 1, phase: 'any' },
  { key: 'cs_in_labour', label: 'Caesarean section in labour', score: 2, phase: 'postnatal', group: 'cs' },
  { key: 'cs_elective', label: 'Elective caesarean section', score: 1, phase: 'postnatal', group: 'cs' },
  { key: 'operative_delivery', label: 'Mid-cavity or rotational operative delivery', score: 1, phase: 'postnatal' },
  { key: 'prolonged_labour', label: 'Prolonged labour (over 24 hours)', score: 1, phase: 'postnatal' },
  { key: 'pph', label: 'Postpartum haemorrhage over 1 litre or blood transfusion', score: 1, phase: 'postnatal' },
  { key: 'preterm', label: 'Preterm birth before 37 weeks in this pregnancy', score: 1, phase: 'postnatal' },
  { key: 'stillbirth', label: 'Stillbirth in this pregnancy', score: 1, phase: 'postnatal' },
  { key: 'surgery', label: 'Any surgical procedure in pregnancy or the puerperium (except an immediate perineal repair)', score: 3, phase: 'any' },
  { key: 'hyperemesis', label: 'Hyperemesis', score: 3, phase: 'antenatal' },
  { key: 'ohss', label: 'Ovarian hyperstimulation syndrome (first trimester only)', score: 4, phase: 'antenatal' },
  { key: 'infection', label: 'Current systemic infection', score: 1, phase: 'any' },
  { key: 'immobility', label: 'Immobility or dehydration', score: 1, phase: 'any' },
];
export const VTE_PHASES = ['antenatal', 'postnatal'];

/** Factors that may be ticked in this phase. */
export const vteFactorsFor = (phase) => VTE_FACTORS.filter((f) => f.phase === 'any' || f.phase === phase);

/** The VTE score and what it means (RCOG 37a). antenatalLmwh: she was on LMWH before birth (postnatal: 6 weeks). PURE. */
export function vteResult(phase, keys, { antenatalLmwh = false } = {}) {
  const allowed = new Map(vteFactorsFor(phase).map((f) => [f.key, f]));
  const picked = [...new Set(keys)].filter((k) => allowed.has(k)).map((k) => allowed.get(k));
  const total = picked.reduce((a, f) => a + f.score, 0);
  const high = picked.some((f) => f.high);
  let band;
  let advice;
  if (phase === 'antenatal') {
    band = total >= 4 ? 'high' : total === 3 ? 'intermediate' : 'low';
    advice =
      band === 'high'
        ? 'Score 4 or more: consider thromboprophylaxis from the first trimester.'
        : band === 'intermediate'
          ? 'Score 3: consider thromboprophylaxis from 28 weeks.'
          : 'Score under 3: mobilise and avoid dehydration.';
  } else {
    band = high || antenatalLmwh ? 'high' : total >= 2 ? 'intermediate' : 'low';
    advice =
      band === 'high'
        ? 'High risk (previous VTE, high-risk thrombophilia, or LMWH before birth): consider at least 6 weeks of postnatal thromboprophylaxis.'
        : band === 'intermediate'
          ? 'Score 2 or more: consider at least 10 days of postnatal thromboprophylaxis (longer if the risk persists or there are 3 or more factors).'
          : 'Score under 2: early mobilisation and avoid dehydration.';
  }
  return { total, band, advice: [advice, 'The dose comes from a verified row of the formulary – Perinexa does not give one here.'] };
}

/** Two choices of one group (two BMI bands, two kinds of caesarean): the problem in words, or ''. PURE. */
export function vteConflict(keys) {
  const groups = {};
  for (const k of keys) {
    const g = VTE_FACTORS.find((f) => f.key === k)?.group;
    if (g) groups[g] = (groups[g] ?? 0) + 1;
  }
  if (groups.bmi > 1) return 'Choose one BMI band';
  if (groups.cs > 1) return 'Choose one kind of caesarean';
  return '';
}
