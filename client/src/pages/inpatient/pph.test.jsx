// Clinical Requirements Group B, item 15: the PPH chart lists every line in time order, adds up the blood loss with its
// band in words, shows the shock index, and never gives a dose. DRAFT. Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const chart = {
  id: 'c1',
  recognisedAt: '2026-11-10T04:00:00Z',
  causes: ['tone'],
  status: 'open',
  totalLossMl: 1150,
  loss: { band: 'red', words: 'Major PPH – moderate (1001 to 2000 mL)' },
  shock: { value: 1.35, band: 'yellow' },
  losses: [
    { id: 'l2', at: '2026-11-10T04:10:00Z', ml: 450, method: 'estimated', byName: 'Sample nurse', cancelled: null },
    { id: 'l1', at: '2026-11-10T04:03:00Z', ml: 700, method: 'measured', byName: 'Sample nurse', cancelled: null },
  ],
  steps: [{ id: 's1', at: '2026-11-10T04:02:00Z', key: 'oxytocin', dose: 'sample dose', route: 'IV', note: '', byName: 'Sample nurse', cancelled: null }],
  observations: [{ id: 'o1', at: '2026-11-10T04:12:00Z', hr: 124, sbp: 92, dbp: 58, spo2: 96, shock: { value: 1.35, band: 'yellow' }, byName: 'Sample nurse', cancelled: null }],
  outcome: null,
  cancelled: null,
};
vi.mock('../../hooks/useFetch.js', () => ({ useFetch: () => ({ data: { charts: [chart], access: { start: true, write: true, close: true } }, error: null, reload: () => {} }) }));
const { PphChartSection, timeline } = await import('./PphChart.jsx');
const text = (el) => renderToStaticMarkup(el).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('the PPH chart', () => {
  it('puts every line in time order', () => {
    expect(timeline(chart).map((r) => r.id)).toEqual(['s1', 'l1', 'l2', 'o1']);
    expect(timeline(chart)[0].words).toBe('Oxytocin · dose sample dose · route IV');
  });

  it('shows the blood loss so far with its band in words, the shock index, and DRAFT with its source', () => {
    const out = text(<PphChartSection patient={{ id: 'p1', careType: 'postnatal' }} admissionId="a1" />);
    expect(out).toContain('1150 mL');
    expect(out).toContain('Major PPH – moderate (1001 to 2000 mL)');
    expect(out).toContain('Shock index 1.35 · Yellow');
    expect(out).toContain('0.9 or more – watch closely');
    expect(out).toContain('DRAFT until the Lead Obstetrician replaces it');
    expect(out).toContain('RCOG Green-top Guideline 52');
    expect(out).not.toContain('Start a PPH chart'); // one open chart at a time
    expect(out).not.toMatch(/!/);
  });

  it('is not shown on a baby’s record', () => {
    expect(renderToStaticMarkup(<PphChartSection patient={{ id: 'b1', careType: 'newborn' }} admissionId="a1" />)).toBe('');
  });
});
