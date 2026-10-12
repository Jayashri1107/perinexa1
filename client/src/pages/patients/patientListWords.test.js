// The Patients list in plain words (fake sample data).
import { describe, expect, it } from 'vitest';
import { CARE_TYPE_LABELS, NEW_PATIENT_LINKS, careNowText, sinceText } from './patientFormat.js';

describe('the Patients list in plain words', () => {
  it('says what care she is under now', () => {
    expect(careNowText({ careType: 'antenatal', gestationalAge: { weeks: 18, days: 3 } })).toBe('Pregnant · 18 w 3 d');
    expect(careNowText({ careType: 'antenatal', gestationalAge: null })).toBe('Pregnant · dates not entered');
    expect(careNowText({ careType: 'postnatal' })).toBe('After delivery');
    expect(careNowText({ careType: 'infertility' })).toBe('Fertility care');
    // Abortion care: the type of loss only for those who see the medical details (the list never sends it)
    expect(careNowText({ careType: 'abortion' })).toBe('Abortion');
    expect(careNowText({ careType: 'abortion', abortion: { lossType: 'missed' } })).toBe('Abortion · missed');
    expect(careNowText({ careType: 'abortion', abortion: null })).toBe('Abortion');
  });
  it('says how long ago', () => {
    const now = new Date(2026, 9, 10, 12); // 10 Oct 2026, local noon
    const d = (s) => `${s}T00:00:00.000Z`;
    expect(sinceText(d('2026-10-10'), now)).toBe('Today');
    expect(sinceText(d('2026-10-09'), now)).toBe('Yesterday');
    expect(sinceText(d('2026-10-07'), now)).toBe('3 days ago');
    expect(sinceText(d('2026-09-05'), now)).toBe('5 weeks ago');
    expect(sinceText(d('2026-06-10'), now)).toBe('4 months ago');
    expect(sinceText(null, now)).toBe('');
  });
});

describe('the New patient menu', () => {
  it('lists Abortion (pregnancy loss) between Gynaecology and Newborn', () => {
    expect(NEW_PATIENT_LINKS.map((l) => l.to.split('/').pop())).toEqual(['antenatal', 'postnatal', 'infertility', 'gynaecology', 'abortion', 'newborn']);
    expect(CARE_TYPE_LABELS.abortion).toBe('Abortion (pregnancy loss)');
    expect(JSON.stringify(NEW_PATIENT_LINKS)).not.toMatch(/MTP|terminat/i);
  });
});
