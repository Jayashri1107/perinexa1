// Clinical Requirements Group B, items 9 and 10: the pre-anaesthesia check-up form and list, and the pain chart with its
// bands in words. DRAFT. Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ASA, MALLAMPATI } from './anaesthesiaRules.js';

vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useOutletContext: () => ({ patient: { id: 'p1', careType: 'gynaecology' } }) }));
vi.mock('../../hooks/useFetch.js', () => ({
  useFetch: (path) => ({
    data:
      path === '/anaesthesia/pac'
        ? { assessments: [{ id: 'a1', assessedAt: '2026-11-10T04:00:00Z', asa: '3', emergency: true, airwayMallampati: '2', plannedAnaesthesia: 'spinal', fitness: 'conditions', fitnessNote: 'Correct Hb first (sample)', byName: 'Dr Sample', role: 'Doctor', cancelled: null }], access: { write: true } }
        : { entries: [{ id: 'e1', at: '2026-11-10T05:00:00Z', score: 8, pain: { band: 'red', words: 'Severe pain (7–10)' }, poss: '3', sedation: { band: 'red', words: 'x' }, nausea: 'vomiting', action: 'Sample action', escalatedTo: 'Dr Sample', byName: 'Sample nurse', cancelled: null }], access: { write: true } },
    error: null,
    reload: () => {},
  }),
}));
const { PacTab } = await import('./PacTab.jsx');
const { PainChartSection } = await import('./PainChart.jsx');
const text = (el) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('anaesthesia records', () => {
  it('the check-up offers the ASA grades and Mallampati classes and lists her check-ups with their fitness', () => {
    const out = text(<PacTab />);
    for (const w of [...Object.values(ASA), ...Object.values(MALLAMPATI)]) expect(out).toContain(w);
    expect(out).toContain('Fit, with conditions');
    expect(out).toContain('ASA 3E · Mallampati 2 · Spinal');
    expect(out).toContain('Correct Hb first (sample)');
    expect(out).toContain('DRAFT until the Lead Anaesthetist');
  });
  it('the pain chart shows the score with its band in words, sedation, and whom was told', () => {
    const out = text(<PainChartSection patient={{ id: 'p1', careType: 'postnatal' }} admissionId="a1" />);
    expect(out).toContain('8 · Severe pain (7–10)');
    expect(out).toContain('POSS 3');
    expect(out).toContain('Told Dr Sample');
    expect(out).toContain('Order sets A–D come once their formulary rows are verified');
    expect(out).not.toMatch(/!/);
  });
});
