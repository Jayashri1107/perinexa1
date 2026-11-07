// GREEN / AMBER / RED tiers for a pregnancy (Clinical Requirements Group C – PX-X-15, with PX-OBG-01). DRAFT – shown
// beside today's risk level only, NOT used by anything: today's risk rules (careplans/risk.js, from the doctor-approved
// care-plan template) stay what the app uses. Whether the tiers replace them is the owner's decision (she is a doctor),
// with the manual's own criteria. Pure: reads the same facts as the risk engine (careplans/risk.js patientFacts).
//   RED   – high risk: specialist-led care, birth where there is a blood bank and an operating theatre.
//   AMBER – needs additional care: an obstetrician reviews the plan.
//   GREEN – routine care, nothing found so far.
//   GREY  – not enough recorded to say (conditions, previous pregnancies, G, blood group).

export const TIER_SOURCE =
  'DRAFT – criteria arranged from India’s PMSMA high-risk pregnancy list (MoHFW, 2016) and NICE NG201 antenatal care (2021); not in use, awaiting the owner’s approval and the manual page';

export const TIERS = {
  red: { word: 'RED – high risk', order: 3 },
  amber: { word: 'AMBER – additional care', order: 2 },
  green: { word: 'GREEN – routine care', order: 1 },
  grey: { word: 'Not enough recorded', order: 0 },
};

const bpSevere = (f) => (f.bpSystolic != null && f.bpSystolic >= 160) || (f.bpDiastolic != null && f.bpDiastolic >= 110);
const has = (list, key) => Array.isArray(list) && list.includes(key);
// Each criterion: tier, words, and a test on the facts (true = met). Labels never name a confidential test or diagnosis.
export const TIER_CRITERIA = [
  { key: 'cs2', tier: 'red', label: 'Two or more previous caesareans', test: (f) => f.previousCaesareans != null && f.previousCaesareans >= 2 },
  { key: 'heart', tier: 'red', label: 'Heart disease', test: (f) => has(f.conditions, 'heart_disease') },
  { key: 'renal', tier: 'red', label: 'Kidney disease', test: (f) => has(f.conditions, 'renal_disease') },
  { key: 'liver', tier: 'red', label: 'Liver disease', test: (f) => has(f.conditions, 'liver_disease') },
  { key: 'epilepsy', tier: 'red', label: 'Epilepsy', test: (f) => has(f.conditions, 'epilepsy') },
  { key: 'thrombophilia', tier: 'red', label: 'Thrombophilia', test: (f) => has(f.conditions, 'thrombophilia') },
  { key: 'autoimmune', tier: 'red', label: 'Autoimmune disease', test: (f) => has(f.conditions, 'autoimmune') },
  { key: 'praevia', tier: 'red', label: 'Low-lying placenta in this pregnancy', test: (f) => Boolean(f.findings?.placenta_praevia) },
  { key: 'bleeding', tier: 'red', label: 'Bleeding in this pregnancy', test: (f) => Boolean(f.findings?.bleeding) },
  { key: 'multiple', tier: 'red', label: 'Twins or more', test: (f) => Boolean(f.findings?.multiple) },
  { key: 'stillbirth', tier: 'red', label: 'Stillbirth or newborn death before', test: (f) => has(f.pastComplications, 'stillbirth_or_neonatal_death') },
  { key: 'isoimmunisation', tier: 'red', label: 'Rh isoimmunisation before', test: (f) => has(f.pastComplications, 'rh_isoimmunisation') },
  { key: 'hb7', tier: 'red', label: 'Haemoglobin under 7 g/dL', test: (f) => f.lowestHb != null && f.lowestHb < 7 },
  { key: 'bp160', tier: 'red', label: 'Blood pressure 160/110 or higher', test: (f) => bpSevere(f) },
  { key: 'bmi40', tier: 'red', label: 'BMI 40 or more', test: (f) => f.bmi != null && f.bmi >= 40 },

  { key: 'cs1', tier: 'amber', label: 'One previous caesarean', test: (f) => f.previousCaesareans === 1 },
  { key: 'uterine', tier: 'amber', label: 'Earlier surgery on the uterus', test: (f) => has(f.conditions, 'uterine_surgery') },
  { key: 'diabetes', tier: 'amber', label: 'Diabetes before pregnancy', test: (f) => has(f.conditions, 'diabetes') },
  { key: 'chronic_htn', tier: 'amber', label: 'High blood pressure before pregnancy', test: (f) => has(f.conditions, 'hypertension') },
  { key: 'thyroid', tier: 'amber', label: 'Thyroid disease', test: (f) => has(f.conditions, 'thyroid') },
  { key: 'asthma', tier: 'amber', label: 'Asthma', test: (f) => has(f.conditions, 'asthma') },
  { key: 'tb', tier: 'amber', label: 'Tuberculosis', test: (f) => has(f.conditions, 'tuberculosis') },
  { key: 'mental', tier: 'amber', label: 'Mental health condition', test: (f) => has(f.conditions, 'mental_health') },
  { key: 'infection', tier: 'amber', label: 'Infection needing specialist care (see her record)', test: (f) => ['hiv', 'hepatitis_b', 'syphilis'].some((k) => has(f.conditions, k)) },
  { key: 'gdm', tier: 'amber', label: 'Diabetes in this pregnancy', test: (f) => Boolean(f.findings?.gdm) },
  { key: 'pih', tier: 'amber', label: 'High blood pressure in this pregnancy', test: (f) => Boolean(f.findings?.hypertension) },
  { key: 'past', tier: 'amber', label: 'A problem in a previous pregnancy', test: (f) => ['preterm_birth', 'pre_eclampsia', 'congenital_anomaly', 'low_birth_weight_baby', 'big_baby', 'obstructed_labour', 'pph'].some((k) => has(f.pastComplications, k)) },
  { key: 'age', tier: 'amber', label: 'Age under 18 or over 35', test: (f) => f.age != null && (f.age < 18 || f.age > 35) },
  { key: 'bmi30', tier: 'amber', label: 'BMI 30 or more', test: (f) => f.bmi != null && f.bmi >= 30 && f.bmi < 40 },
  { key: 'height', tier: 'amber', label: 'Height under 145 cm', test: (f) => f.heightCm != null && f.heightCm < 145 },
  { key: 'grand', tier: 'amber', label: 'Four or more births before', test: (f) => f.para != null && f.para >= 4 },
  { key: 'rhneg', tier: 'amber', label: 'Rh-negative blood group', test: (f) => f.rhNegative === true },
  { key: 'hb10', tier: 'amber', label: 'Haemoglobin 7 to under 10 g/dL', test: (f) => f.lowestHb != null && f.lowestHb >= 7 && f.lowestHb < 10 },
  { key: 'bp140', tier: 'amber', label: 'Blood pressure 140/90 or higher', test: (f) => !bpSevere(f) && ((f.bpSystolic != null && f.bpSystolic >= 140) || (f.bpDiastolic != null && f.bpDiastolic >= 90)) },
];

/** What must be recorded before GREEN can be said (a missing one makes it GREY unless AMBER or RED is already met). */
const NEEDED = [
  ['conditionsKnown', 'Pre-existing conditions (tick any, or confirm none known)'],
  ['complicationsKnown', 'Problems in previous pregnancies (tick any, or confirm none)'],
  ['gravida', 'Gravida (G)'],
  ['bloodGroup', 'Blood group'],
];

/** The tier for these facts: { tier, word, reasons: [{ key, tier, label }], missing: [words] }. PURE. */
export function tierFor(facts) {
  const reasons = TIER_CRITERIA.filter((c) => {
    try {
      return c.test(facts);
    } catch {
      return false;
    }
  }).map((c) => ({ key: c.key, tier: c.tier, label: c.label }));
  const missing = NEEDED.filter(([k]) => facts[k] == null || facts[k] === false).map(([, w]) => w);
  const tier = reasons.some((r) => r.tier === 'red') ? 'red' : reasons.length ? 'amber' : missing.length ? 'grey' : 'green';
  return { tier, word: TIERS[tier].word, reasons, missing };
}
