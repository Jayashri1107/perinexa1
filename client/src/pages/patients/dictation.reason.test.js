// Voice entry: the doctor says or types her name and why she came (owner's request, 14 Oct 2026). The name is filled
// in, and why she came goes to the notes. All fake sample data.
import { describe, expect, it } from 'vitest';
import { extractPatientDetails } from './dictation.js';

const now = new Date(2026, 9, 14, 11, 0); // 14 Oct 2026, 11:00
const typed = (text, careType = 'antenatal') => extractPatientDetails(text, { careType, now });
const voice = (text, careType = 'antenatal') => extractPatientDetails(text, { careType, now, words: [], voice: true });
const unused = (r) => r.unused.map((u) => u.text);

describe('name and why she came', () => {
  it('reads a name said straight before "came"', () => {
    const r = typed('Priya Sample came for pregnancy treatment');
    expect(r.values.fullName).toBe('Priya Sample');
    expect(r.values.notes).toBe('Reason for visit: pregnancy treatment');
    expect(unused(r)).toEqual([]);
  });

  it('puts "for …" at the start, or after a detail, in the notes', () => {
    expect(typed('For the pregnancy treatment').values.notes).toBe('Reason for visit: pregnancy treatment');
    const r = voice('Priya Sample 28 years for pregnancy treatment');
    expect(r.values.fullName).toBe('Priya Sample');
    expect(r.values.ageYears).toBe('28');
    expect(r.values.notes).toBe('Reason for visit: pregnancy treatment');
  });

  it('reads "came with", "c/o" and stops at the next detail', () => {
    const r = voice('Asha Sample came with pain abdomen since 2 days, G2P1, LMP 12 July 2026');
    expect(r.values.fullName).toBe('Asha Sample');
    expect(r.values.notes).toBe('Reason for visit: pain abdomen since 2 days');
    expect(r.values.pregnancy?.lmp).toBe('2026-07-12');
    expect(typed('Asha Sample age 26 c/o bleeding PV').values.notes).toBe('Reason for visit: bleeding PV');
  });

  it('leaves a plain "for" inside a finding alone', () => {
    expect(typed('fever for 2 days').values.notes).toBeUndefined();
    expect(typed('previous LSCS for CPD 3 years back').values.notes).not.toMatch(/Reason for visit/);
  });

  it('never puts the baby’s sex in the reason', () => {
    expect(voice('Asha Sample came for scan, baby is a boy').values.notes ?? '').not.toMatch(/boy/i);
    expect(voice('Asha Sample, 28 years, complains of white discharge, baby is a boy').values.notes).toBe('Reason for visit: white discharge');
    // nothing at all from a part that mentions it – not even "scan baby is a"
    for (const t of ['Asha Sample came for scan baby is a boy', 'Asha Sample came for knowing baby boy or girl', 'Asha Sample came for sex of the baby']) {
      expect(voice(t).values.notes, t).toBeUndefined();
    }
  });
});

describe('one line for a new patient (owner, 14 Oct 2026)', () => {
  it('reads a first name alone when it is written with a capital', () => {
    const r = typed('Sanjana, age 29, came here for the pregnancy checkup.');
    expect(r.values.fullName).toBe('Sanjana');
    expect(r.values.ageYears).toBe('29');
    expect(r.values.notes).toBe('Reason for visit: pregnancy checkup');
    expect(typed('Primi, age 29, came for checkup').values.fullName).toBeUndefined();
    expect(typed('pallor, age 29').values.fullName).toBeUndefined();
  });

  it('leaves out "Register" and reads "pregnant for 12 weeks" and "here for"', () => {
    const r = voice('Register Sanjana Sample, age 29, phone 9876543210, pregnant for 12 weeks, second pregnancy, previous C-section, here for an ANC checkup.');
    expect(r.values.fullName).toBe('Sanjana Sample');
    expect(r.values.phone).toBe('98765 43210');
    expect(r.values.notes).toBe('Reason for visit: ANC checkup');
    expect(r.values.obstetric?.gravida).toBe('2');
    expect(r.questions.some((q) => /LMP about/.test(q.prompt))).toBe(true); // never filled from the weeks alone
    expect(r.unused).toEqual([]);
  });
});
