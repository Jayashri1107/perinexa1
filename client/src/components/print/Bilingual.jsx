import { PRINT_LANGUAGES, PRINT_LANGUAGE_BUTTONS, bilingualWords, secondLanguage } from './printLanguage.js';

// Printing for the patient in English with Marathi or Hindi (5 Oct 2026), in the look of the prescriptions and the
// consent forms: labels as "Advice / सल्ला", lines with the translation under the English, the Devanagari in Mukta
// (print.css: .pdoc :lang(mr), .pdoc :lang(hi)).

/** "Advice / सल्ला" – words: { en, mr, hi }; just the English for English only. */
export function BiLabel({ words, lang }) {
  const [en, other] = bilingualWords(words, lang);
  return (
    <>
      {en}
      {other && (
        <>
          {' / '}
          <span lang={secondLanguage(lang)}>{other}</span>
        </>
      )}
    </>
  );
}

/**
 * The translation of a line, on its own line under the English. Nothing for English only, without a translation,
 * or when it reads the same (a date).
 */
export function Translation({ text, english, lang, as: Tag = 'span', className = '' }) {
  const second = secondLanguage(lang);
  if (!second || !text || text === english) return null;
  return (
    <Tag className={`pdoc-block ${className}`.trim()} lang={second}>
      {text}
    </Tag>
  );
}

/**
 * The language choice in a print preview: English, मराठी or हिंदी. Marathi and Hindi print next to the English.
 * hints: lines under the choice (e.g. that the wording is a draft).
 */
export function PrintLanguageChoice({ value, onChange, hints = [] }) {
  return (
    <>
      <div className="pv-lang">
        <span id="pv-lang-label" className="pv-lang-label">
          Language for the patient
        </span>
        <div className="segmented" role="group" aria-labelledby="pv-lang-label">
          {PRINT_LANGUAGES.map((l) => (
            <button key={l} type="button" lang={l} aria-pressed={value === l} onClick={() => onChange(l)}>
              {PRINT_LANGUAGE_BUTTONS[l]}
            </button>
          ))}
        </div>
      </div>
      {hints.filter(Boolean).map((h) => (
        <p key={h} className="hint">
          {h}
        </p>
      ))}
    </>
  );
}
