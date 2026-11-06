// Clinical Requirements Group A, item 6: the incident list shows status as colour, icon and word, and one primary
// button (Report an incident). Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ROLE_LABELS } from '../../components/ui.jsx';
import { incidentLook } from './incidentFormat.js';

vi.mock('../../auth/AuthContext.jsx', () => ({ useAuth: () => ({ activeMembership: { roles: ['nurse'] } }) }));
vi.mock('../../hooks/useFetch.js', () => ({
  useFetch: () => ({ data: { incidents: [{ id: 'i1', serial: 3, occurredAt: '2026-11-10T03:00:00Z', kind: 'fall', severity: 'none', status: 'reported', reported: { byName: 'Sample nurse', mine: true } }], lead: false }, error: null, loading: false, reload: () => {} }),
}));
const { IncidentsPage } = await import('./IncidentsPage.jsx');
const html = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);
const text = (m) => m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('incidents', () => {
  it('waiting, reviewed or closed – each with its own tone and icon', () => {
    expect(incidentLook({ status: 'reported' })).toMatchObject({ tone: 'watch', word: 'Waiting for review' });
    expect(incidentLook({ status: 'reviewed' })).toMatchObject({ tone: 'due', word: 'Reviewed – actions open' });
    expect(incidentLook({ status: 'closed' })).toMatchObject({ tone: 'stable', word: 'Closed' });
    expect(ROLE_LABELS.quality).toBe('Quality lead');
  });

  it('a nurse sees her own report and one primary button; no Open / Closed / All filter', () => {
    const out = html(<IncidentsPage />);
    expect(text(out)).toContain('Fall');
    expect(text(out)).toContain('You');
    expect(text(out)).toContain('Waiting for review');
    expect(out.match(/btn-primary/g)).toHaveLength(1);
    expect(text(out)).not.toContain('Closed');
  });
});
