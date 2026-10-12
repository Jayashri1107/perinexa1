// The Marathi and Hindi wording of the built-in care-plan items: used only while the English is still the built-in
// one. (A server test checks the list against the built-in templates themselves.) Fake data only.
import { describe, expect, it } from 'vitest';
import { ITEM_LANGUAGES, ITEM_TRANSLATIONS, planItemText, portalItemTranslation, translatedItemText } from './itemTranslations.js';

const DEVANAGARI = /[ऀ-ॿ]/;

describe('the Marathi and Hindi wording of the built-in items', () => {
  it('has both languages for every item, written in Devanagari, and never the English left as it is', () => {
    expect(Object.keys(ITEM_TRANSLATIONS).length).toBeGreaterThan(90);
    for (const [key, t] of Object.entries(ITEM_TRANSLATIONS)) {
      expect(Object.keys(t).sort(), key).toEqual(['en', 'hi', 'mr']);
      for (const lang of ITEM_LANGUAGES) {
        expect(t[lang].trim(), `${key}.${lang}`).toBe(t[lang]);
        expect(t[lang], `${key}.${lang}`).toMatch(DEVANAGARI);
        expect(t[lang], `${key}.${lang}`).not.toBe(t.en);
      }
      // The numbers of the English (weeks, months, doses, days) are all in the translation, in figures
      const numbers = (s) => (s.match(/\d+/g) ?? []).sort();
      for (const lang of ITEM_LANGUAGES) expect(numbers(t[lang]), `${key}.${lang}`).toEqual(numbers(t.en));
    }
  });

  it('is used only while the English wording is word for word the built-in one', () => {
    expect(translatedItemText({ key: 'lab_urine', text: 'Urine test' }, 'mr')).toBe('लघवीची तपासणी');
    expect(translatedItemText({ key: 'lab_urine', text: 'Urine test' }, 'hi')).toBe('पेशाब की जाँच');
    // A doctor changed the wording: printed as typed
    expect(translatedItemText({ key: 'lab_urine', text: 'Urine test (bring a morning sample)' }, 'mr')).toBeNull();
    expect(translatedItemText({ key: 'lab_urine', text: 'urine test' }, 'mr')).toBeNull();
    expect(translatedItemText({ key: 'lab_urine', text: 'Urine test ' }, 'mr')).toBeNull();
    // English, an unknown language, no key, an unknown key, or a key from the object's own prototype
    expect(translatedItemText({ key: 'lab_urine', text: 'Urine test' }, 'en')).toBeNull();
    expect(translatedItemText({ key: 'lab_urine', text: 'Urine test' }, 'gu')).toBeNull();
    expect(translatedItemText({ key: null, text: 'Urine test' }, 'mr')).toBeNull();
    expect(translatedItemText({ key: 'custom_1a2b3c4d', text: 'Urine test' }, 'mr')).toBeNull();
    expect(translatedItemText({ key: 'toString', text: 'Urine test' }, 'mr')).toBeNull();
    expect(translatedItemText({ key: 'lab_urine' }, 'mr')).toBeNull();
  });

  it('on a plan: only a template item, by its patient wording (never its staff name)', () => {
    const builtIn = { key: 'scan_anomaly', origin: 'template', name: 'Anomaly scan (TIFFA)', patientText: 'Detailed ultrasound of baby (18–20 weeks)' };
    expect(planItemText(builtIn, 'mr')).toBe('बाळाची सविस्तर सोनोग्राफी (18–20 आठवडे)');
    expect(planItemText(builtIn, 'hi')).toBe('शिशु की विस्तृत सोनोग्राफ़ी (18–20 हफ़्ते)');
    // An item a doctor added to the plan, with the same words: as typed
    expect(planItemText({ ...builtIn, key: 'custom_0a0b0c0d', origin: 'custom' }, 'mr')).toBeNull();
    expect(planItemText({ ...builtIn, origin: 'custom' }, 'mr')).toBeNull();
    // No patient wording (the printout then shows the staff name): never translated
    expect(planItemText({ ...builtIn, patientText: '' }, 'mr')).toBeNull();
    expect(planItemText(undefined, 'mr')).toBeNull();
  });
});

describe('in the patient portal (never sent an item key)', () => {
  it('translates a built-in item by its exact English wording; an item a doctor added is shown as typed', () => {
    expect(portalItemTranslation({ builtIn: true, text: 'Blood group test' }, 'mr')).toBe('रक्तगटाची तपासणी');
    expect(portalItemTranslation({ builtIn: true, text: 'Blood group test' }, 'hi')).toBe('ब्लड ग्रुप की जाँच');
    // Added by a doctor with the same words, from an older server (no flag), reworded, English, or not a built-in wording
    expect(portalItemTranslation({ builtIn: false, text: 'Blood group test' }, 'mr')).toBeNull();
    expect(portalItemTranslation({ text: 'Blood group test' }, 'mr')).toBeNull();
    expect(portalItemTranslation({ builtIn: 'true', text: 'Blood group test' }, 'mr')).toBeNull();
    expect(portalItemTranslation({ builtIn: true, text: 'Blood group test – fasting' }, 'mr')).toBeNull();
    expect(portalItemTranslation({ builtIn: true, text: 'Blood group test' }, 'en')).toBeNull();
    expect(portalItemTranslation({ builtIn: true, text: 'Sample wording typed in a hospital template' }, 'hi')).toBeNull();
    expect(portalItemTranslation({ builtIn: true, text: 'toString' }, 'hi')).toBeNull();
    expect(portalItemTranslation(null, 'hi')).toBeNull();
  });

  it('every built-in English wording is different, so the wording alone finds its line', () => {
    const english = Object.values(ITEM_TRANSLATIONS).map((t) => t.en);
    expect(new Set(english).size).toBe(english.length);
    for (const [key, t] of Object.entries(ITEM_TRANSLATIONS)) {
      for (const lang of ITEM_LANGUAGES) expect(portalItemTranslation({ builtIn: true, text: t.en }, lang), key).toBe(t[lang]);
    }
  });
});
