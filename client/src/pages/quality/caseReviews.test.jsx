// Clinical Requirements Group C (PX-OBG-30, PX-X-05): the death and near-miss reviews list, a draft review's form, and a
// sealed review shown as signed with its corrections. Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const rules = {
  kinds: { maternal_death: 'Maternal death', near_miss: 'Maternal near miss' },
  criteria: [{ key: 'shock', group: 'Heart and circulation', label: 'Shock' }],
  causes: { haemorrhage: 'Obstetric haemorrhage' },
  delays: { delay1: 'Delay 1 – deciding to seek care', delay2: 'Delay 2 – reaching the hospital', delay3: 'Delay 3 – receiving the right care here' },
  delayAnswers: { yes: 'Yes', no: 'No', unknown: 'Not known' },
  avoidable: { yes: 'Yes', possibly: 'Possibly', no: 'No' },
  correctable: { summary: 'Summary of the case' },
  source: 'DRAFT – sample source',
};
const base = {
  id: 'r1',
  serial: 3,
  kind: 'near_miss',
  patient: { id: 'p1', fullName: 'Review Mother', mrn: 'P-000009' },
  eventAt: '2026-11-08T22:00:00.000Z',
  summary: 'Sample summary',
  criteria: ['shock'],
  cause: 'haemorrhage',
  causeDetail: '',
  delays: { delay1: { answer: 'no', note: '' }, delay2: { answer: 'no', note: '' }, delay3: { answer: 'yes', note: 'Blood late' } },
  avoidable: 'possibly',
  factors: '',
  lessons: '',
  actions: [],
  meetingOn: '2026-11-10',
  members: '',
  started: { byName: 'Sample quality', at: '2026-11-09T05:00:00.000Z' },
  lastSaved: null,
  corrections: [],
};
let current;
vi.mock('../../hooks/useFetch.js', () => ({
  useFetch: (path) => ({
    data:
      path === '/case-reviews'
        ? { reviews: [{ ...base, status: 'sealed', sealed: { byName: 'Dr A', at: base.eventAt }, corrections: 1 }], awaiting: [{ id: 'p2', fullName: 'Other Mother', mrn: 'P-000010', diedOn: '2026-11-01T00:00:00.000Z' }], rules }
        : { review: current, rules },
    error: null,
    loading: false,
    reload: () => {},
  }),
}));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useParams: () => ({ id: 'r1' }) }));
const { CaseReviewsPage } = await import('./CaseReviewsPage.jsx');
const { CaseReviewPage } = await import('./CaseReviewPage.jsx');
const text = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>).replace(/&#x27;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('death and near-miss reviews', () => {
  it('lists the reviews and the deaths still without one', () => {
    const out = text(<CaseReviewsPage />);
    expect(out).toContain('Deaths without a review');
    expect(out).toContain('Other Mother · P-000010');
    expect(out).toContain('R-0003');
    expect(out).toContain('Sealed');
    expect(out).toContain('1 correction');
    expect(out).toContain('DRAFT – sample source');
    expect(out).not.toMatch(/!/);
  });
});

describe('a review', () => {
  it('a draft is a form with save, and sign and seal for a doctor', () => {
    current = { ...base, status: 'draft', sealed: null, access: { edit: true, seal: true, correct: false } };
    const out = text(<CaseReviewPage />);
    expect(out).toContain('Draft');
    expect(out).toContain('Near-miss criteria (one or more)');
    expect(out).toContain('Delay 1 – deciding to seek care');
    expect(out).toContain('Save the draft');
    expect(out).toContain('Sign and seal');
    expect(out).not.toContain('Add the correction');
  });

  it('a sealed review is shown as signed with its corrections and the correction form', () => {
    current = { ...base, status: 'sealed', sealed: { byName: 'Dr A', at: '2026-11-10T06:00:00.000Z' }, corrections: [{ id: 'c1', part: 'summary', should: 'Five units', reason: 'Register checked', byName: 'Sample quality', at: '2026-11-11T06:00:00.000Z' }], access: { edit: false, seal: false, correct: true } };
    const out = text(<CaseReviewPage />);
    expect(out).toContain('Maternal near miss review R-0003');
    expect(out).toContain('The review as signed');
    expect(out).toContain('Delay 3 – receiving the right care here Yes – Blood late');
    expect(out).toContain('Should say: Five units · why: Register checked');
    expect(out).toContain('Add the correction');
    expect(out).toContain('Confidential: not shown on her record');
    expect(out).not.toContain('Save the draft');
  });
});
