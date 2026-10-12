// Words for consent forms: the languages, when a form is suggested, the blanks, and the printed labels in
// English, Marathi and Hindi. The rules for blanks and languages match the server's
// (server/src/consents/consentText.js), so problems show before anything is sent.

export const LANGUAGES = ['en', 'mr', 'hi'];
export const SECOND_LANGUAGES = ['mr', 'hi'];
export const LANGUAGE_NAMES = { en: 'English', mr: 'Marathi', hi: 'Hindi' };
/** How each language is named where it is chosen: in its own script too. */
export const LANGUAGE_LABELS = { en: 'English', mr: 'मराठी (Marathi)', hi: 'हिंदी (Hindi)' };

/** The choices when printing: English with Marathi, English with Hindi, or English only. */
export const PRINT_LANGUAGES = [
  { key: 'mr', label: 'English + मराठी (Marathi)' },
  { key: 'hi', label: 'English + हिंदी (Hindi)' },
  { key: 'en', label: 'English only' },
];
export const printLanguageLabel = (lang) => PRINT_LANGUAGES.find((l) => l.key === lang)?.label ?? lang;

// ---------- Consent forms and information forms ----------

/**
 * The words for each kind of form. consent: the patient agrees to a procedure. information: the doctor explains a
 * condition or complication (e.g. PIH, GDM) and the patient and her relatives sign that they were informed.
 */
export const KIND_WORDS = {
  consent: { plural: 'Consent forms', one: 'consent form', many: 'consent forms', base: '/consent-forms', tab: 'consents', patientTab: 'Consent forms' },
  information: { plural: 'Information forms', one: 'information form', many: 'information forms', base: '/information-forms', tab: 'information', patientTab: 'Information given' },
};
export const kindWords = (kind) => KIND_WORDS[kind] ?? KIND_WORDS.consent;

/** The built-in information forms by stage of care, for the patient's Information given tab (others: "Other"). */
const STAGE_KEYS = {
  'Early pregnancy': ['info_hyperemesis', 'info_threatened_miscarriage', 'info_miscarriage', 'info_ectopic', 'info_molar'],
  Labour: ['info_fetal_distress', 'info_prolonged_labour'],
  'After delivery': ['info_pph', 'info_puerperal_sepsis', 'info_perineal_tear', 'info_postnatal_depression'],
};
export const INFO_STAGES = ['Early pregnancy', 'Pregnancy', 'Labour', 'After delivery', 'Other'];
/** The stage an information form is listed under. */
export function infoStage(form) {
  for (const [stage, keys] of Object.entries(STAGE_KEYS)) if (keys.includes(form.key)) return stage;
  return form.origin === 'built_in' && form.key !== 'info_condition' ? 'Pregnancy' : 'Other';
}

/** When a form is suggested (the library and its editor). */
export const SUGGEST_LABELS = {
  none: 'Not suggested – only listed for its types of care',
  always: 'Always, for its types of care',
  high_risk: 'When the pregnancy is high-risk',
  previous_caesarean: 'After a previous caesarean',
  scan_due: 'When a scan in the care plan is due',
  hiv_test_due: 'When the HIV test in the care plan is due',
  from_37_weeks: 'From 37 weeks of pregnancy',
  from_40_weeks: 'From 40 weeks of pregnancy',
  blood_pressure: 'High blood pressure (condition ticked, or a BP red flag at the latest visit)',
  diabetes: 'Diabetes (condition ticked, or a high OGTT this pregnancy)',
  thyroid: 'Thyroid disease (condition ticked, or a high TSH this pregnancy)',
  anaemia: 'Anaemia (condition ticked, an anaemia red flag, or Hb below 11 this pregnancy)',
  rh_negative: 'Rh-negative blood group',
  not_head_down: 'Baby not head-down at the latest visit (from 36 weeks)',
  bad_obstetric_history: 'Problems in earlier pregnancies (ticked, or 2 or more miscarriages / abortions)',
  reduced_movements: 'Reduced fetal movements at the latest visit',
  heart_disease: 'Heart disease (condition ticked)',
  epilepsy: 'Epilepsy (condition ticked)',
  hepatitis_b: 'Hepatitis B (condition ticked, or HBsAg reactive)',
  obesity: 'BMI 30 or more (from the recorded height and weight)',
  age_35_plus: 'Age 35 or more',
};
/** The rules that fit information forms (a condition the record shows), and those that fit consent forms. */
export const INFORMATION_RULES = ['none', 'always', 'high_risk', 'blood_pressure', 'diabetes', 'thyroid', 'anaemia', 'rh_negative', 'not_head_down', 'bad_obstetric_history', 'reduced_movements', 'heart_disease', 'epilepsy', 'hepatitis_b', 'obesity', 'age_35_plus', 'from_40_weeks', 'previous_caesarean'];
export const SUGGEST_RULES = Object.keys(SUGGEST_LABELS);

/** Why a form is suggested for this patient now (the words on its pill). */
export const SUGGEST_WHY = {
  always: 'Suggested',
  high_risk: 'High-risk pregnancy',
  previous_caesarean: 'Previous caesarean',
  scan_due: 'Scan due',
  hiv_test_due: 'HIV test due',
  from_37_weeks: '37 weeks or more',
  from_40_weeks: '40 weeks or more',
  blood_pressure: 'High blood pressure',
  diabetes: 'Diabetes',
  thyroid: 'Thyroid',
  anaemia: 'Anaemia',
  rh_negative: 'Rh negative',
  not_head_down: 'Not head-down',
  bad_obstetric_history: 'Earlier pregnancy problems',
  reduced_movements: 'Less movement',
  heart_disease: 'Heart disease',
  epilepsy: 'Epilepsy',
  hepatitis_b: 'Hepatitis B',
  obesity: 'BMI 30 or more',
  age_35_plus: 'Age 35 or more',
};

// ---------- Blanks ----------

export const BLANKS = ['patient', 'age', 'mrn', 'hospital', 'doctor', 'procedure', 'reason', 'condition'];
/** What each blank becomes when the form is printed. */
export const BLANK_LABELS = {
  patient: "patient's name",
  age: 'age in years',
  mrn: 'patient number',
  hospital: 'hospital name',
  doctor: "doctor's name",
  procedure: 'operation or procedure',
  reason: 'reason',
  condition: 'condition or complication',
};
/** The blanks the doctor types when printing. */
export const TYPED_BLANKS = ['procedure', 'reason', 'condition'];

const BLANK = /\{([^{}\s]*)\}/g;
export const blanksIn = (text) => [...String(text ?? '').matchAll(BLANK)].map((m) => m[1]);
const blankSet = (text) => [...new Set(blanksIn(text))].sort().join(',');

/** A text split into words and blanks: [{ text } | { blank }]. Unknown "{…}" stays as text. */
export function textParts(text) {
  const s = String(text ?? '');
  const parts = [];
  let last = 0;
  for (const m of s.matchAll(BLANK)) {
    if (m.index > last) parts.push({ text: s.slice(last, m.index) });
    parts.push(BLANKS.includes(m[1]) ? { blank: m[1] } : { text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push({ text: s.slice(last) });
  return parts;
}

/** A language is complete when the title and every clause have text in it. */
export const isComplete = (form, lang) => Boolean(form.title?.[lang]?.trim()) && (form.clauses ?? []).length > 0 && form.clauses.every((c) => c[lang]?.trim());
/** The languages a form can be printed in (English always). */
export const languagesOf = (form) => LANGUAGES.filter((l) => l === 'en' || isComplete(form, l));
/** The blanks the form's English clauses use. */
export const formBlanks = (form) => new Set((form.clauses ?? []).flatMap((c) => blanksIn(c.en)).filter((b) => BLANKS.includes(b)));

/** The same checks as the server: { 'clauses.2.mr': message, 'title.hi': message }. */
export function blankProblems(form) {
  const out = {};
  const list = BLANKS.map((b) => `{${b}}`).join(' ');
  for (const lang of LANGUAGES) {
    if (blanksIn(form.title?.[lang]).length) out[`title.${lang}`] = 'A title cannot contain blanks such as {patient}.';
  }
  (form.clauses ?? []).forEach((c, i) => {
    for (const lang of LANGUAGES) {
      const unknown = blanksIn(c[lang]).filter((b) => !BLANKS.includes(b));
      if (unknown.length) {
        out[`clauses.${i}.${lang}`] = `Unknown blank {${unknown[0]}}. The blanks are: ${list}.`;
      } else if (lang !== 'en' && c[lang]?.trim() && blankSet(c[lang]) !== blankSet(c.en)) {
        const en = [...new Set(blanksIn(c.en))].map((b) => `{${b}}`).join(' ');
        out[`clauses.${i}.${lang}`] = en
          ? `Use the same blanks as the English: ${en}.`
          : 'The English has no blanks here, so the translation should have none either.';
      }
    }
  });
  return out;
}

// ---------- The printed form ----------

/** The labels printed on a consent form, in each language ("Signature / सही"). */
export const PRINT_LABELS = {
  patientName: { en: "Patient's name", mr: 'रुग्णाचे नाव', hi: 'रोगी का नाम' },
  babyName: { en: "Baby's name", mr: 'बाळाचे नाव', hi: 'शिशु का नाम' },
  mother: { en: "Mother's name", mr: 'आईचे नाव', hi: 'माँ का नाम' },
  age: { en: 'Age', mr: 'वय', hi: 'आयु' },
  patientNo: { en: 'Patient no.', mr: 'रुग्ण क्रमांक', hi: 'रोगी क्रमांक' },
  patient: { en: 'Patient', mr: 'रुग्ण', hi: 'रोगी' },
  relative: {
    en: 'If the patient is unable to sign (for example a minor, or unconscious): relative or guardian',
    mr: 'रुग्ण सही करण्यास असमर्थ असल्यास (उदा. अल्पवयीन किंवा बेशुद्ध): नातेवाईक किंवा पालक',
    hi: 'यदि रोगी हस्ताक्षर करने में असमर्थ हो (जैसे नाबालिग या बेहोश): रिश्तेदार या अभिभावक',
  },
  parent: { en: 'Parent or guardian', mr: 'आई-वडील किंवा पालक', hi: 'माता-पिता या अभिभावक' },
  witness: { en: 'Witness', mr: 'साक्षीदार', hi: 'गवाह' },
  // Information forms: the patient and her relatives sign that they were informed.
  relativeInformed: { en: 'Relative who was informed', mr: 'माहिती दिलेले नातेवाईक', hi: 'जिन रिश्तेदार को जानकारी दी गई' },
  doctorInformed: { en: 'Doctor who gave the information', mr: 'माहिती देणारे डॉक्टर', hi: 'जानकारी देने वाले डॉक्टर' },
  doctor: { en: 'Doctor who explained the form', mr: 'समजावून सांगणारे डॉक्टर', hi: 'समझाने वाले डॉक्टर' },
  interpreter: {
    en: 'Interpreter (if the form was explained in another language)',
    mr: 'दुभाषी (फॉर्म दुसऱ्या भाषेत समजावून सांगितला असल्यास)',
    hi: 'दुभाषिया (यदि फॉर्म किसी अन्य भाषा में समझाया गया हो)',
  },
  name: { en: 'Name', mr: 'नाव', hi: 'नाम' },
  relationship: { en: 'Relationship to the patient', mr: 'रुग्णाशी नाते', hi: 'रोगी से संबंध' },
  signature: { en: 'Signature', mr: 'सही', hi: 'हस्ताक्षर' },
  signatureOrThumb: { en: 'Signature or left thumb impression', mr: 'सही किंवा डाव्या अंगठ्याचा ठसा', hi: 'हस्ताक्षर या बाएँ अंगूठे का निशान' },
  dateTime: { en: 'Date and time', mr: 'दिनांक व वेळ', hi: 'दिनांक और समय' },
  language: { en: 'Language explained in', mr: 'समजावून सांगण्याची भाषा', hi: 'समझाने की भाषा' },
  regNo: { en: 'Reg. No.', mr: 'नोंदणी क्र.', hi: 'पंजीकरण सं.' },
};

/** "English / मराठी" for a label, or just the English when printing English only. */
export const bilingual = (label, lang) => (lang && lang !== 'en' && label[lang] ? [label.en, label[lang]] : [label.en]);

/** "English", "English and Marathi", "English, Marathi and Hindi" */
export const listWords = (words) => (words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);

/** Where a form's words were last changed: "Draft · v2", "Approved · v3". */
export const formStatusWord = (f) => (f.status === 'approved' ? `Approved · v${f.version}` : `Draft · v${f.version}`);

/** "For all types of care" / "Antenatal, postnatal". labels: CARE_TYPE_SHORT. */
export const careTypesText = (careTypes, labels) => (careTypes?.length ? careTypes.map((t) => labels[t] ?? t).join(', ') : 'All types of care');
