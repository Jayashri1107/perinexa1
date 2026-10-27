// The fertility history on an infertility record (docs/FERTILITY_PLAN.md): the facts the treatment-plan
// suggestions are worked out from. One list for the Patient model, the patient routes and the suggestion rules; the
// website keeps the same lists with their labels in client/src/pages/patients/fertilityFormat.js (a test compares them).
// Every choice has a "not recorded" state ('' or null), which is what every record from before these fields has.
// There is no field for the partner's name (not needed for the plan), and nothing about the sex of any child.

export const FERTILITY_TYPES = ['primary', 'secondary'];
export const CYCLE_PATTERNS = ['regular', 'irregular', 'amenorrhoea'];
export const OVULATION_STATUS = ['confirmed', 'anovulation', 'not_tested'];
export const TUBAL_STATUS = ['patent_both', 'one_blocked', 'both_blocked', 'hydrosalpinx', 'not_tested'];
export const UTERINE_FINDINGS = ['normal', 'septum', 'submucous_fibroid', 'polyp', 'adhesions', 'other', 'not_assessed'];
export const ENDOMETRIOSIS_STATUS = ['none', 'suspected', 'minimal_mild', 'moderate_severe'];
// Semen analysis against the WHO 2021 manual's lower reference limits (one or more parameters below them = abnormal)
export const SEMEN_STATUS = ['normal', 'mild_abnormal', 'severe_abnormal', 'azoospermia', 'not_tested'];
// Diagnoses already made (tick boxes). Thyroid disease, diabetes and tuberculosis are in the medical background.
export const FERTILITY_DIAGNOSES = [
  'pcos', // polycystic ovary syndrome (Rotterdam / 2023 international criteria)
  'hypogonadotropic', // hypogonadotropic hypogonadism (WHO group I: low FSH and LH)
  'poi', // premature ovarian insufficiency (WHO group III)
  'hyperprolactinaemia',
  'diminished_reserve', // low ovarian reserve on AMH / AFC for her age
  'genital_tb', // genital tuberculosis (diagnosed or treated)
  'pelvic_infection_or_surgery', // past PID or pelvic surgery
  'varicocele', // clinical varicocele in the partner
  'sexual_difficulty', // vaginal intercourse not possible or very difficult
];

// Numbers, with the ranges the server accepts (a value outside is refused, never silently changed).
export const FERTILITY_NUMBERS = {
  durationMonths: { min: 0, max: 480, label: 'Months trying to conceive' },
  partnerAgeYears: { min: 15, max: 100, label: "Partner's age" },
  cycleLengthDays: { min: 15, max: 180, label: 'Cycle length' },
  amh: { min: 0, max: 50, label: 'AMH (ng/mL)' },
  afc: { min: 0, max: 99, label: 'Antral follicle count' },
  fsh: { min: 0, max: 200, label: 'Day 2–3 FSH (IU/L)' },
  prolactin: { min: 0, max: 5000, label: 'Prolactin (ng/mL)' },
  tsh: { min: 0, max: 200, label: 'TSH (mIU/L)' },
  oiCycles: { min: 0, max: 50, label: 'Ovulation induction cycles done' },
  iuiCycles: { min: 0, max: 50, label: 'IUI cycles done' },
  ivfCycles: { min: 0, max: 20, label: 'IVF or ICSI cycles done' },
};
export const FERTILITY_TEXTS = {
  semenDetail: { max: 300, label: 'Semen analysis detail' },
  previousTreatment: { max: 500, label: 'Previous treatment' },
  note: { max: 500, label: 'Note' },
};

/** True when nothing has been recorded in the fertility history (every record from before these fields). */
export function fertilityEmpty(f) {
  if (!f) return true;
  const choices = ['type', 'cycle', 'ovulation', 'tubes', 'uterus', 'endometriosis', 'semen'];
  if (choices.some((k) => f[k])) return false;
  if ((f.diagnoses ?? []).length) return false;
  if (Object.keys(FERTILITY_NUMBERS).some((k) => f[k] != null)) return false;
  return !Object.keys(FERTILITY_TEXTS).some((k) => (f[k] ?? '').trim());
}
