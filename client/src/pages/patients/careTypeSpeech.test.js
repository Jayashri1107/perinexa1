// The type of care said aloud on the New patient chooser (16 Oct 2026). Fake sample words only.
import { describe, expect, it } from 'vitest';
import { careTypeFromSpeech, withoutCareTypeWords } from './careTypeSpeech.js';

const type = (text) => careTypeFromSpeech(text).careType;

describe('the type of care from what was said', () => {
  it('by its name', () => {
    expect(type('Antenatal patient Asha Sample age 28')).toBe('antenatal');
    expect(type('postnatal, Meena Sample')).toBe('postnatal');
    expect(type('gynae patient, white discharge')).toBe('gynaecology');
    expect(type('infertility case, trying for 3 years')).toBe('infertility');
    expect(type('newborn baby of Asha Sample')).toBe('newborn');
  });
  it('from the words that point to it', () => {
    expect(type('Asha Sample 28 years, pregnant, LMP 5 March')).toBe('antenatal');
    expect(type('Asha Sample, G2P1, 20 weeks')).toBe('antenatal');
    expect(type('Asha Sample, miscarriage at 8 weeks')).toBe('abortion');
    expect(type('Asha Sample delivered on 10 October')).toBe('postnatal');
    expect(type('Asha Sample, trying to conceive, IVF planned')).toBe('infertility');
    expect(type('Asha Sample, irregular periods')).toBe('gynaecology');
  });
  it('the name wins over a clue; a miscarriage is pregnancy loss, not antenatal', () => {
    expect(type('antenatal, IVF pregnancy')).toBe('antenatal');
    expect(type('missed abortion in this pregnancy')).toBe('abortion');
  });
  it('"not pregnant" is no clue', () => {
    expect(type('Asha Sample, not pregnant, heavy periods')).toBe('gynaecology');
  });
  it('newborn with a pregnancy type, or two names: nothing is guessed', () => {
    expect(careTypeFromSpeech('newborn, mother pregnant again')).toEqual({ careType: null, candidates: ['newborn', 'antenatal'] });
    expect(careTypeFromSpeech('antenatal or gynaecology')).toEqual({ careType: null, candidates: ['antenatal', 'gynaecology'] });
    expect(careTypeFromSpeech('Asha Sample, age 28')).toEqual({ careType: null, candidates: [] });
  });
});

describe('the type of care said first is taken off for the form', () => {
  it('only the leading type words', () => {
    expect(withoutCareTypeWords('Pregnancy, Asha Sample, age 28')).toBe('Asha Sample, age 28');
    expect(withoutCareTypeWords('Antenatal patient Asha Sample')).toBe('Asha Sample');
    expect(withoutCareTypeWords('new patient for gynaecology. Meena Sample')).toBe('Meena Sample');
    expect(withoutCareTypeWords('newborn baby of Asha Sample')).toBe('baby of Asha Sample');
    expect(withoutCareTypeWords('Asha Sample, pregnant, IVF')).toBe('Asha Sample, pregnant, IVF');
    expect(withoutCareTypeWords('pregnant, Asha Sample')).toBe('pregnant, Asha Sample');
  });
});
