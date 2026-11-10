// The history-taking sheet: a dictated sentence read into the five blanks, and what is sent (fake sample data).
import { describe, expect, it } from 'vitest';
import { EMPTY_PREGNANCY, historyEmpty, historyLines, historyPayload, historyPrintLines, historyValues, readCareLine, readSentence, withHistorySheet } from './historyFormat.js';
import { extractPatientDetails, mergeDictated, readDate } from './dictation.js';

describe('reading the sentence as written on the paper template', () => {
  it('fills each blank from the words that follow its anchor', () => {
    const said =
      'Patient is 28 years with complaints of pain in lower abdomen since 3 days. Menstrual history LMP 2 October cycle regular. ' +
      'Obstetric history married since 4 years non consanguineous. Previous deliveries one full term normal delivery in 2023, 2.9 kg, alive and well. ' +
      'Any other personal, medical, operative or family history appendix operation in 2015';
    expect(readSentence(said)).toEqual({
      complaint: 'pain in lower abdomen since 3 days',
      cycle: 'regular',
      marriedSinceYears: '4',
      consanguinity: 'no',
      previousDeliveries: 'one full term normal delivery in 2023, 2.9 kg, alive and well',
      otherHistory: 'appendix operation in 2015',
    });
  });
  it('fills only what it is sure of', () => {
    expect(readSentence('Married since five years, consanguinity yes')).toEqual({ marriedSinceYears: '5', consanguinity: 'yes' });
    expect(readSentence('LMP 3 October, irregular cycles')).toEqual({ cycle: 'irregular' });
    expect(readSentence('')).toEqual({});
    expect(readSentence('she is well')).toEqual({});
  });
  it('takes the complaint from the words doctors say instead of the template’s, and stops before advice (10 Nov 2026)', () => {
    expect(readSentence('Came first time with PV bleeding since morning. Advise sonography.')).toEqual({ complaint: 'PV bleeding since morning' });
    expect(readSentence('Came 1st time with PV bleeding since morning advised sonography')).toEqual({ complaint: 'PV bleeding since morning' });
    expect(readSentence('C/O white discharge for one week')).toEqual({ complaint: 'white discharge for one week' });
    expect(readSentence('Chief complaint is pain in abdomen. LMP 2 October cycle regular')).toEqual({ complaint: 'pain in abdomen', cycle: 'regular' });
    expect(readSentence('She presented with headache and swelling of feet')).toEqual({ complaint: 'headache and swelling of feet' });
  });
  it('fills previous deliveries from the other ways of saying it (10 Nov 2026)', () => {
    expect(readSentence('Previous delivery one normal delivery in 2021')).toEqual({ previousDeliveries: 'one normal delivery in 2021' });
    expect(readSentence('Previously delivered twice, both normal')).toEqual({ previousDeliveries: 'twice, both normal' });
    expect(readSentence('Past deliveries two caesareans')).toEqual({ previousDeliveries: 'two caesareans' });
    expect(readSentence('Previous LSCS in 2020 for breech. Any other history nil')).toEqual({ previousDeliveries: 'LSCS in 2020 for breech', otherHistory: 'nil' });
  });
});

describe("the type of care's own line", () => {
  const now = new Date(2026, 9, 28);
  it('reads how long she has been trying to conceive, in months, for infertility only', () => {
    expect(readCareLine('Trying to conceive since 3 years. Any other history nil', 'infertility', readDate, now)).toEqual({ durationMonths: '36' });
    expect(readCareLine('trying to conceive for eighteen months', 'infertility', readDate, now)).toEqual({});
    expect(readCareLine('trying to conceive since 18 months', 'infertility', readDate, now)).toEqual({ durationMonths: '18' });
    expect(readCareLine('trying to conceive since 3 years', 'antenatal', readDate, now)).toEqual({});
  });
  it('reads the date and the mode of delivery, for postnatal care only', () => {
    expect(readCareLine('Delivered on 20 October 2026 by caesarean. Previous deliveries nil', 'postnatal', readDate, now)).toEqual({ on: '2026-10-20', mode: 'lscs' });
    expect(readCareLine('delivered on 2 10 2026 by normal delivery', 'postnatal', readDate, now)).toEqual({ on: '2026-10-02', mode: 'normal' });
    expect(readCareLine('delivered on 20 October 2026', 'postnatal', readDate, now)).toEqual({ on: '2026-10-20' });
    expect(readCareLine('delivered on 20 October 2026 by caesarean', 'antenatal', readDate, now)).toEqual({});
  });
  it('ends the blank before it at its words', () => {
    expect(readSentence('Any other history thyroid on treatment. Trying to conceive since 3 years', { careType: 'infertility' })).toEqual({ otherHistory: 'thyroid on treatment' });
    expect(readSentence('Previous deliveries nil. Delivered on 20 October by caesarean', { careType: 'postnatal' })).toEqual({ previousDeliveries: 'nil' });
  });
});

describe('one Dictate for the whole page', () => {
  const now = new Date(2026, 9, 28);
  const said =
    'Patient is 28 years with complaints of mild backache for one week. LMP 12 July 2026, cycle regular. G2 P1 L1 A0. ' +
    'Married since 4 years, non-consanguineous. Previous deliveries one full term normal delivery in 2023. Any other history allergic to penicillin';
  it("fills the sheet's blanks and the voice entry's details (LMP, G P L A, allergies) from the same sentence", () => {
    const r = withHistorySheet(extractPatientDetails(said, { careType: 'antenatal', now }), said, { careType: 'antenatal', readDate, now });
    expect(r.values.history).toMatchObject({ complaint: 'mild backache for one week', cycle: 'regular', marriedSinceYears: '4', consanguinity: 'no', previousDeliveries: 'one full term normal delivery in 2023' });
    expect(r.values.pregnancy.lmp).toBe('2026-07-12');
    expect(r.values.obstetric).toMatchObject({ gravida: '2', para: '1', living: '1', abortions: '0' });
    expect(r.values.medical.allergies).toMatch(/penicillin/i);
    expect(r.paths).toEqual(expect.arrayContaining(['history.complaint', 'history.cycle', 'pregnancy.lmp', 'obstetric.gravida', 'medical.allergies']));
    expect(r.found.find((f) => f.path === 'history.cycle')).toMatchObject({ label: 'Cycle', text: 'Regular', part: 'clinical' });
    // What the sheet took is not offered again as "not understood"
    expect(r.unused.some((u) => /backache/i.test(u.text))).toBe(false);
  });
  it('fills C/o and previous deliveries from the way doctors say it, and asks only about the advice (tablet test, 10 Nov 2026)', () => {
    const spoken = 'Came first time with PV bleeding since morning. Advise sonography. Previous delivery one normal delivery in 2021.';
    const r = withHistorySheet(extractPatientDetails(spoken, { careType: 'gynaecology', now }), spoken, { careType: 'gynaecology', readDate, now });
    expect(r.values.history).toMatchObject({ complaint: 'PV bleeding since morning', previousDeliveries: 'one normal delivery in 2021' });
    expect(r.paths).toEqual(expect.arrayContaining(['history.complaint', 'history.previousDeliveries']));
    // "Previous delivery" is the blank's heading, not something to ask about; the advice is offered for the notes
    expect(r.unused.map((u) => u.text)).toEqual(['Advise sonography']);
    const twice = 'C/O white discharge for one week. Previously delivered twice, both normal.';
    expect(withHistorySheet(extractPatientDetails(twice, { careType: 'antenatal', now }), twice, { careType: 'antenatal', readDate, now }).unused).toEqual([]);
  });
  it('writes the complaint once: in "complaints of", not again as "Reason for visit" in the notes; other notes stay', () => {
    const read = (said, careType = 'gynaecology') => withHistorySheet(extractPatientDetails(said, { careType, now }), said, { careType, readDate, now });
    const a = read('C/O white discharge for one week. Previously delivered twice, both normal.');
    expect(a.values.history.complaint).toBe('white discharge for one week');
    expect(a.values.notes).toBeUndefined();
    expect(a.paths).not.toContain('notes');
    expect(a.found.some((f) => f.path === 'notes')).toBe(false);
    const b = read('Patient is 35 years with complaints of pain in abdomen. Previous LSCS in 2020 for breech.', 'antenatal');
    expect(b.values.notes).toBe('Breech presentation');
  });
  it("adds the type of care's line only when it is on the page", () => {
    const text = 'Trying to conceive since 2 years';
    const base = extractPatientDetails(text, { careType: 'infertility', now });
    expect(withHistorySheet(base, text, { careType: 'infertility', careLine: true, readDate, now }).values.fertility).toEqual({ durationMonths: '24' });
    expect(withHistorySheet(base, text, { careType: 'infertility', careLine: false, readDate, now }).values.fertility).toBeUndefined();
  });
  it("puts the blanks into the form without changing the form's earlier values", () => {
    const v = { notes: '', newborn: {}, pregnancy: {}, abortion: {}, obstetric: {}, medical: {}, history: historyValues(null), fertility: { durationMonths: '' } };
    const r = withHistorySheet(extractPatientDetails('Married since 4 years. Trying to conceive since 1 year', { careType: 'infertility', now }), 'Married since 4 years. Trying to conceive since 1 year', { careType: 'infertility', careLine: true, readDate, now });
    const out = mergeDictated(v, r.values, r.paths);
    expect(out.history.marriedSinceYears).toBe('4');
    expect(out.fertility.durationMonths).toBe('12');
    expect(v.history.marriedSinceYears).toBe('');
    expect(v.fertility.durationMonths).toBe('');
  });
});

describe('the sheet sent and shown', () => {
  it('sends numbers, trimmed text and only the rows written', () => {
    const v = { ...historyValues(null), complaint: '  pain  ', marriedSinceYears: '4', family: ['diabetes'], pregnancies: [{ ...EMPTY_PREGNANCY, year: '2023', outcome: 'live_birth' }, { ...EMPTY_PREGNANCY }] };
    const out = historyPayload(v);
    expect(out).toMatchObject({ complaint: 'pain', marriedSinceYears: 4, menarcheAge: null, family: ['diabetes'], previousPeriod: null });
    expect(out.pregnancies).toEqual([{ year: 2023, outcome: 'live_birth', weeks: null, mode: '', place: '', weightGrams: null, aliveNow: '', problems: '' }]);
  });
  it('shows the lines written, in the paper order', () => {
    expect(historyLines({ complaint: 'Pain', cycle: 'regular', marriedSinceYears: 4, consanguinity: 'no', family: ['thyroid'], familyWho: 'Mother' })).toEqual([
      ['Complaints', 'Pain'],
      ['Menstrual history', 'Cycle regular'],
      ['Married since', '4 years · Consanguinity no'],
      ['Family history', 'Thyroid disease – Mother'],
    ]);
    expect(historyEmpty(historyPayload(historyValues(null)))).toBe(true);
  });
});

describe('the history on the printed page', () => {
  it('reads like the paper template, only the lines written', () => {
    expect(historyPrintLines({ complaint: 'pain for 3 days', cycle: 'regular', marriedSinceYears: 4, consanguinity: 'no', previousDeliveries: 'one normal delivery in 2023' }, { age: '28 yrs', lmp: '2 Oct 2026' })).toEqual([
      'Patient is 28 years with complaints of pain for 3 days',
      'Menstrual history – LMP 2 Oct 2026 · Cycle regular',
      'Obstetric history – Married since 4 years · Consanguinity no',
      'Previous deliveries – one normal delivery in 2023',
    ]);
    expect(historyPrintLines(null)).toEqual([]);
    expect(historyPrintLines({ complaint: ' ' })).toEqual([]);
  });
});
