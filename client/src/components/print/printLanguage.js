// The language of a printout the patient herself takes home – the patient copy of the care plan and the discharge
// card (5 Oct 2026): English only, or English with Marathi or Hindi next to it, as on the prescriptions and the
// consent forms. Staff copies stay in English. Pure.
//
// ⚠️ DRAFT – the Marathi and Hindi words in this file must be checked by fluent speakers before they are used with
// patients (listed in docs/TRANSLATIONS_TO_CHECK.md).

export const PRINT_LANGUAGES = ['en', 'mr', 'hi'];
/** The choice in the print preview, each language in its own script. */
export const PRINT_LANGUAGE_BUTTONS = { en: 'English', mr: 'मराठी', hi: 'हिंदी' };

/**
 * The language recorded for her messages (Patient → Reminders and portal), or null. Only while she agrees to
 * messages: with "No automatic reminders" the dialog still saves the (hidden) language box, which nobody chose.
 */
export function recordedLanguage(patient) {
  const r = patient?.reminders;
  return r?.consent === true && PRINT_LANGUAGES.includes(r.language) ? r.language : null;
}

/** The language a patient's printout opens in: the language recorded for her messages, if there is one, else English. */
export const defaultPrintLanguage = (patient) => recordedLanguage(patient) ?? 'en';

/** The language printed next to the English, or null for English only. */
export const secondLanguage = (lang) => (lang === 'mr' || lang === 'hi' ? lang : null);

/** Under the language choice while Marathi or Hindi is chosen (the same words as for reminders). */
export const DRAFT_TRANSLATION_HINT = 'The Marathi and Hindi wording is a draft – have it checked by a fluent speaker before using it with patients.';

/** A label in English with its translation after it: ["Advice", "सल्ला"], or just ["Advice"] for English only. */
export const bilingualWords = (words, lang) => {
  const second = secondLanguage(lang);
  return second && words?.[second] ? [words.en, words[second]] : [words.en];
};

const DAY = 24 * 60 * 60 * 1000;
const AGE_WORDS = {
  en: { years: (n) => `${n} yrs`, today: 'Born today', days: (n) => `${n} day${n === 1 ? '' : 's'} old`, months: (n) => `${n} month${n === 1 ? '' : 's'} old` },
  mr: { years: (n) => `${n} वर्षे`, today: 'आज जन्म', days: (n) => `${n} ${n === 1 ? 'दिवसाचे' : 'दिवसांचे'}`, months: (n) => `${n} ${n === 1 ? 'महिन्याचे' : 'महिन्यांचे'}` },
  hi: { years: (n) => `${n} वर्ष`, today: 'आज जन्म', days: (n) => `${n} दिन का`, months: (n) => `${n} महीने का` },
};

/**
 * Her age in a language, as the record shows it in English (patientFormat.js ageText): "28 yrs" / "28 वर्षे" /
 * "28 वर्ष"; a baby "12 days old" / "12 दिवसांचे" / "12 दिन का", in months from 60 days. '' when not known.
 */
export function ageWords(patient, lang = 'en', now = new Date()) {
  const w = AGE_WORDS[lang] ?? AGE_WORDS.en;
  if (patient?.careType === 'newborn') {
    const birthAt = patient.newborn?.birthAt;
    if (!birthAt) return '';
    const days = Math.floor((now - new Date(birthAt)) / DAY);
    if (days < 1) return w.today;
    if (days < 60) return w.days(days);
    return w.months(Math.floor(days / 30.44));
  }
  return patient?.currentAge != null ? w.years(patient.currentAge) : '';
}
