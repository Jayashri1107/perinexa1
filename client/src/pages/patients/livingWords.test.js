// Living children said as "live" (owner's report, 2026-09-30: "live 2" was not picked up).
import { describe, expect, it } from 'vitest';
import { extractPatientDetails } from './dictation.js';

const NOW = new Date('2026-09-30T08:00:00Z');
const voice = (t) => extractPatientDetails(t, { careType: 'antenatal', now: NOW, voice: true });

describe('living children', () => {
  it('reads "live", "live births", "live issues", "alive" – alone or in the G P L A formula', () => {
    expect(voice('G3 P2 live 2 A0').values.obstetric).toEqual({ gravida: '3', para: '2', living: '2', abortions: '0' });
    expect(voice('gravida 3 para 2 live 2 abortion 0').values.obstetric).toEqual({ gravida: '3', para: '2', living: '2', abortions: '0' });
    for (const t of ['live 2', 'live births 2', 'live issues 2', 'alive 2', 'two live children', '2 live births']) expect(voice(t).values.obstetric?.living, t).toBe('2');
  });

  it('not a time', () => {
    expect(voice('live birth 2 years ago').values.obstetric?.living).toBeUndefined();
  });
});
