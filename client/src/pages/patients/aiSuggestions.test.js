// "Ask AI where these belong": an accepted suggestion goes into the form as an answer would.
import { describe, expect, it } from 'vitest';
import { answerToResult, suggestionMeaning } from './dictation.js';
import { visitAnswer, visitSuggestionMeaning } from '../visits/visitDictation.js';

describe('AI suggestions as answers', () => {
  it('registration form', () => {
    const put = (s) => answerToResult(null, suggestionMeaning(s), 'antenatal').values;
    expect(put({ field: 'obstetric.living', value: '2' }).obstetric.living).toBe('2');
    expect(put({ field: 'pregnancy.lmp', value: '2026-05-18' }).pregnancy.lmp).toBe('2026-05-18');
    expect(put({ field: 'medical.conditions', value: 'thyroid' }).medical.conditions).toEqual(['thyroid']);
    expect(put({ field: 'obstetric.pastComplications', value: 'pre_eclampsia' }).obstetric.pastComplications).toEqual(['pre_eclampsia']);
    expect(put({ field: 'medical.otherConditions', value: 'GDM in last pregnancy' }).medical.otherConditions).toBe('GDM in last pregnancy');
    expect(suggestionMeaning({ field: 'fullName', value: 'X' })).toBe(null);
  });
  it('visit form', () => {
    const put = (s) => visitAnswer(null, visitSuggestionMeaning(s)).values;
    expect(put({ field: 'vitals.bpSystolic', value: '130' }).vitals.bpSystolic).toBe('130');
    expect(put({ field: 'details.presentation', value: 'breech' }).details.presentation).toBe('breech');
    expect(put({ field: 'details.complaints', value: 'Back pain for 2 days' }).details.complaints).toBe('Back pain for 2 days');
    expect(visitSuggestionMeaning({ field: 'details.privateNote', value: 'x' })).toBe(null);
  });
});
