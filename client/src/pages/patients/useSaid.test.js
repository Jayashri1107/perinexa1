// "Use what was said" (VoiceEntry): a detail typed by hand is kept when the text is read again, but when the person
// chooses the spoken value it is used (as an answer is), replacing what they typed.
import { describe, expect, it } from 'vitest';
import { extractPatientDetails, newFillMemory, noteHandEdit, planFill, splitFound } from './dictation.js';

const NOW = new Date('2026-09-30T08:00:00Z');
const form = () => ({ fullName: '', pregnancy: { lmp: '2025-11-18', scanEdd: '' }, obstetric: { pastComplications: [] }, medical: { conditions: [] }, notes: '' });

describe('Use what was said', () => {
  it('replaces an LMP typed by hand with the one dictated', () => {
    const memory = newFillMemory();
    noteHandEdit(memory, ['pregnancy.lmp']); // 18/11/2025 typed in the date box
    const v = form();
    const result = extractPatientDetails('LMP 18th May 2026', { careType: 'antenatal', now: NOW, voice: true });
    expect(result.values.pregnancy.lmp).toBe('2026-05-18');

    // Reading the text: the typed date stays, and the spoken one is listed as "not changed"
    const reading = planFill(memory, result, { reading: true, usable: result.paths, v, fromVoice: new Set() });
    expect(reading.values(v).pregnancy.lmp).toBe('2025-11-18');
    const { notChanged } = splitFound(result.found, result.values, reading.keep, v);
    expect(notChanged.map((f) => f.path)).toEqual(['pregnancy.lmp']);

    // The button: the same reading, only that detail, as the person's choice
    const chosen = planFill(memory, { ...result, paths: ['pregnancy.lmp'] }, { reading: false, usable: ['pregnancy.lmp'], v, fromVoice: new Set() });
    expect(chosen.values(v).pregnancy.lmp).toBe('2026-05-18');
    expect([...chosen.marks(new Set())]).toContain('pregnancy.lmp'); // still marked "From voice"
  });
});
