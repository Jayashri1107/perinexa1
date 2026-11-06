// Clinical Requirements Group A, item 5: the EPDS form asks for the ten answers' scores only (never the questions);
// the VTE form shows the factors of the phase and its advice without a dose. Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { vteFactorsFor, vteResult } from './scoreRules.js';

vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useOutletContext: () => ({ patient: { id: 'p1', careType: 'postnatal' } }) }));
vi.mock('../../hooks/useFetch.js', () => ({
  useFetch: () => ({ data: { scores: [{ id: 's1', kind: 'epds', on: '2026-11-10', total: 14, band: 'likely', selfHarm: true, byName: 'Sample nurse', cancelled: null }], access: { write: true }, rules: { epdsSource: 'Cox 1987', vteSource: 'RCOG 37a' } }, error: null, reload: () => {} }),
}));
const { PatientScoresTab } = await import('./PatientScoresTab.jsx');
const text = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('EPDS and VTE scores', () => {
  it('the EPDS form has ten answers to score and no question text', () => {
    const out = text(<PatientScoresTab />);
    for (let i = 1; i <= 10; i += 1) expect(out).toContain(`Answer ${i}`);
    expect(out).not.toMatch(/laugh|blamed|anxious|harming myself/i);
    expect(out).toContain('EPDS 14 · Likely depression · question 10 scored');
    expect(out).not.toMatch(/!/);
  });

  it('delivery factors count only after birth, and the advice never gives a dose', () => {
    expect(vteFactorsFor('antenatal').some((f) => f.key === 'cs_in_labour')).toBe(false);
    expect(vteFactorsFor('postnatal').some((f) => f.key === 'cs_in_labour')).toBe(true);
    expect(vteResult('postnatal', ['cs_in_labour']).advice.join(' ')).not.toMatch(/\d+\s?(mg|units|IU)/i);
  });
});
