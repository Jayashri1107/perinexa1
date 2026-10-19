// Why another doctor sent her (Referrals, docs/REFERRALS_PLAN.md): the referral thresholds of Anandi Hospitals'
// "Clinical Partner Guide" (Edition 1, October 2026, pages 3–4), as the owner gave them to referring doctors. PURE
// (no database). The keys are stored on each referral and never change; a label may be reworded. The website shows
// them grouped as the guide does:
//  - 'urgent': same day, any hour (the obstetric list on page 3 – the referring doctor calls ahead);
//  - 'within48': within 48 hours;
//  - 'routine': book antenatal care within the week;
//  - 'gynae': gynaecology (page 4).
// The guide's thresholds (BP and sugar values, weeks) are written into the labels in short, so the desk can match
// what the doctor wrote. Anything not on the list goes in the referral's "other reason". Clinical content: changed
// only with the owner's approval (CLAUDE.md).

export const REASON_GROUPS = [
  { key: 'urgent', label: 'Same day, any hour' },
  { key: 'within48', label: 'Within 48 hours' },
  { key: 'routine', label: 'Routine: antenatal care within the week' },
  { key: 'gynae', label: 'Gynaecology' },
];

export const REFERRAL_REASONS = [
  // Same day, any hour
  { key: 'vaginal_bleeding', group: 'urgent', label: 'Vaginal bleeding at any gestation' },
  { key: 'severe_bp', group: 'urgent', label: 'BP 160/110 or more, or 140/90 or more with headache, visual symptoms, epigastric pain or proteinuria' },
  { key: 'seizure', group: 'urgent', label: 'Seizure in pregnancy or within 6 weeks after delivery' },
  { key: 'reduced_movements', group: 'urgent', label: 'Reduced or absent fetal movements after 24 weeks' },
  { key: 'leaking', group: 'urgent', label: 'Leaking per vaginum at any gestation' },
  { key: 'preterm_contractions', group: 'urgent', label: 'Regular painful contractions before 37 weeks' },
  { key: 'abdominal_pain', group: 'urgent', label: 'Severe abdominal pain, or trauma to the abdomen' },
  { key: 'fever', group: 'urgent', label: 'Fever 38 °C or more in pregnancy or after delivery' },
  { key: 'severe_anaemia', group: 'urgent', label: 'Hb under 7 g/dL, or breathless at rest' },
  { key: 'possible_ectopic', group: 'urgent', label: 'Positive test with pain or bleeding, or no sac in the uterus on scan (rule out ectopic)' },
  { key: 'postpartum_warning', group: 'urgent', label: 'After delivery: heavy bleeding, foul discharge, calf pain or chest pain' },
  { key: 'looks_unwell', group: 'urgent', label: 'Pregnant and looks unwell to the referring doctor' },
  // Within 48 hours
  { key: 'new_bp', group: 'within48', label: 'New BP 140/90 or more without symptoms' },
  { key: 'gestational_diabetes', group: 'within48', label: 'Gestational diabetes (OGTT fasting 92 or more, or 2-hour 153 or more), or sugars not controlled' },
  { key: 'anaemia_not_responding', group: 'within48', label: 'Hb 7–9 g/dL not responding to oral iron' },
  { key: 'multiple_pregnancy', group: 'within48', label: 'Twins or higher-order pregnancy' },
  { key: 'abnormal_scan', group: 'within48', label: 'Abnormal finding on a scan: growth, liquor, placenta or anomaly' },
  { key: 'malpresentation', group: 'within48', label: 'Malpresentation at 36 weeks' },
  { key: 'forty_weeks', group: 'within48', label: '40 completed weeks without labour' },
  { key: 'medical_disorder', group: 'within48', label: 'Thyroid, heart, kidney, epilepsy or other medical disorder in pregnancy' },
  { key: 'rh_negative', group: 'within48', label: 'Rh-negative, not yet booked for Anti-D' },
  { key: 'persistent_vomiting', group: 'within48', label: 'Persistent vomiting with weight loss or ketones' },
  // Routine: book antenatal care within the week
  { key: 'new_pregnancy', group: 'routine', label: 'Newly confirmed pregnancy' },
  { key: 'previous_complication', group: 'routine', label: 'Previous caesarean, preterm birth, stillbirth or recurrent pregnancy loss' },
  { key: 'age_at_booking', group: 'routine', label: 'Age under 18 or over 35 at booking' },
  { key: 'bmi', group: 'routine', label: 'BMI 30 or more, or under 18.5' },
  { key: 'preconception', group: 'routine', label: 'Pre-conception counselling' },
  { key: 'previous_baby_anomaly_nicu', group: 'routine', label: 'Previous baby with a congenital anomaly or a NICU stay' },
  // Gynaecology
  { key: 'heavy_bleeding', group: 'gynae', label: 'Heavy or irregular menstrual bleeding' },
  { key: 'postmenopausal_bleeding', group: 'gynae', label: 'Postmenopausal bleeding' },
  { key: 'fibroids', group: 'gynae', label: 'Fibroids' },
  { key: 'ovarian_cyst', group: 'gynae', label: 'Ovarian cyst' },
  { key: 'pelvic_pain', group: 'gynae', label: 'Chronic pelvic pain, suspected endometriosis' },
  { key: 'infertility', group: 'gynae', label: 'Infertility' },
  { key: 'pcos_adolescent', group: 'gynae', label: 'PCOS or adolescent menstrual problems' },
  { key: 'menopause', group: 'gynae', label: 'Menopause' },
  { key: 'abnormal_pap', group: 'gynae', label: 'Abnormal Pap smear or persistent HPV' },
  { key: 'family_planning', group: 'gynae', label: 'Family planning' },
];

export const REASON_KEYS = REFERRAL_REASONS.map((r) => r.key);
export const reasonByKey = new Map(REFERRAL_REASONS.map((r) => [r.key, r]));

/** The labels of these reason keys, in the guide's order (a key no longer on the list is shown as it is). */
export const reasonLabels = (keys = []) => {
  const known = REFERRAL_REASONS.filter((r) => keys.includes(r.key)).map((r) => r.label);
  return [...known, ...keys.filter((k) => !reasonByKey.has(k))];
};

/** 'urgent' when any reason is on the guide's same-day list – what the form suggests (the desk decides). */
export const suggestedUrgency = (keys = []) => (keys.some((k) => reasonByKey.get(k)?.group === 'urgent') ? 'urgent' : 'routine');
