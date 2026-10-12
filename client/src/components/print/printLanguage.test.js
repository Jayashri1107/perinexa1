// The language of what the patient takes home (5 Oct 2026): English only, or English with Marathi or Hindi. Fake data only.
import { describe, expect, it } from 'vitest';
import { PRINT_LANGUAGES, PRINT_LANGUAGE_BUTTONS, ageWords, bilingualWords, defaultPrintLanguage, recordedLanguage, secondLanguage } from './printLanguage.js';

describe('the language a printout for the patient opens in', () => {
  it('is the language recorded for her messages while she agrees to messages, else English', () => {
    expect(defaultPrintLanguage({ reminders: { consent: true, channel: 'sms', language: 'mr' } })).toBe('mr');
    expect(defaultPrintLanguage({ reminders: { consent: true, channel: 'whatsapp', language: 'hi' } })).toBe('hi');
    expect(defaultPrintLanguage({ reminders: { consent: true, language: 'en' } })).toBe('en');
    // "No automatic reminders": the language saved with it is one nobody chose
    expect(defaultPrintLanguage({ reminders: { consent: false, language: 'mr' } })).toBe('en');
    expect(recordedLanguage({ reminders: { consent: false, language: 'hi' } })).toBeNull();
    // Nothing recorded, or a value the app does not know
    expect(defaultPrintLanguage({ reminders: null })).toBe('en');
    expect(defaultPrintLanguage({})).toBe('en');
    expect(defaultPrintLanguage(undefined)).toBe('en');
    expect(defaultPrintLanguage({ reminders: { consent: true, language: 'gu' } })).toBe('en');
  });

  it('offers English, मराठी and हिंदी, each in its own script; English prints alone', () => {
    expect(PRINT_LANGUAGES).toEqual(['en', 'mr', 'hi']);
    expect(PRINT_LANGUAGE_BUTTONS).toEqual({ en: 'English', mr: 'मराठी', hi: 'हिंदी' });
    expect(secondLanguage('en')).toBeNull();
    expect(secondLanguage('mr')).toBe('mr');
    expect(secondLanguage('hi')).toBe('hi');
    expect(secondLanguage('gu')).toBeNull();
    const words = { en: 'Advice', mr: 'सल्ला', hi: 'सलाह' };
    expect(bilingualWords(words, 'en')).toEqual(['Advice']);
    expect(bilingualWords(words, 'mr')).toEqual(['Advice', 'सल्ला']);
    expect(bilingualWords(words, 'hi')).toEqual(['Advice', 'सलाह']);
    expect(bilingualWords({ en: 'Advice' }, 'hi')).toEqual(['Advice']);
  });
});

describe('her age in Marathi and Hindi', () => {
  const now = new Date('2026-10-05T06:00:00Z');
  it('as the record shows it in English: years for a woman, days then months for a baby', () => {
    const woman = { careType: 'antenatal', currentAge: 28 };
    expect(ageWords(woman, 'en', now)).toBe('28 yrs');
    expect(ageWords(woman, 'mr', now)).toBe('28 वर्षे');
    expect(ageWords(woman, 'hi', now)).toBe('28 वर्ष');
    const baby = (birthAt) => ({ careType: 'newborn', newborn: { birthAt } });
    expect(ageWords(baby('2026-10-05T01:00:00Z'), 'mr', now)).toBe('आज जन्म');
    expect(ageWords(baby('2026-10-04T05:00:00Z'), 'mr', now)).toBe('1 दिवसाचे');
    expect(ageWords(baby('2026-09-23T05:00:00Z'), 'mr', now)).toBe('12 दिवसांचे');
    expect(ageWords(baby('2026-09-23T05:00:00Z'), 'hi', now)).toBe('12 दिन का');
    expect(ageWords(baby('2026-06-01T05:00:00Z'), 'hi', now)).toBe('4 महीने का');
    expect(ageWords(baby('2026-06-01T05:00:00Z'), 'en', now)).toBe('4 months old');
    // Not known: nothing (the English shows its own dash)
    expect(ageWords({ careType: 'newborn', newborn: {} }, 'mr', now)).toBe('');
    expect(ageWords({ careType: 'gynaecology', currentAge: null }, 'hi', now)).toBe('');
  });
});
