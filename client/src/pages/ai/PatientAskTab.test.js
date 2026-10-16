import { describe, expect, it } from 'vitest';
import { describeAudit } from '../../components/auditFormat.js';
import { ASK_NOTE, answerText } from './PatientAskTab.jsx';

// Ask AI (docs/ASK_AI_PLAN.md): an answer as plain text – what "Copy the answer" puts on the clipboard for a visit
// note, and what is sent back to the server as the conversation so far.
describe('Ask AI: an answer as plain text', () => {
  it('has the three labelled parts in order, each record point with where it comes from, and the caution last', () => {
    const a = {
      fromRecord: [
        { text: 'Hb 8.9 g/dL, low.', source: 'lab 2026-10-11' },
        { text: 'Had IV iron in hospital.', source: '' },
      ],
      general: [{ text: 'Recheck the Hb 2 to 4 weeks after IV iron.' }],
      notInRecord: ['No serum ferritin recorded', 'No urine protein at the last visit'],
      caution: 'Check her BP again today.',
    };
    expect(answerText(a)).toBe(
      [
        'From her record:',
        '- Hb 8.9 g/dL, low. (lab 2026-10-11)',
        '- Had IV iron in hospital.',
        'General medical knowledge – check against current guidelines:',
        '- Recheck the Hb 2 to 4 weeks after IV iron.',
        'Not in her record:',
        '- No serum ferritin recorded',
        '- No urine protein at the last visit',
        'Caution: Check her BP again today.',
      ].join('\n'),
    );
  });

  it('leaves out the parts that are empty', () => {
    const none = { fromRecord: [], general: [], notInRecord: [], caution: '' };
    expect(answerText(none)).toBe('');
    expect(answerText({ ...none, notInRecord: ['No scan after 20 weeks'] })).toBe('Not in her record:\n- No scan after 20 weeks');
    expect(answerText({ ...none, caution: 'Not a question about this patient.' })).toBe('Caution: Not a question about this patient.');
    expect(answerText({ ...none, general: [{ text: 'Iron sucrose is given as an infusion.' }] })).toBe('General medical knowledge – check against current guidelines:\n- Iron sucrose is given as an infusion.');
  });

  it('the note on the tab says what is never sent', () => {
    expect(ASK_NOTE).toContain('her name, phone, address and patient number are not sent');
    expect(ASK_NOTE).toContain('HIV');
  });

  it('the audit log names the feature, never the question', () => {
    const entry = (feature) => ({ action: 'AI_USED', details: { feature, patientId: 'x', mrn: 'P-000001', model: 'gpt-5.4-mini', inputTokens: 1200, outputTokens: 150 } });
    expect(describeAudit(entry('ask_patient'))).toBe('Record P-000001: question about the patient (Ask AI) (gpt-5.4-mini)');
    expect(describeAudit(entry('ask_patient_deep'))).toBe('Record P-000001: question about the patient (Ask AI, thought harder) (gpt-5.4-mini)');
  });
});

describe('Ask AI: what is copied for a visit note', () => {
  it('says it is an AI answer, when and to which question, then the answer', async () => {
    const { copyText } = await import('./PatientAskTab.jsx');
    const turn = { question: 'How is her Hb?', at: '2026-10-15T06:00:00Z', answer: { fromRecord: [{ text: 'Hb 8.9 g/dL, low.', source: 'lab 2026-10-11' }], general: [], notInRecord: [], caution: '' } };
    const text = copyText(turn);
    expect(text.split('\n')[0]).toMatch(/^AI answer \(OpenAI, .+\) to: How is her Hb\? – to be checked against her record before use\.$/);
    expect(text).toContain('From her record:\n- Hb 8.9 g/dL, low. (lab 2026-10-11)');
  });
});
