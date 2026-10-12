// The words given to Chrome's speech recognition so it hears them better (all fake sample data).
import { describe, expect, it } from 'vitest';
import { mentionsFetalSex } from '../../pcpndtWords.js';
import { hearingPhrases, isBlockedLearned } from './obgyTerms.js';
import { CARE_TYPES } from './patientFormat.js';

const boostOf = (list, text) => list.find((p) => p.text.toLowerCase() === text.toLowerCase())?.boost;

describe('hearingPhrases', () => {
  it.each(CARE_TYPES)('%s: at most 212 phrases, each once, boosts within 0–10', (careType) => {
    const list = hearingPhrases(careType, []);
    expect(list.length).toBeGreaterThan(20);
    expect(list.length).toBeLessThanOrEqual(212);
    const keys = list.map((p) => p.text.toLowerCase().replace(/[\s-]+/g, ' '));
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of list) expect(p.boost).toBeGreaterThanOrEqual(0);
    for (const p of list) expect(p.boost).toBeLessThanOrEqual(10);
  });

  it.each(CARE_TYPES)('%s: opposite results and all 8 blood groups get the same boost', (careType) => {
    const list = hearingPhrases(careType, [{ phrase: 'b positive', meaning: 'note:x' }]);
    const groups = ['A', 'B', 'AB', 'O'].flatMap((g) => [`${g} positive`, `${g} negative`]).map((t) => boostOf(list, t));
    expect(groups.every((b) => b !== undefined && b === groups[0])).toBe(true);
    expect(boostOf(list, 'positive')).toBe(boostOf(list, 'negative'));
    expect(boostOf(list, 'Rh positive')).toBe(boostOf(list, 'Rh negative'));
    expect(boostOf(list, 'Rh positive')).toBeDefined();
    if (careType !== 'newborn') {
      expect(boostOf(list, 'reactive')).toBeDefined();
      expect(boostOf(list, 'reactive')).toBe(boostOf(list, 'non-reactive'));
      expect(boostOf(list, 'HIV')).toBeLessThanOrEqual(1.5);
      expect(boostOf(list, 'eclampsia')).toBeLessThanOrEqual(1.5);
    }
  });

  it.each(CARE_TYPES)('%s: no 2-letter short forms and no letters with spaces', (careType) => {
    const texts = hearingPhrases(careType, [{ phrase: 'bp', meaning: 'condition:hypertension' }, { phrase: 'l s c s', meaning: 'note:x' }]).map((p) => p.text);
    for (const t of ['TB', 'BP', 'HB', 'Hb', 'DM', 'bp', 'l s c s']) expect(texts).not.toContain(t);
    expect(texts.filter((t) => t.replace(/[\s.-]/g, '').length <= 2)).toEqual([]);
  });

  it('never gives Chrome a word about the baby\'s sex in antenatal care (PCPNDT)', () => {
    const texts = hearingPhrases('antenatal', [
      { phrase: 'ladka', meaning: 'note:x' },
      { phrase: 'baby girl', meaning: 'note:x' },
      { phrase: 'beta', meaning: 'note:x' },
    ]).map((p) => p.text);
    for (const t of texts) {
      expect(mentionsFetalSex(t)).toBe(false);
      expect(t).not.toMatch(/\b(?:boy|girl|male|female|ladka|ladki|beta|beti)\b/i);
    }
  });

  it('only words for this type of care', () => {
    const antenatal = hearingPhrases('antenatal').map((p) => p.text);
    for (const t of ['baby of', 'time of birth', 'birth weight', 'FTND', 'episiotomy', 'forceps']) expect(antenatal).not.toContain(t);
    expect(antenatal).toContain('breech');
    const newborn = hearingPhrases('newborn').map((p) => p.text);
    expect(newborn).toContain('baby of');
    for (const t of ['LSCS', 'asthma', 'HIV', 'reactive', 'breech']) expect(newborn).not.toContain(t);
    const gynaecology = hearingPhrases('gynaecology').map((p) => p.text);
    for (const t of ['breech', 'twins', 'FTND', 'EDD']) expect(gynaecology).not.toContain(t);
    expect(hearingPhrases('postnatal').map((p) => p.text)).toContain('FTND');
  });

  it("puts the doctor's own words first, without settings or blocked words", () => {
    const list = hearingPhrases('antenatal', [
      { phrase: 'else cs', meaning: 'note:x' },
      { phrase: 'edd', meaning: 'scanedd' },
      { phrase: 'none', meaning: 'ignore' },
      { phrase: 'non reactive', meaning: 'note:x' },
      { phrase: 'g 2', meaning: 'note:x' },
    ]);
    expect(list[0]).toEqual({ text: 'else cs', boost: 2.5 });
    const texts = list.map((p) => p.text);
    for (const t of ['edd', 'none', 'non reactive', 'g 2']) expect(texts).not.toContain(t);
    expect(boostOf(list, 'LSCS')).toBe(2);
    expect(boostOf(list, 'para')).toBe(1.5);
  });

  it('never boosts a learned word that sounds like a result or a "no", so opposite results stay equal', () => {
    const learned = ['nonreactive', 'neg', 'hiv neg', 'vdrl nr', 'o+ve', 'rhnegative', 'hbs ag', 'nahi', 'posetive', 'sizerian', 'sunil'];
    const list = hearingPhrases('antenatal', learned.map((phrase) => ({ phrase, meaning: 'note:x' })));
    const boosted = list.filter((p) => p.boost === 2.5).map((p) => p.text);
    expect(boosted).toEqual(['sizerian', 'sunil']);
    for (const t of ['reactive', 'non-reactive', 'positive', 'negative', 'Rh positive', 'Rh negative', 'HBsAg']) expect(boostOf(list, t)).toBe(1.2);
    for (const g of ['A', 'B', 'AB', 'O']) for (const r of ['positive', 'negative']) expect(boostOf(list, `${g} ${r}`)).toBe(1.2);
  });

  // 50 fake learned words: the most a doctor's own words can take up
  const manyWords = Array.from({ length: 50 }, (_, i) => ({ phrase: `sampleword${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`, meaning: 'note:x' }));
  describe.each([
    ['no learned words', []],
    ['50 learned words', manyWords],
  ])('the cap keeps the key words (%s)', (_, words) => {
    it.each(['antenatal', 'postnatal'])('%s', (careType) => {
      const list = hearingPhrases(careType, words);
      expect(list).toHaveLength(212);
      const texts = list.map((p) => p.text);
      for (const t of ['known case of', 'history of', 'allergic to', 'pre-eclampsia', 'tuberculosis', 'previous LSCS', 'OGTT']) expect(texts).toContain(t);
      if (careType === 'antenatal') for (const t of ['placenta praevia', 'oligohydramnios', 'NT scan', 'anomaly scan']) expect(texts).toContain(t);
      // The Hindi words have their own room: they never push out a medical word
      for (const t of ['naam', 'saal', 'pehli', 'pachees', 'haan']) expect(texts).toContain(t);
      if (careType === 'postnatal' && !words.length) expect(texts).toContain('anti-D given');
      expect(boostOf(list, 'reactive')).toBe(1.2);
      expect(boostOf(list, 'non-reactive')).toBe(1.2);
      expect(boostOf(list, 'Rh positive')).toBe(1.2);
      expect(boostOf(list, 'Rh negative')).toBe(1.2);
      expect(boostOf(list, 'previous LSCS')).toBe(1.5);
    });
  });

  it('blocks learned phrases that change a result or a "no"', () => {
    for (const p of ['no', 'not', 'nil', 'known', 'on', 'positive', 'negative', 'reactive', 'sorry', 'none reactive', 'g 2', 'no.', 'known.', 'no/nil', 'non/reactive', "non'reactive"]) {
      expect(isBlockedLearned(p), p).toBe(true);
    }
    for (const p of ['else cs', 'pcod', 'sizerian', 'height n.n', 'b rh', 'nonie', 'ontario']) expect(isBlockedLearned(p), p).toBe(false);
  });
});
