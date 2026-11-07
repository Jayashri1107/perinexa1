// The nursing chart's − and + on phones (6 Nov 2026): one step from what is typed, never a value of their own
import { describe, expect, it } from 'vitest';
import { stepVital } from './AdmissionPage.jsx';

describe('a vital one step up or down', () => {
  it('moves a whole number by one', () => {
    expect(stepVital('84', 1)).toBe('85');
    expect(stepVital('98', -1)).toBe('97');
  });

  it('moves a temperature by a tenth, without floating-point noise', () => {
    expect(stepVital('98.4', 0.1)).toBe('98.5');
    expect(stepVital('99', -0.1)).toBe('98.9');
  });

  it('suggests nothing: an empty box or one that is not a number stays as it is', () => {
    expect(stepVital('', 1)).toBe('');
    expect(stepVital('  ', 0.1)).toBe('  ');
    expect(stepVital('high', 1)).toBe('high');
  });
});
