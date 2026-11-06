// Clinical Requirements Group B, item 8: the MEOWS chart shows each red or yellow reading with its word and icon (never
// colour alone) and asks whom you told on a trigger. DRAFT rules. Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useFetch.js', () => ({
  useFetch: () => ({
    data: {
      entries: [{ id: 'm1', at: '2026-11-10T05:30:00Z', values: { rr: 22, spo2: 98, tempC: 36.8, sbp: 165, dbp: 105, hr: 84, avpu: 'A' }, bands: { rr: 'yellow', spo2: 'normal', tempC: 'normal', sbp: 'red', dbp: 'red', hr: 'normal', avpu: 'normal' }, level: 'trigger', escalatedTo: 'Dr Sample', note: '', byName: 'Sample nurse', cancelled: null }],
      latest: { at: '2026-11-10T05:30:00Z', level: 'trigger' },
      access: { write: true },
    },
    error: null,
    reload: () => {},
  }),
}));
const { MeowsChart, Reading } = await import('./MeowsChart.jsx');
const html = (el) => renderToStaticMarkup(el);
const text = (m) => m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('the MEOWS chart', () => {
  it('red and yellow readings carry their word; normal ones are plain', () => {
    expect(text(html(<Reading value={165} band="red" />))).toBe('165 · Red');
    expect(html(<Reading value={165} band="red" />)).toContain('pill-high');
    expect(text(html(<Reading value={22} band="yellow" />))).toBe('22 · Yellow');
    expect(html(<Reading value={84} band="normal" />)).not.toContain('pill');
  });

  it('shows the latest trigger, the observations with whom was told, and says DRAFT with its source', () => {
    const out = text(html(<MeowsChart patient={{ id: 'p1', careType: 'postnatal' }} admissionId="a1" />));
    expect(out).toContain('Trigger – tell the doctor now');
    expect(out).toContain('165 · Red');
    expect(out).toContain('Told Dr Sample');
    expect(out).toContain('DRAFT until the Lead Obstetrician replaces it');
    expect(out).toContain('CEMACH');
    expect(out).not.toMatch(/!/);
  });

  it('is not shown on a baby’s record', () => {
    expect(html(<MeowsChart patient={{ id: 'b1', careType: 'newborn' }} admissionId="a1" />)).toBe('');
  });
});
