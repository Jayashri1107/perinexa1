// The postnatal discharge checklist and danger signs on the website (Clinical Requirements Group B, item 14): the same
// lists and rule as server/src/clinical/postnatalDischarge.js – a server test checks both copies. DRAFT, English only.

export const DISCHARGE_SOURCE =
  'WHO recommendations on maternal and newborn care for a positive postnatal experience (2022); MoHFW India – Home Based Newborn Care operational guidelines (2014) and the Mother and Child Protection card';

// The checks before she goes home. Each is answered yes, no or not applicable (na: only where it allows it).
export const DISCHARGE_ITEMS = [
  { key: 'vitals', label: "Mother's temperature, pulse and blood pressure normal today", group: 'mother' },
  { key: 'uterus', label: 'Uterus well contracted, bleeding (lochia) normal', group: 'mother' },
  { key: 'perineum', label: 'Perineum or caesarean wound checked and healing', group: 'mother' },
  { key: 'urine', label: 'Passing urine normally', group: 'mother' },
  { key: 'pain', label: 'Pain controlled', group: 'mother' },
  { key: 'breastfeeding', label: 'Breastfeeding observed – good attachment and positioning', group: 'mother' },
  { key: 'mood', label: 'Asked about her mood (EPDS done where the hospital uses it)', group: 'mother' },
  { key: 'antiD', label: 'Anti-D given if she is Rh negative and the baby Rh positive', group: 'mother', na: true },
  { key: 'medicines', label: 'Medicines to take home explained (as prescribed on the discharge card)', group: 'mother' },
  { key: 'contraception', label: 'Family planning discussed', group: 'mother' },
  { key: 'babyFeeding', label: 'Baby feeding well, passing urine and stool', group: 'baby' },
  { key: 'babyExam', label: "Baby examined before discharge (on the baby's own record)", group: 'baby' },
  { key: 'babyVaccines', label: "Baby's birth-dose vaccines given (BCG, OPV-0, hepatitis B)", group: 'baby', na: true },
  { key: 'followUp', label: 'Next postnatal visit booked', group: 'both' },
];
export const ANSWERS = ['yes', 'no', 'na'];

// Danger signs: go to the hospital at once if any of these happen.
export const DANGER_SIGNS_MOTHER = [
  { key: 'm_bleeding', label: 'Heavy bleeding – soaking a pad in an hour, or large clots' },
  { key: 'm_fever', label: 'Fever or shivering' },
  { key: 'm_discharge', label: 'Foul-smelling discharge from the vagina' },
  { key: 'm_headache', label: 'Severe headache, blurred vision, or fits' },
  { key: 'm_breathing', label: 'Difficulty breathing or chest pain' },
  { key: 'm_abdomen', label: 'Severe pain in the abdomen' },
  { key: 'm_leg', label: 'A painful, swollen leg' },
  { key: 'm_wound', label: 'The stitches or wound red, swollen or with pus' },
  { key: 'm_breast', label: 'A painful, red, hard breast' },
  { key: 'm_mood', label: 'Feeling very sad or anxious, or thoughts of harming herself or the baby' },
];
export const DANGER_SIGNS_BABY = [
  { key: 'b_feeding', label: 'Not feeding well, or stopped feeding' },
  { key: 'b_fits', label: 'Fits' },
  { key: 'b_breathing', label: 'Fast or difficult breathing, or the chest pulling in' },
  { key: 'b_temperature', label: 'Fever, or feels cold to touch' },
  { key: 'b_sleepy', label: 'Very sleepy, moves only when touched, or does not move' },
  { key: 'b_yellow', label: 'Yellow palms or soles, or yellow eyes in the first day' },
  { key: 'b_cord', label: 'The cord stump red, smelly or with pus' },
  { key: 'b_vomiting', label: 'Vomiting everything, or diarrhoea' },
];
export const DANGER_SIGN_KEYS = [...DANGER_SIGNS_MOTHER, ...DANGER_SIGNS_BABY].map((s) => s.key);
export const TEACH_BACK_BY = { mother: 'The mother', family: 'A family member', both: 'The mother and a family member' };
export const TEACHING_LANGUAGES = { en: 'English', mr: 'Marathi', hi: 'Hindi', other: 'Other' };

/**
 * What is still needed before the checklist can be marked complete: { field: message } (empty when it can). Every
 * item answered (not applicable only where allowed), every danger sign explained, teach-back done, and the next
 * visit's date when it was booked. PURE.
 */
export function missingToComplete(c = {}) {
  const out = {};
  for (const item of DISCHARGE_ITEMS) {
    const a = c.items?.[item.key];
    if (!a) out[`items.${item.key}`] = 'Answer this';
    else if (a === 'na' && !item.na) out[`items.${item.key}`] = 'Answer yes or no';
  }
  const explained = new Set(c.dangerSigns ?? []);
  if (DANGER_SIGN_KEYS.some((k) => !explained.has(k))) out.dangerSigns = 'Explain every danger sign and tick it';
  if (!c.teachBack?.done) out['teachBack.done'] = 'Ask her (or her family) to say the danger signs back, and what to do';
  else if (!c.teachBack.by) out['teachBack.by'] = 'Who said them back';
  if (c.items?.followUp === 'yes' && !c.followUpOn) out.followUpOn = 'Enter the date of the next visit';
  return out;
}
