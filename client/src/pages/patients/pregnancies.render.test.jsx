// Clinical Requirements Group C (PX-X-15): her pregnancies, each with what belongs to it, and the DRAFT tier beside
// today's risk level. Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const data = {
  tier: { tier: 'amber', word: 'AMBER – additional care', reasons: [{ key: 'cs1', tier: 'amber', label: 'One previous caesarean' }], missing: [], riskLevelToday: 'moderate', source: 'DRAFT – sample, not in use' },
  episodes: [
    { id: 'e2', number: 2, edd: '2027-02-05', from: '2026-04-17', to: null, status: 'open', closed: null, visits: [{ id: 'v1', on: '2026-10-01' }], stays: [{ id: 's1', admittedAt: '2026-11-09T01:00:00.000Z', dischargedAt: null, ward: 'Antenatal ward', status: 'admitted' }], deliveries: [], operations: [], labOrders: 2, babies: [] },
    { id: 'e1', number: 1, edd: '2024-03-01', from: '2023-05-12', to: '2024-02-20', status: 'closed', closed: { reason: 'delivered', word: 'Delivered', at: '2024-02-20' }, visits: [], stays: [], deliveries: [{ admissionId: 'a1', at: '2024-02-18T10:00:00.000Z' }], operations: [], labOrders: 0, babies: [{ id: 'b1', fullName: 'Baby Sample', mrn: 'P-000020', birthAt: '2024-02-18T10:00:00.000Z' }] },
  ],
};
vi.mock('../../hooks/useFetch.js', () => ({ useFetch: () => ({ data, error: null, loading: false, reload: () => {} }) }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useOutletContext: () => ({ patient: { id: 'p1', careType: 'antenatal' } }) }));
const { PregnanciesTab } = await import('./PregnanciesTab.jsx');
const text = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>).replace(/&#x27;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('her pregnancies', () => {
  it('shows the DRAFT tier beside today’s risk level, then each pregnancy, the current one first', () => {
    const out = text(<PregnanciesTab />);
    expect(out).toContain('Tier – DRAFT, not in use');
    expect(out).toContain('AMBER – additional care');
    expect(out).toContain("Today's risk level, which Perinexa uses: Moderate risk.");
    expect(out).toContain('AMBER: One previous caesarean');
    expect(out.indexOf('Pregnancy 2 – current')).toBeLessThan(out.indexOf('Pregnancy 1 – Delivered'));
    expect(out).toContain('Antenatal ward (in hospital)');
    expect(out).toContain('Baby Sample · P-000020');
    expect(out).toContain('No signed delivery note');
    expect(out).not.toMatch(/!/);
  });
});
