// Clinical Requirements Group B, items 12 and 13: a baby's care at birth, examinations, bilirubin chart (readings only)
// and NICU admissions; the month's NICU register. DRAFT. Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { BIRTH_CHECKS, EXAM_ITEMS } from './newbornCareRules.js';

const care = {
  birthAt: '2026-11-09T06:00:00Z',
  birth: [],
  exams: [{ id: 'e1', examinedAt: '2026-11-10T04:00:00Z', weightGrams: 2050, findings: { hips: 'abnormal' }, notes: { hips: 'Clicky left hip (sample)' }, ready: {}, summary: '', byName: 'Dr Sample', cancelled: null }],
  bilirubin: [
    { id: 'b1', at: '2026-11-10T00:00:00Z', hours: 18, mgdl: 8.5, method: 'skin', byName: 'Sample nurse', cancelled: null },
    { id: 'b2', at: '2026-11-10T12:00:00Z', hours: 30, mgdl: 10.2, method: 'serum', byName: 'Sample nurse', cancelled: null },
  ],
  nicu: [{ id: 'n1', serial: 4, unit: 'sncu', source: 'inborn', admittedAt: '2026-11-09T07:00:00Z', ageHours: 1, reasons: ['lbw'], reasonNote: '', temperatureC: 35.9, cold: true, outcome: null, stayDays: null, cancelled: null }],
  access: { write: true, outcome: true },
};
const register = { month: '2026-11', rows: [{ ...care.nicu[0], baby: { id: 'p1', fullName: 'Baby Sample', mrn: 'P-000009' }, weightGrams: 2100 }], totals: { admissions: 1, inborn: 1, outborn: 0, cold: 1, stillAdmitted: 1, outcomes: { discharged: 0, referred: 0, lama: 0, died: 0 } } };
vi.mock('../../hooks/useFetch.js', () => ({ useFetch: (path) => ({ data: path === '/newborn-care/register' ? register : care, error: null, loading: false, reload: () => {} }) }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useParams: () => ({ id: 'p1' }) }));
vi.mock('../analytics/analyticsFormat.js', async (orig) => ({ ...(await orig()), thisMonth: () => '2026-11' }));
const { NewbornCareTab, BiliChart } = await import('./NewbornCareTab.jsx');
const { NicuRegisterPage } = await import('./NicuRegisterPage.jsx');
const html = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>).replace(/&#x27;/g, "'");
const text = (el) => html(el).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('newborn care', () => {
  it('the record at birth offers every first step; the examination shows what is not normal; the admission says cold', () => {
    const out = text(<NewbornCareTab />);
    for (const c of BIRTH_CHECKS) expect(out).toContain(c.label);
    expect(out).toContain('1 not normal');
    expect(out).toContain(`${EXAM_ITEMS.find((i) => i.key === 'hips').label}: Clicky left hip (sample)`);
    expect(out).toContain('Cold at admission – 35.9 °C');
    expect(out).toContain('Record how it ended');
    expect(out).toContain('the treatment lines come from the hospital');
    expect(out).not.toMatch(/!/);
  });
  it('the bilirubin chart plots the readings against hours of age, with no treatment line', () => {
    const svg = html(<BiliChart readings={care.bilirubin} />);
    expect(svg).toContain('8.5 mg/dL at 18 hours, 10.2 mg/dL at 30 hours');
    expect(svg.match(/<circle/g)).toHaveLength(2);
    expect(svg).not.toMatch(/phototherapy/i);
  });
  it('the register lists the month with its totals', () => {
    const out = text(<NicuRegisterPage />);
    expect(out).toMatch(/Baby Sample P-000009/);
    expect(out).toContain('Admitted now');
    expect(out).toContain('1 inborn · 0 outborn');
  });
});
