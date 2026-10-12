// The words of a consent form: which blanks it may use, and which languages are complete. Shared by the
// consent-form library (routes/consentForms.js) and printing for a patient (routes/patientConsents.js).
// The website has the same rules (client/src/pages/consents/consentFormat.js).

/** Blanks filled in when a form is printed for a patient. procedure, reason and condition are typed by the doctor. */
export const BLANKS = ['patient', 'age', 'mrn', 'hospital', 'doctor', 'procedure', 'reason', 'condition'];
/** Blanks the doctor types when printing (everything else comes from the record). */
export const TYPED_BLANKS = ['procedure', 'reason', 'condition'];

/** English is always printed; Marathi or Hindi is printed next to it. */
export const CONSENT_LANGUAGES = ['en', 'mr', 'hi'];
export const SECOND_LANGUAGES = ['mr', 'hi'];
export const LANGUAGE_NAMES = { en: 'English', mr: 'Marathi', hi: 'Hindi' };

const BLANK = /\{([^{}\s]*)\}/g;

/** The blanks written in a text, e.g. ['patient', 'mrn'] (unknown ones too, so they can be reported). */
export const blanksIn = (text) => [...String(text ?? '').matchAll(BLANK)].map((m) => m[1]);
const blankSet = (text) => [...new Set(blanksIn(text))].sort().join(',');

/** Every blank the form's English clauses use (a Set). */
export const formBlanks = (form) => new Set((form.clauses ?? []).flatMap((c) => blanksIn(c.en)).filter((b) => BLANKS.includes(b)));

/** A language is complete when the title and every clause have text in it. */
export const isComplete = (form, lang) => Boolean(form.title?.[lang]?.trim()) && (form.clauses ?? []).length > 0 && form.clauses.every((c) => c[lang]?.trim());

/** The languages a form can be printed in: ['en', 'mr', 'hi'] or fewer. English is always there. */
export const languagesOf = (form) => CONSENT_LANGUAGES.filter((l) => l === 'en' || isComplete(form, l));

/**
 * Problems with a form's words, as { path: message } (paths as the website sends them, e.g. "clauses.2.mr"):
 * unknown blanks, blanks in a title, and translations that don't use the same blanks as the English.
 */
export function blankProblems(form) {
  const out = {};
  const list = BLANKS.map((b) => `{${b}}`).join(' ');
  for (const lang of CONSENT_LANGUAGES) {
    if (blanksIn(form.title?.[lang]).length) out[`title.${lang}`] = 'A title cannot contain blanks such as {patient}.';
  }
  (form.clauses ?? []).forEach((c, i) => {
    for (const lang of CONSENT_LANGUAGES) {
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
