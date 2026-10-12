import { describe, expect, it } from 'vitest';
import { allergyNames } from '../medsafety/medSafety.js';
import { NO_KNOWN_ALLERGIES, allergyStatus, isRhNegative } from './patientFormat.js';

describe('allergyStatus', () => {
  it('an empty note means nobody has asked yet', () => {
    expect(allergyStatus('')).toBe('not_asked');
    expect(allergyStatus('   ')).toBe('not_asked');
    expect(allergyStatus(undefined)).toBe('not_asked');
  });

  it('the usual ways of writing "no allergies" mean asked, none known', () => {
    for (const t of [NO_KNOWN_ALLERGIES, 'none known', 'Nil', 'NKDA', 'NKA', 'No allergies', 'No known drug allergies', 'none.']) {
      expect(allergyStatus(t)).toBe('none');
    }
  });

  it('anything else is a recorded allergy – including words that only start with "no"', () => {
    for (const t of ['Penicillin', 'Sulfa – rash', 'Nonsteroidal anti-inflammatories']) {
      expect(allergyStatus(t)).toBe('recorded');
    }
  });

  it('medicine safety finds no medicine names in "None known"', () => {
    expect(allergyNames(NO_KNOWN_ALLERGIES)).toEqual({ groups: [], words: [] });
    expect(allergyNames('Penicillin').groups.length).toBeGreaterThan(0);
  });
});

describe('isRhNegative', () => {
  it('is true only for a negative blood group', () => {
    expect(isRhNegative('O-')).toBe(true);
    expect(isRhNegative('AB-')).toBe(true);
    expect(isRhNegative('O+')).toBe(false);
    expect(isRhNegative('')).toBe(false);
  });
});
