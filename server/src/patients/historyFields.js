// The history-taking sheet (docs/HISTORY_SHEET_LAYOUT.md – layout agreed by the owner on 27 Oct 2026): the five lines
// of the owner's paper template and what the three drop-downs hold. One list for the Patient model and the patient
// routes; the website keeps the same lists with their labels in client/src/pages/patients/historyFormat.js (a test
// compares them). Every choice has a "not recorded" state ('' or null) – what every record from before the sheet has.
// Nothing here is about this pregnancy (that is recorded at the visit) or about a baby's sex.

export const CYCLE_KINDS = ['regular', 'irregular'];
export const YES_NO = ['yes', 'no'];
export const FLOW = ['scanty', 'normal', 'heavy'];
export const PERIOD_PAIN = ['none', 'mild', 'severe'];
export const PREGNANCY_OUTCOMES = ['live_birth', 'stillbirth', 'miscarriage', 'ectopic', 'molar'];
export const BIRTH_MODES = ['normal', 'assisted', 'caesarean'];
export const IMMUNISATION_STATUS = ['done', 'not_done', 'not_known'];
export const FAMILY_HISTORY = ['diabetes', 'hypertension', 'thyroid', 'tuberculosis', 'twins', 'congenital_anomalies', 'breast_ovarian_cancer', 'bleeding_disorders'];
export const DIETS = ['vegetarian', 'mixed'];
export const HABIT = ['never', 'past', 'current'];
export const MAX_PREGNANCIES = 15;

// Numbers, with the ranges the server accepts (a value outside is refused, never silently changed).
export const HISTORY_NUMBERS = {
  marriedSinceYears: { min: 0, max: 60, label: 'Married since (years)' },
  menarcheAge: { min: 8, max: 20, label: 'Age at first period' },
  cycleLengthDays: { min: 15, max: 180, label: 'Cycle length (days)' },
  bleedingDays: { min: 1, max: 20, label: 'Days of bleeding' },
};
export const PREGNANCY_NUMBERS = {
  year: { min: 1960, max: 2100, label: 'Year' },
  weeks: { min: 4, max: 44, label: 'Weeks' },
  weightGrams: { min: 200, max: 7000, label: "Baby's weight (g)" },
};
// Free texts and their lengths. The five lines' texts are what the doctor dictates.
export const HISTORY_TEXTS = {
  complaint: { max: 300, label: 'Complaints' },
  previousDeliveries: { max: 500, label: 'Previous deliveries' },
  otherHistory: { max: 500, label: 'Any other personal, medical, operative or family history' },
  periodsOther: { max: 200, label: 'Anything else about her periods' },
  contraception: { max: 150, label: 'Contraception used before, and when stopped' },
  operations: { max: 300, label: 'Operations, with the year' },
  currentMedicines: { max: 300, label: 'Current medicines' },
  familyWho: { max: 200, label: 'Who in the family' },
  occupation: { max: 80, label: 'Occupation' },
  sleepAppetite: { max: 120, label: 'Sleep and appetite' },
  bowelBladder: { max: 120, label: 'Bowel and bladder' },
};

// Words about a child's sex (PCPNDT) – the owner's decision 4 of 27 Oct 2026, reviewed by the developer with the owner:
// allowed ONLY where a child ALREADY BORN is described – the "Previous deliveries" line and the rows of the table of
// previous pregnancies ("male child, 2.9 kg"). Every other text of the sheet, and every other field, note, visit and
// scan text of the record, keeps the refusal on a pregnancy record. Narrowing where the check applies, never what it
// protects: this pregnancy has no field here (its details are recorded at the visit).
export const BORN_CHILD_TEXTS = ['previousDeliveries'];
export const BORN_CHILD_ROW_TEXTS = ['place', 'problems'];
/** The sheet's texts checked for words about a baby's sex on a pregnancy record: all but the born-child ones. */
export const SEX_CHECKED_TEXTS = Object.keys(HISTORY_TEXTS).filter((k) => !BORN_CHILD_TEXTS.includes(k));

/** True when nothing has been written on the sheet (every record from before it). */
export function historyEmpty(h) {
  if (!h) return true;
  const choices = ['cycle', 'consanguinity', 'flow', 'pain', 'lmpCertain', 'transfusion', 'td', 'rubella', 'hepB', 'diet', 'tobacco', 'alcohol'];
  if (choices.some((k) => h[k])) return false;
  if (Object.keys(HISTORY_NUMBERS).some((k) => h[k] != null)) return false;
  if (h.previousPeriod) return false;
  if ((h.family ?? []).length || (h.pregnancies ?? []).length) return false;
  return !Object.keys(HISTORY_TEXTS).some((k) => (h[k] ?? '').trim());
}
