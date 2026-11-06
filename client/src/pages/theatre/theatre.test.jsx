// Clinical Requirements Group B, item 16: the theatre list shows each operation with its WHO checklist progress (icon and
// word); a case shows the three steps in order with the WHO items. Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PHASES } from './whoRules.js';

const kase = {
  id: 'c1',
  patient: { id: 'p1', fullName: 'Theatre Patient', mrn: 'P-000001' },
  listDate: '2026-11-10',
  theatre: 'Theatre 1',
  order: 1,
  procedure: 'Laparoscopic cystectomy',
  site: 'Right ovary',
  urgency: 'elective',
  surgeon: 'Dr Sample',
  assistant: '',
  anaesthetist: 'Dr Anaes',
  anaesthesia: 'general',
  status: 'in_theatre',
  progress: { signIn: { byName: 'Sample nurse', role: 'Nurse', at: '2026-11-10T04:00:00Z' }, timeOut: null, signOut: null },
  checklist: { signIn: { answers: {}, notes: {} }, timeOut: { answers: {}, notes: {} }, signOut: { answers: {}, notes: {} } },
  cancelled: null,
};
vi.mock('../../hooks/useFetch.js', () => ({ useFetch: (path) => ({ data: path === '/theatre' ? { cases: [kase] } : { case: kase, access: { write: true } }, error: null, loading: false, reload: () => {} }) }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useParams: () => ({ id: 'c1' }) }));
const { TheatreListPage } = await import('./TheatreListPage.jsx');
const { TheatreCasePage } = await import('./TheatreCasePage.jsx');
const text = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>).replace(/&#x27;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('the theatre list and the WHO checklist', () => {
  it('lists the operation with its status and checklist progress', () => {
    const out = text(<TheatreListPage />);
    expect(out).toContain('Theatre Patient · P-000001');
    expect(out).toContain('Laparoscopic cystectomy (Right ovary)');
    expect(out).toContain('In theatre');
    expect(out).toContain('Sign in done');
    expect(out).toContain('Time out');
  });

  it('shows the three steps with every WHO item; sign in confirmed, time out next', () => {
    const out = text(<TheatreCasePage />);
    for (const p of Object.values(PHASES)) for (const i of p.items) expect(out).toContain(i.label);
    expect(out).toContain('Confirmed – Sample nurse (Nurse)');
    expect(out).toContain('Confirm time out');
    expect(out).toContain('Confirm time out first.');
    expect(out).toContain('The instrument, swab and needle count is checked by two people');
    expect(out).toContain('Their password');
    expect(out).not.toMatch(/!/);
  });
});
