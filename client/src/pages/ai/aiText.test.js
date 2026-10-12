import { describe, expect, it } from 'vitest';
import { fillLetter } from './LetterDialog.jsx';
import { reportLine } from './ReportReaderDialog.jsx';

describe('AI drafts', () => {
  it('fills in the names the AI leaves as placeholders (the AI never sees them)', () => {
    expect(fillLetter('Re: [Patient name]\n…\n[Doctor name]', { patientName: 'Meera Testcase', doctorName: 'Dr. Riley Demo' })).toBe('Re: Meera Testcase\n…\nDr. Riley Demo');
  });

  it('turns a read report into one line for the visit notes', () => {
    const r = {
      reportDate: '2026-09-27',
      title: 'CBC',
      values: [
        { name: 'Haemoglobin', value: '9.4', unit: 'g/dL', flag: 'low' },
        { name: 'Platelets', value: '2.1', unit: 'lakh/µL', flag: 'normal' },
      ],
      summary: 'Low Hb.',
    };
    expect(reportLine(r)).toBe('Report 2026-09-27 (CBC): Haemoglobin 9.4 g/dL (low); Platelets 2.1 lakh/µL – Low Hb.');
    expect(reportLine({ values: [{ name: 'AFI', value: '12', unit: 'cm', flag: 'unknown' }], summary: '' })).toBe('Report: AFI 12 cm');
  });
});
