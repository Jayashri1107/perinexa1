// The history-taking sheet: a dictated sentence read into the five blanks, and what is sent (fake sample data).
import { describe, expect, it } from 'vitest';
import { EMPTY_PREGNANCY, historyEmpty, historyLines, historyPayload, historyValues, readSentence } from './historyFormat.js';

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
