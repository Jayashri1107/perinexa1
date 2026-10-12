// Words for consent forms (fake sample data only).
import { describe, expect, it } from 'vitest';
import {
  BLANKS,
  BLANK_LABELS,
  LANGUAGES,
  PRINT_LABELS,
  PRINT_LANGUAGES,
  SUGGEST_LABELS,
  SUGGEST_WHY,
  bilingual,
  blankProblems,
  careTypesText,
  formBlanks,
  languagesOf,
  listWords,
  printLanguageLabel,
  textParts,
} from './consentFormat.js';

const form = (clauses, title = { en: 'Consent', mr: 'संमती', hi: 'सहमति' }) => ({ title, clauses });

describe('blanks', () => {
  it('split a clause into words and blanks', () => {
    expect(textParts('I, {patient} (patient no. {mrn}), consent to {procedure}.')).toEqual([
      { text: 'I, ' },
      { blank: 'patient' },
      { text: ' (patient no. ' },
      { blank: 'mrn' },
      { text: '), consent to ' },
      { blank: 'procedure' },
      { text: '.' },
    ]);
    expect(textParts('Unknown {thing} stays')).toEqual([{ text: 'Unknown ' }, { text: '{thing}' }, { text: ' stays' }]);
    expect(textParts('')).toEqual([]);
  });

  it('are the same in every language, and only the known ones', () => {
    const ok = form([{ en: 'I, {patient}, agree: {reason}.', mr: 'मी, {patient}, … {reason}.', hi: '' }]);
    expect(blankProblems(ok)).toEqual({});
    const bad = form(
      [
        { en: 'I, {patient}, agree to {operation}.', mr: 'मी सहमत आहे.', hi: 'मैं, {patient}, {reason}.' },
        { en: 'No blanks here.', mr: 'येथे {patient}.', hi: '' },
      ],
      { en: 'Consent for {patient}', mr: '', hi: '' },
    );
    const problems = blankProblems(bad);
    expect(problems['title.en']).toMatch(/cannot contain blanks/);
    expect(problems['clauses.0.en']).toMatch(/Unknown blank \{operation\}/);
    expect(problems['clauses.0.mr']).toMatch(/same blanks as the English: \{patient\} \{operation\}/);
    expect(problems['clauses.0.hi']).toMatch(/same blanks as the English/);
    expect(problems['clauses.1.mr']).toMatch(/should have none either/);
    expect(formBlanks(bad)).toEqual(new Set(['patient']));
  });

  it('each have words for the editor and the form page', () => {
    for (const b of BLANKS) expect(BLANK_LABELS[b]).toBeTruthy();
  });
});

describe('languages', () => {
  it('are complete only with the title and every clause', () => {
    const f = form([
      { en: 'One', mr: 'एक', hi: 'एक' },
      { en: 'Two', mr: 'दोन', hi: '' },
    ]);
    expect(languagesOf(f)).toEqual(['en', 'mr']);
    expect(languagesOf({ ...f, title: { en: 'Consent', mr: '', hi: 'सहमति' } })).toEqual(['en']);
    expect(PRINT_LANGUAGES.map((l) => l.key)).toEqual(['mr', 'hi', 'en']);
    expect(printLanguageLabel('mr')).toBe('English + मराठी (Marathi)');
  });

  it('print every label in English, Marathi and Hindi', () => {
    for (const [key, label] of Object.entries(PRINT_LABELS)) {
      for (const lang of LANGUAGES) expect(label[lang]?.trim(), `${key}.${lang}`).toBeTruthy();
    }
    expect(bilingual(PRINT_LABELS.signature, 'mr')).toEqual(['Signature', 'सही']);
    expect(bilingual(PRINT_LABELS.signature, 'en')).toEqual(['Signature']);
  });
});

describe('suggestions and lists', () => {
  it('have words for every rule', () => {
    for (const rule of Object.keys(SUGGEST_LABELS).filter((r) => r !== 'none')) expect(SUGGEST_WHY[rule], rule).toBeTruthy();
    expect(careTypesText([], {})).toBe('All types of care');
    expect(listWords(['English', 'Marathi', 'Hindi'])).toBe('English, Marathi and Hindi');
    expect(listWords(['English'])).toBe('English');
    expect(careTypesText(['antenatal', 'postnatal'], { antenatal: 'Antenatal', postnatal: 'Postnatal' })).toBe('Antenatal, Postnatal');
  });
});

describe('information forms by stage of care', () => {
  it('lists each built-in sheet under its stage, the general sheet and the hospital\'s own under Other', async () => {
    const { infoStage } = await import('./consentFormat.js');
    expect(infoStage({ key: 'info_ectopic', origin: 'built_in' })).toBe('Early pregnancy');
    expect(infoStage({ key: 'info_hypertension', origin: 'built_in' })).toBe('Pregnancy');
    expect(infoStage({ key: 'info_fetal_distress', origin: 'built_in' })).toBe('Labour');
    expect(infoStage({ key: 'info_pph', origin: 'built_in' })).toBe('After delivery');
    expect(infoStage({ key: 'info_condition', origin: 'built_in' })).toBe('Other');
    expect(infoStage({ key: 'form_1a2b3c4d', origin: 'hospital' })).toBe('Other');
  });
});
