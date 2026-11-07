// Maternal death and near-miss review (Clinical Requirements Group C – PX-OBG-30). DRAFT – from published guidance until
// the manual's page is given; the owner (a doctor) approves the lists and wording before real use. The website gets
// them from GET /api/case-reviews (rules).
// Sources: WHO maternal near-miss criteria (Evaluating the quality of care for severe pregnancy complications, 2011);
// WHO ICD-MM groups of causes (2012); the three-delays model as in India's MDSR operational guidelines (2017).

export const REVIEW_SOURCE =
  'DRAFT – WHO maternal near-miss criteria (2011), WHO ICD-MM groups of causes (2012) and the three delays as in India’s MDSR guidelines (2017); awaiting the owner’s approval and the manual page';

export const REVIEW_KINDS = { maternal_death: 'Maternal death', near_miss: 'Maternal near miss' };

// WHO near-miss criteria, by organ system: one or more makes a woman a near-miss case.
export const NEAR_MISS_CRITERIA = [
  { key: 'shock', group: 'Heart and circulation', label: 'Shock' },
  { key: 'cardiac_arrest', group: 'Heart and circulation', label: 'Cardiac arrest' },
  { key: 'vasoactive', group: 'Heart and circulation', label: 'Continuous vasoactive drugs' },
  { key: 'cpr', group: 'Heart and circulation', label: 'Cardiopulmonary resuscitation' },
  { key: 'lactate_ph', group: 'Heart and circulation', label: 'Lactate over 5 mmol/L or pH under 7.1' },
  { key: 'cyanosis', group: 'Breathing', label: 'Acute cyanosis or gasping' },
  { key: 'rr_extreme', group: 'Breathing', label: 'Respiratory rate over 40 or under 6 a minute' },
  { key: 'spo2_low', group: 'Breathing', label: 'SpO2 under 90% for 60 minutes or more' },
  { key: 'intubation', group: 'Breathing', label: 'Intubation and ventilation not for anaesthesia' },
  { key: 'oliguria', group: 'Kidneys', label: 'Oliguria not responding to fluids or diuretics' },
  { key: 'creatinine', group: 'Kidneys', label: 'Creatinine 300 µmol/L (3.5 mg/dL) or more' },
  { key: 'dialysis', group: 'Kidneys', label: 'Dialysis for acute kidney failure' },
  { key: 'clotting', group: 'Blood', label: 'Failure to form clots' },
  { key: 'transfusion', group: 'Blood', label: 'Transfusion of 5 or more units of red cells' },
  { key: 'platelets', group: 'Blood', label: 'Platelets under 50,000' },
  { key: 'jaundice_pe', group: 'Liver', label: 'Jaundice with pre-eclampsia' },
  { key: 'bilirubin', group: 'Liver', label: 'Bilirubin over 100 µmol/L (6 mg/dL)' },
  { key: 'coma', group: 'Brain', label: 'Unconscious for 12 hours or more' },
  { key: 'stroke', group: 'Brain', label: 'Stroke' },
  { key: 'status_epilepticus', group: 'Brain', label: 'Fits that could not be controlled' },
  { key: 'paralysis', group: 'Brain', label: 'Total paralysis' },
  { key: 'hysterectomy', group: 'Uterus', label: 'Hysterectomy for infection or bleeding' },
];
export const NEAR_MISS_KEYS = NEAR_MISS_CRITERIA.map((c) => c.key);

// WHO ICD-MM groups of the underlying cause.
export const CAUSES = {
  abortive: 'Pregnancy with abortive outcome',
  hypertensive: 'Hypertensive disorders',
  haemorrhage: 'Obstetric haemorrhage',
  infection: 'Pregnancy-related infection',
  other_obstetric: 'Other obstetric complications',
  management: 'Unanticipated complications of management',
  non_obstetric: 'Non-obstetric complications (indirect)',
  unknown: 'Unknown or undetermined',
};

// The three delays.
export const DELAYS = {
  delay1: 'Delay 1 – deciding to seek care',
  delay2: 'Delay 2 – reaching the hospital',
  delay3: 'Delay 3 – receiving the right care here',
};
export const DELAY_ANSWERS = { yes: 'Yes', no: 'No', unknown: 'Not known' };
export const AVOIDABLE = { yes: 'Yes', possibly: 'Possibly', no: 'No' };

// The parts of a sealed review a correction may name.
export const CORRECTABLE = {
  eventAt: 'Date and time of the event',
  summary: 'Summary of the case',
  criteria: 'Near-miss criteria',
  cause: 'Underlying cause',
  causeDetail: 'Cause in words',
  delays: 'Delays',
  avoidable: 'Avoidable',
  factors: 'Avoidable factors',
  lessons: 'Lessons',
  actions: 'Actions',
  meetingOn: 'Day of the review meeting',
  members: 'Present at the meeting',
};
