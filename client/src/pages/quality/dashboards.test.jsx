// Clinical Requirements Group B, item 17: a dashboard row shows its value, what it is out of, and its target as colour,
// icon and word; a signed-off month says who signed it. Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const defs = [
  { key: 'deliveries', unit: 'count', label: 'Deliveries', definition: 'Delivery notes confirmed by a doctor this month.' },
  { key: 'csRate', unit: 'percent', better: 'lower', label: 'Caesarean rate', definition: 'Caesareans ÷ deliveries.' },
  { key: 'stillbirths', unit: 'per1000', better: 'lower', label: 'Stillbirth rate', definition: 'per 1000' },
];
let payload;
vi.mock('../../hooks/useFetch.js', () => ({ useFetch: () => ({ data: payload, error: null, reload: () => {} }) }));
vi.mock('../analytics/analyticsFormat.js', async (orig) => ({ ...(await orig()), thisMonth: () => '2026-12' }));
const { DashboardsPage, valueWords } = await import('./DashboardsPage.jsx');
const text = (el) => renderToStaticMarkup(<MemoryRouter initialEntries={['/clinical-audit/dashboards?month=2026-11&department=obstetrics']}>{el}</MemoryRouter>).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const base = (over = {}) => ({
  department: 'obstetrics',
  month: '2026-11',
  rows: [
    { key: 'deliveries', value: 12, numerator: null, denominator: null, target: null, status: null },
    { key: 'csRate', value: 33.3, numerator: 4, denominator: 12, target: 25, status: 'missed' },
    { key: 'stillbirths', value: null, numerator: 0, denominator: 0, target: null, status: null },
  ],
  signoff: null,
  access: { setTargets: true, signOff: true },
  definitions: defs,
  departments: { obstetrics: 'Obstetrics' },
  source: 'WHO',
  ...over,
});

describe('the monthly dashboards', () => {
  it('value words', () => {
    expect(valueWords(defs[1], { value: 33.3 })).toBe('33.3%');
    expect(valueWords(defs[2], { value: 4.5 })).toBe('4.5 per 1000');
    expect(valueWords(defs[2], { value: null, denominator: 0 })).toBe('None this month');
  });

  it('shows each row with what it is out of and its target in words; a lead can sign off a finished month', () => {
    payload = base();
    const out = text(<DashboardsPage />);
    expect(out).toContain('Deliveries');
    expect(out).toContain('33.3%');
    expect(out).toContain('4 of 12');
    expect(out).toContain('Target missed (at most 25%)');
    expect(out).toContain('Counted, not judged');
    expect(out).toContain('Sign off November 2026');
    expect(out).toContain('DRAFT definitions');
    expect(out).not.toMatch(/!/);
  });

  it('a signed-off month says who signed it and shows its kept numbers', () => {
    payload = base({ signoff: { byName: 'Dr Sample', at: '2026-12-02T06:00:00Z', comment: 'Reviewed', rows: [{ key: 'deliveries', value: 11, numerator: null, denominator: null, target: null, status: null }] }, access: { setTargets: true, signOff: false } });
    const out = text(<DashboardsPage />);
    expect(out).toContain('Signed off by Dr Sample');
    expect(out).toContain('As signed off');
    expect(out).toContain('11');
    expect(out).not.toContain('Sign off November 2026');
  });
});
