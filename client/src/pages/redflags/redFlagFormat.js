// Red flags (Smart features, step 1): labels and wording for the rules and the flags.
// The factors mirror server/src/redflags/redFlags.js (a server test checks they stay the same).
import { Eye, Siren } from 'lucide-react';

export const RED_FLAG_STATUS = {
  urgent: { tone: 'high', icon: Siren, word: 'Urgent' },
  watch: { tone: 'watch', icon: Eye, word: 'Watch' },
};

export const URINE_ORDER = ['nil', 'trace', '1+', '2+', '3+', '4+'];
export const OEDEMA_ORDER = ['none', 'mild', 'moderate', 'severe'];

// The types of care a rule can apply to, in the order the pages show them, with the words used for them.
export const RULE_CARE_TYPES = ['antenatal', 'postnatal', 'newborn', 'gynaecology', 'infertility', 'abortion'];
export const RULE_CARE_LABELS = {
  antenatal: 'Pregnancy (antenatal)',
  postnatal: 'After delivery (postnatal)',
  newborn: 'Newborn',
  gynaecology: 'Gynaecology',
  infertility: 'Infertility',
  abortion: 'Abortion (pregnancy loss)',
};
// In a sentence: "… is not checked for postnatal patients"
const CARE_WORDS = { antenatal: 'antenatal', postnatal: 'postnatal', infertility: 'infertility', gynaecology: 'gynaecology', newborn: 'newborn', abortion: 'pregnancy-loss' };
/** The types of care a rule applies to (a rule saved before rules had this is for pregnancy care). */
export const ruleCareTypes = (rule) => (rule?.appliesTo?.length ? RULE_CARE_TYPES.filter((t) => rule.appliesTo.includes(t)) : ['antenatal']);

const PREGNANCY_ONLY = ['antenatal'];
const BABY_ONLY = ['newborn'];
const LOSS_ONLY = ['abortion'];
const NOT_BABY = ['antenatal', 'postnatal', 'infertility', 'gynaecology', 'abortion'];

// What a rule can check. group: vitals – recorded at a visit or, in hospital, on the nursing chart; visit – other
// values recorded at a visit; worked – worked out from them; lab – a result reported by the lab; record – on her
// record (pregnancy-loss care: where the pregnancy is, and the findings a doctor or RMO recorded there).
// careTypes: the types of care the value exists for (none given: every type).
export const RED_FLAG_FACTORS = {
  bpSystolic: { label: 'BP systolic', unit: 'mmHg', type: 'number', group: 'vitals' },
  bpDiastolic: { label: 'BP diastolic', unit: 'mmHg', type: 'number', group: 'vitals' },
  pulse: { label: 'Pulse', unit: '/min', type: 'number', group: 'vitals' },
  temperatureF: { label: 'Temperature', unit: '°F', type: 'number', group: 'vitals' },
  spo2: { label: 'SpO₂', unit: '%', type: 'number', group: 'vitals' },
  hb: { label: 'Hb', unit: 'g/dL', type: 'number', group: 'visit' },
  urineAlbumin: { label: 'Urine albumin', type: 'grade', order: URINE_ORDER, group: 'visit' },
  urineSugar: { label: 'Urine sugar', type: 'grade', order: URINE_ORDER, group: 'visit' },
  oedema: { label: 'Oedema', type: 'grade', order: OEDEMA_ORDER, group: 'visit', careTypes: PREGNANCY_ONLY },
  fetalMovements: { label: 'Fetal movements', type: 'choice', choices: ['present', 'reduced', 'absent'], group: 'visit', careTypes: PREGNANCY_ONLY },
  fetalHeartRate: { label: 'Fetal heart rate', unit: '/min', type: 'number', group: 'visit', careTypes: PREGNANCY_ONLY },
  presentation: { label: 'Presentation', type: 'choice', choices: ['cephalic', 'breech', 'transverse', 'oblique', 'variable'], group: 'visit', careTypes: PREGNANCY_ONLY },
  fundalHeightGap: { label: 'Fundal height differs from weeks by', unit: 'cm', type: 'number', group: 'worked', careTypes: PREGNANCY_ONLY },
  weightGainPerWeek: { label: 'Weight gain since last visit', unit: 'kg/week', type: 'number', group: 'worked', careTypes: PREGNANCY_ONLY },
  weeksToday: { label: 'Weeks of pregnancy today', unit: 'weeks', type: 'number', group: 'worked', careTypes: PREGNANCY_ONLY },
  weightBelowBirth: { label: 'Weight below birth weight by', unit: '%', type: 'number', group: 'worked', careTypes: BABY_ONLY },
  labHb: { label: 'Haemoglobin (lab)', unit: 'g/dL', type: 'number', group: 'lab' },
  labPlatelets: { label: 'Platelets (lab)', unit: 'lakh/µL', type: 'number', group: 'lab' },
  labFastingGlucose: { label: 'Fasting blood sugar (lab)', unit: 'mg/dL', type: 'number', group: 'lab', careTypes: NOT_BABY },
  labOgtt2h: { label: 'OGTT 2-hour blood sugar (lab)', unit: 'mg/dL', type: 'number', group: 'lab', careTypes: NOT_BABY },
  labPostMealGlucose: { label: 'Post-meal blood sugar (lab)', unit: 'mg/dL', type: 'number', group: 'lab', careTypes: NOT_BABY },
  labRandomGlucose: { label: 'Random blood sugar (lab)', unit: 'mg/dL', type: 'number', group: 'lab', careTypes: NOT_BABY },
  labTsh: { label: 'TSH (lab)', unit: 'µIU/mL', type: 'number', group: 'lab' },
  labUrineAlbumin: { label: 'Urine albumin (lab)', type: 'grade', order: URINE_ORDER, group: 'lab', careTypes: NOT_BABY },
  labBabyGlucose: { label: "Baby's blood sugar (lab)", unit: 'mg/dL', type: 'number', group: 'lab', careTypes: BABY_ONLY },
  labBilirubinTotal: { label: "Baby's total bilirubin (lab)", unit: 'mg/dL', type: 'number', group: 'lab', careTypes: BABY_ONLY },
  labBilirubinDirect: { label: "Baby's direct bilirubin (lab)", unit: 'mg/dL', type: 'number', group: 'lab', careTypes: BABY_ONLY },
  // Pregnancy-loss care, from her record. Location: ectopic – the type of loss is an ectopic pregnancy; unknown – a
  // pregnancy of unknown location (the scan showed no gestational sac in the uterus, and the type of loss is not an
  // ectopic or a molar pregnancy).
  lossLocation: { label: 'Pregnancy location', type: 'choice', choices: ['ectopic', 'unknown'], group: 'record', careTypes: LOSS_ONLY },
  lossRuptureSigns: { label: 'Signs of rupture', type: 'choice', choices: ['yes', 'no'], group: 'record', careTypes: LOSS_ONLY },
  lossBleeding: { label: 'Bleeding', type: 'choice', choices: ['light', 'moderate', 'heavy'], group: 'record', careTypes: LOSS_ONLY },
  lossFeverDischarge: { label: 'Fever with foul-smelling discharge', type: 'choice', choices: ['yes', 'no'], group: 'record', careTypes: LOSS_ONLY },
};

// The checks in the edit page's list, grouped by where the value comes from.
export const FACTOR_GROUPS = [
  { key: 'vitals', label: 'Vital signs – a visit, or the nursing chart in hospital' },
  { key: 'visit', label: 'Recorded at a visit' },
  { key: 'worked', label: 'Worked out' },
  { key: 'lab', label: 'Lab results' },
  { key: 'record', label: 'On her record – pregnancy-loss care' },
];
// What "Pregnancy location" means, for the hint under that check on the edit page.
export const LOSS_LOCATION_HINT =
  'Ectopic: the type of loss on her record is an ectopic pregnancy. Unknown: a pregnancy of unknown location – a complete miscarriage whose scan showed no gestational sac in the uterus (nor did an earlier scan), with no products of conception seen. Neither counts once the outcome is "Treatment complete" or an operation is recorded with its date.';

/** The types of care (of those ticked) a check does not exist for – a rule with one of them is refused by the server. */
export function notCheckedFor(factor, appliesTo) {
  const f = RED_FLAG_FACTORS[factor];
  return f?.careTypes ? (appliesTo ?? []).filter((t) => !f.careTypes.includes(t)) : [];
}
/** The same words the server answers with: "Fetal heart rate is not checked for postnatal patients – …" ('' when fine). */
export function notCheckedText(factor, appliesTo) {
  const not = notCheckedFor(factor, appliesTo);
  if (!not.length) return '';
  return `${RED_FLAG_FACTORS[factor].label} is not checked for ${not.map((t) => CARE_WORDS[t]).join(', ')} patients – untick that type of care or choose another check`;
}

export const OP_TEXT = { lt: 'under', lte: 'at most', gt: 'over', gte: 'at least' };

/** One check in words, e.g. "BP systolic at least 160 mmHg". */
export function conditionText(c) {
  const f = RED_FLAG_FACTORS[c.factor];
  if (!f) return 'Unknown check';
  if (f.type === 'number') return `${f.label} ${OP_TEXT[c.op] ?? c.op} ${c.value}${f.unit ? ` ${f.unit}` : ''}`;
  if (f.type === 'grade') return `${f.label} ${c.grade} or more`;
  return `${f.label}: ${(c.choices ?? []).join(' or ')}`;
}

/** When in pregnancy the rule applies, e.g. "from 20 weeks", "24–40 weeks", "" (always). */
export function weeksText(r) {
  if (r.fromWeek != null && r.toWeek != null) return `${r.fromWeek}–${r.toWeek} weeks`;
  if (r.fromWeek != null) return `from ${r.fromWeek} weeks`;
  if (r.toWeek != null) return `up to ${r.toWeek} weeks`;
  return '';
}

const daysOld = (n) => `${n} ${n === 1 ? 'day' : 'days'} old`;
/** At which age of a baby the rule applies (whole days, when the value was taken): "baby under 1 day old", "baby 1–3 days old", "". */
export function ageText(r) {
  const a = r.fromDay ?? null;
  const b = r.toDay ?? null;
  if (a == null && b == null) return '';
  if (a != null && b != null) {
    if (a !== b) return `baby ${a}–${b} days old`;
    return b === 0 ? 'baby under 1 day old' : `baby ${daysOld(b)}`;
  }
  if (a != null) return `baby ${daysOld(a)} or more`;
  return b === 0 ? 'baby under 1 day old' : `baby up to ${daysOld(b)}`;
}

// A rule with several checks whose values were recorded in different places (a visit, a lab result, the nursing
// chart) is raised only when they were recorded within this many days of each other (the same number as the server's).
export const RULE_VALUES_WITHIN_DAYS = 7;
/** For a rule that joins a lab result with a value from a visit or the nursing chart: "values recorded within 7 days of each other" ('' otherwise). */
export function withinText(r) {
  const groups = (r.conditions ?? []).filter((c) => c.factor !== 'weeksToday').map((c) => RED_FLAG_FACTORS[c.factor]?.group);
  return groups.includes('lab') && groups.some((x) => x && x !== 'lab') ? `values recorded within ${RULE_VALUES_WITHIN_DAYS} days of each other` : '';
}

/** The whole rule in words: "BP systolic at least 140 mmHg and Urine albumin 1+ or more, from 20 weeks". */
export function ruleChecksText(r) {
  const checks = (r.conditions ?? []).map(conditionText).join(' and ');
  return [checks, weeksText(r), ageText(r), withinText(r)].filter(Boolean).join(', ');
}

// How the rules read the record, for the hints on the rule pages: what "this pregnancy or episode of care" means,
// which reading counts when the same thing was measured twice, and how close the values of one rule must be.
export const EPISODE_HINT =
  'This pregnancy or episode of care means: in pregnancy care, this pregnancy; after delivery, since the delivery (the last 6 weeks when no delivery date is on the record); for a baby, since birth; for the other types of care, the last 3 months.';
// Pregnancy-loss care: what the rules read from the record itself.
export const LOSS_RECORD_HINT =
  'In pregnancy-loss care the rules also read her record: where the pregnancy is (an ectopic, or not yet located on the scan), and the findings a doctor or RMO recorded there in the last 3 months – signs of rupture, bleeding, fever with foul-smelling discharge. A finding stays as recorded until someone changes it.';
export const READINGS_HINT = `Haemoglobin and urine albumin are recorded at a visit and by the lab: only the newer reading raises a flag. When a rule has several checks, their values must have been recorded within ${RULE_VALUES_WITHIN_DAYS} days of each other.`;

/**
 * The offer of newer built-in draft rules, in words: "8 draft rules, for: Abortion (pregnancy loss)." – the count
 * and the types of care the offered rules are for (the server names them; without them only the count).
 */
export function newBuiltInText(count, careTypes) {
  const rules = `${count} draft ${count === 1 ? 'rule' : 'rules'}`;
  const names = RULE_CARE_TYPES.filter((t) => (careTypes ?? []).includes(t)).map((t) => RULE_CARE_LABELS[t]);
  return names.length ? `${rules}, for: ${names.join(', ')}.` : `${rules}.`;
}

/** "Pregnancy (antenatal), After delivery (postnatal)" – the types of care a rule applies to. */
export const appliesToText = (r) => ruleCareTypes(r).map((t) => RULE_CARE_LABELS[t] ?? t).join(', ');

/**
 * The rules grouped by type of care, in the pages' order: [{ careType, label, rules }] – only types that have a
 * rule. A rule that applies to several types is listed under each of them.
 */
export function rulesByCareType(rules) {
  return RULE_CARE_TYPES.map((careType) => ({ careType, label: RULE_CARE_LABELS[careType], rules: (rules ?? []).filter((r) => ruleCareTypes(r).includes(careType)) })).filter((g) => g.rules.length);
}

// One check as it is saved: only the fields of its kind (a number, a grade or choices).
const checkToSave = (c) => {
  const f = RED_FLAG_FACTORS[c.factor];
  if (f.type === 'number') return { factor: c.factor, op: c.op, value: c.value };
  if (f.type === 'grade') return { factor: c.factor, grade: c.grade };
  return { factor: c.factor, choices: c.choices };
};
/**
 * A rule as the edit page saves it (from its row of text fields). Weeks of pregnancy are kept only on a rule for
 * pregnancy care, a baby's age only on a rule for newborn care – their fields are hidden otherwise, so nothing
 * unseen is sent.
 */
export function ruleToSave(r) {
  const pregnancy = r.appliesTo.includes('antenatal');
  const baby = r.appliesTo.includes('newborn');
  return {
    key: r.key.trim(),
    label: r.label,
    level: r.level,
    appliesTo: r.appliesTo,
    message: r.message,
    conditions: r.conditions.map(checkToSave),
    fromWeek: pregnancy ? r.fromWeek : '',
    toWeek: pregnancy ? r.toWeek : '',
    fromDay: baby ? r.fromDay : '',
    toDay: baby ? r.toDay : '',
    source: r.source,
  };
}

/**
 * The flags on the patient's record that a visit's own card does not show: from lab results, from the nursing chart,
 * from today's date, from another visit or (pregnancy-loss care) from the findings on her record. recordFlags: the record's flags now; visitFlags: this visit's flags.
 */
export function flagsElsewhere(recordFlags, visitFlags) {
  const here = new Set((visitFlags ?? []).map((f) => `${f.key}|${f.detail}`));
  return (recordFlags ?? []).filter((f) => !here.has(`${f.key}|${f.detail}`));
}

/** "2 urgent, 1 to watch" – for counts next to a patient. */
export function flagCountText(flags) {
  const urgent = flags.filter((f) => f.level === 'urgent').length;
  const watch = flags.length - urgent;
  return [urgent && `${urgent} urgent`, watch && `${watch} to watch`].filter(Boolean).join(', ');
}

/**
 * Which patients the rules check, in words – from the types of care the hospital's rules cover (rules.careTypes in
 * every answer with flags). Only what is true: a type of care without a rule is named as not checked.
 */
export function checkedCareText(careTypes) {
  if (!Array.isArray(careTypes)) return '';
  const names = (list) => list.map((t) => RULE_CARE_LABELS[t]).join(', ');
  const covered = RULE_CARE_TYPES.filter((t) => careTypes.includes(t));
  const not = RULE_CARE_TYPES.filter((t) => !careTypes.includes(t));
  if (!covered.length) return 'No patient is checked: the hospital has no red-flag rules.';
  return [`Checked – the types of care that have a rule: ${names(covered)}.`, not.length ? `Not checked – no rule applies: ${names(not)}.` : ''].filter(Boolean).join(' ');
}
/**
 * For a patient in hospital whose type of care has no rule: nothing was checked, which is not "no red flags".
 * workupOnly: a pregnancy-loss record only for the recurrent-loss work-up (the server's workupOnly) – the rules of that
 * care are about a loss cared for now, so none is about her.
 */
export const notCheckedCareText = (careType, workupOnly = false) =>
  workupOnly
    ? 'Her record is only for the recurrent-loss work-up, and the pregnancy-loss red-flag rules are about a loss cared for now – the vital signs on the nursing chart are not checked.'
    : `No red-flag rule applies to ${RULE_CARE_LABELS[careType] ?? 'this type of care'} – the vital signs on the nursing chart are not checked.`;
// How long a flag stays on Today's list (the server's RED_FLAG_LIST_DAYS is 6 weeks).
export const LISTED_TEXT =
  'A patient in hospital is listed as long as a flag stands, and a pregnancy patient for the flags of her latest visit. Other flags – from a lab result alone, or of a patient who is not in pregnancy care – are listed for 6 weeks after the value was recorded; they stay on the record after that.';

// What the rules can't see (same words as the server).
export const RED_FLAGS_NOT_CHECKED =
  "Not checked automatically: symptoms written as text (bleeding, leaking, headache, blurred vision, abdominal pain, fits, breathlessness, a baby feeding poorly), scan findings (in pregnancy-loss care only the ticks on her record are checked: signs of rupture, heavy bleeding, fever with foul-smelling discharge, and a pregnancy not seen in the uterus), lab results written in words, only attached as a file, typed in a different unit from the one shown, or with no rule (for example HIV, HBsAg, cultures, liver and kidney tests, beta hCG), vital signs with no rule for the patient's type of care (for example SpO₂ after delivery or for a baby), a baby's skin bilirubin, and the lower bilirubin limits of a baby born early. Doctors must still assess these.";
