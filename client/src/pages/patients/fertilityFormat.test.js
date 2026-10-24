// The words and helpers of the fertility history and the treatment plan (docs/FERTILITY_PLAN.md). Fake sample data.
import { describe, expect, it } from 'vitest';
import {
  FERTILITY_CHOICES,
  FERTILITY_NUMBER_FIELDS,
  OUTCOME_LABELS,
  PLAN_STATUS_LOOK,
  durationWords,
  fertilityEmpty,
  fertilityNumberErrors,
  fertilityPayload,
  fertilityRows,
  fertilityValues,
  missingText,
  outcomeText,
  planDatesText,
  sectionLines,
} from './fertilityFormat.js';

const formatDate = (d) => new Date(d).toISOString().slice(0, 10);

describe('the fertility history on the form', () => {
  it('starts empty, keeps numbers as text, and sends the whole section', () => {
    const empty = fertilityValues(null);
    expect(fertilityEmpty(empty)).toBe(true);
    expect(empty.diagnoses).toEqual([]);
    for (const c of FERTILITY_CHOICES) expect(empty[c.key]).toBe('');
    for (const n of FERTILITY_NUMBER_FIELDS) expect(empty[n.key]).toBe('');
    const stored = { type: 'primary', durationMonths: 20, cycle: 'irregular', ovulation: 'anovulation', tubes: 'patent_both', semen: 'normal', diagnoses: ['pcos'], amh: 6.2, note: 'x' };
    const v = fertilityValues(stored);
    expect(v).toMatchObject({ type: 'primary', durationMonths: '20', amh: '6.2', diagnoses: ['pcos'], uterus: '', note: 'x' });
    expect(fertilityEmpty(v)).toBe(false);
    expect(fertilityPayload(v)).toMatchObject({ type: 'primary', durationMonths: '20', amh: '6.2', diagnoses: ['pcos'], uterus: '', afc: '', semenDetail: '' });
  });

  it('checks the numbers before they are sent, with the server’s words', () => {
    expect(fertilityNumberErrors(fertilityValues(null))).toEqual({});
    const bad = { ...fertilityValues(null), amh: 'high', afc: '2.5', durationMonths: '600', tsh: '0' };
    expect(fertilityNumberErrors(bad)).toEqual({
      'fertility.amh': 'AMH (ng/mL) must be a number',
      'fertility.afc': 'Antral follicle count must be a whole number',
      'fertility.durationMonths': 'Months trying to conceive is too high',
    });
    expect(fertilityNumberErrors({ ...fertilityValues(null), amh: '1,5' })).toEqual({});
  });

  it('describes the history for the Overview card in a few rows', () => {
    expect(durationWords(8)).toBe('8 months');
    expect(durationWords(18)).toBe('1 y 6 m');
    expect(durationWords(24)).toBe('2 years');
    const rows = Object.fromEntries(fertilityRows({ type: 'secondary', durationMonths: 30, partnerAgeYears: 34, cycle: 'regular', cycleLengthDays: 28, ovulation: 'confirmed', tubes: 'both_blocked', semen: 'mild_abnormal', semenDetail: 'count 11 M/mL', diagnoses: ['varicocele'], amh: 2.1, afc: 12, oiCycles: 2, iuiCycles: 0 }));
    expect(rows.Infertility).toBe('Secondary (conceived before) · trying 2 y 6 m · partner 34 yrs');
    expect(rows['Cycles and ovulation']).toBe('Regular (21–35 days) · 28 days · Confirmed (progesterone or scan)');
    expect(rows.Tubes).toBe('Both tubes blocked');
    expect(rows.Semen).toBe('Mildly to moderately abnormal · count 11 M/mL');
    expect(rows.Diagnoses).toBe('Varicocele (partner)');
    expect(rows['Ovarian reserve']).toBe('AMH 2.1 ng/mL · AFC 12');
    expect(rows['Previous cycles']).toBe('Ovulation induction 2');
    expect(fertilityRows(null)).toEqual([]);
  });
});

describe('the treatment plan words', () => {
  it('turns a section’s text into headings and items, and says how a plan ended', () => {
    expect(sectionLines('Letrozole induction\n• one\n•two\n\n')).toEqual([
      { kind: 'heading', text: 'Letrozole induction' },
      { kind: 'item', text: 'one' },
      { kind: 'item', text: 'two' },
    ]);
    expect(sectionLines('')).toEqual([]);
    const plan = { status: 'completed', startOn: '2026-10-22T00:00:00.000Z', reviewOn: '2026-11-20T00:00:00.000Z', outcome: { kind: 'pregnant', note: 'Cycle 2', byName: 'Rani Demo-RMO', at: '2026-12-01T06:00:00.000Z' } };
    expect(planDatesText(plan, formatDate)).toBe('Started 2026-10-22 · review 2026-11-20');
    expect(outcomeText(plan, formatDate)).toBe('Completed – Pregnant: Cycle 2 (Rani Demo-RMO, 2026-12-01)');
    expect(outcomeText({ status: 'draft', outcome: null }, formatDate)).toBe('');
    expect(Object.keys(PLAN_STATUS_LOOK)).toEqual(['draft', 'active', 'completed', 'stopped']);
    expect(Object.keys(OUTCOME_LABELS)).toEqual(['pregnant', 'next_step', 'no_response', 'patient_choice', 'discarded', 'other']);
    expect(missingText({ missing: [{ key: 'tubes', label: 'tubal patency' }, { key: 'semen', label: "the partner's semen analysis" }] })).toBe("Not yet on her record: tubal patency; the partner's semen analysis.");
    expect(missingText({ missing: [] })).toBe('');
  });
});
