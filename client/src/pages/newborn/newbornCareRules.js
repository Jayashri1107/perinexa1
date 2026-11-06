// The newborn-care rules on the website (Clinical Requirements Group B, items 12 and 13): the same lists and CCHD rule as
// server/src/clinical/newbornCare.js – a server test checks both copies. DRAFT.

export const NEWBORN_CARE_SOURCE =
  'WHO Essential Newborn Care (2014); IAP–NNF NSSK / NRP (2021); AAP CCHD screening algorithm (Pediatrics 2020); NNF newborn examination guideline; MoHFW SNCU admission and outcome register';

// At birth (NEO-F-01)
export const RESUSCITATION = { none: 'None needed', stimulation: 'Drying and stimulation only', bagMask: 'Bag-and-mask ventilation', intubation: 'Intubation', compressions: 'Chest compressions', medication: 'Medicines (adrenaline)' };
export const CORD_CLAMPING = { delayed: 'Delayed (1 minute or more)', early: 'Early (under 1 minute)' };
export const BIRTH_CHECKS = [
  { key: 'dried', label: 'Dried and kept warm' },
  { key: 'skinToSkin', label: 'Skin-to-skin contact with the mother', na: true },
  { key: 'vitaminK', label: 'Vitamin K given' },
  { key: 'eyeCare', label: 'Eye care given', na: true },
  { key: 'idBand', label: 'Identity band on the baby (mother’s name, date and time)' },
  { key: 'breastfedHour', label: 'Breastfed within the first hour', na: true },
];

// On the ward (NEO-F-02): each part normal or not (a "not normal" needs a note)
export const EXAM_ITEMS = [
  { key: 'general', label: 'General look, cry and tone' },
  { key: 'skin', label: 'Skin – colour, jaundice, rashes' },
  { key: 'head', label: 'Head and fontanelle' },
  { key: 'eyes', label: 'Eyes – red reflex' },
  { key: 'mouth', label: 'Mouth and palate' },
  { key: 'heart', label: 'Heart – rate, murmur, femoral pulses' },
  { key: 'chest', label: 'Breathing and chest' },
  { key: 'abdomen', label: 'Abdomen and cord stump' },
  { key: 'genitalia', label: 'Genitalia' },
  { key: 'anus', label: 'Anus open' },
  { key: 'spine', label: 'Back and spine' },
  { key: 'hips', label: 'Hips' },
  { key: 'limbs', label: 'Arms, legs, hands and feet' },
  { key: 'reflexes', label: 'Reflexes – suck, grasp, Moro' },
];
export const DISCHARGE_READY = [
  { key: 'feeding', label: 'Feeding well' },
  { key: 'urine', label: 'Passed urine' },
  { key: 'stool', label: 'Passed meconium' },
  { key: 'temperature', label: 'Keeps a normal temperature' },
];

// Bilirubin: serum or skin (transcutaneous), mg/dL, against the hours of age
export const BILI_METHODS = { serum: 'Serum (blood test)', skin: 'Skin meter (transcutaneous)' };

// CCHD pulse oximetry (AAP 2020): pass – 95% or more in the right hand OR a foot and a difference of 3 or less; fail –
// under 90% in both; anything else – repeat once (a second repeat that is not a pass is a fail).
/** The CCHD screen's result from the right-hand and foot SpO2: 'pass', 'repeat' or 'refer'. PURE. */
export function cchdResult(hand, foot, attempt = 1) {
  if (hand == null || foot == null) return null;
  const h = Number(hand);
  const f = Number(foot);
  if (h < 90 && f < 90) return 'refer';
  if ((h >= 95 || f >= 95) && Math.abs(h - f) <= 3) return 'pass';
  return attempt >= 2 ? 'refer' : 'repeat';
}

// The NICU or SNCU admission (NEO-F-03) and its outcome (NEO-L-05)
export const NICU_UNITS = { nicu: 'NICU', sncu: 'SNCU' };
export const NICU_SOURCES = { inborn: 'Born here (inborn)', outborn: 'Born elsewhere (outborn)' };
export const NICU_REASONS = {
  prematurity: 'Prematurity',
  lbw: 'Low birth weight',
  respiratory: 'Breathing difficulty',
  asphyxia: 'Birth asphyxia',
  sepsis: 'Suspected sepsis',
  jaundice: 'Jaundice',
  hypoglycaemia: 'Low blood sugar',
  hypothermia: 'Low temperature',
  feeding: 'Feeding problem',
  anomaly: 'Congenital anomaly',
  observation: 'Observation',
  other: 'Other',
};
export const NICU_OUTCOMES = { discharged: 'Discharged home', referred: 'Referred to a higher centre', lama: 'Left against medical advice', died: 'Died' };
/** Admitted cold: under 36.5 °C (WHO – hypothermia). PURE. */
export const coldAtAdmission = (tempC) => tempC != null && Number(tempC) < 36.5;
