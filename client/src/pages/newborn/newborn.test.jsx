// Clinical Requirements Group A, item 4: each screen or clinic visit shows its state as colour, icon and word; the
// list shows what is due or missed. Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ROLE_LABELS } from '../../components/ui.jsx';
import { RESULTS_FOR, itemLook } from './newbornFormat.js';

vi.mock('../../hooks/useFetch.js', () => ({
  useFetch: () => ({
    data: { babies: [{ patientId: 'b1', fullName: 'Baby Sample', mrn: 'P-000009', phone: '+91 00000 00000', birthAt: '2026-11-01T04:00:00Z', screens: [{ key: 'cchd', label: 'Pulse oximetry', state: 'overdue' }], visits: [] }] },
    error: null,
    loading: false,
  }),
}));
const { NewbornFollowUpPage } = await import('./NewbornFollowUpPage.jsx');
const text = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('newborn follow-up', () => {
  it('says done (with the result), due, overdue, missed, not needed or later', () => {
    expect(itemLook({ state: 'done', record: { result: 'refer' } })).toMatchObject({ tone: 'stable', word: 'Done – Refer' });
    expect(itemLook({ state: 'overdue' })).toMatchObject({ tone: 'high', word: 'Overdue' });
    expect(itemLook({ state: 'defaulter' })).toMatchObject({ tone: 'high', word: 'Missed' });
    expect(itemLook({ state: 'due' })).toMatchObject({ tone: 'due', word: 'Due now' });
    expect(itemLook({ state: 'not_needed' })).toMatchObject({ word: 'Not needed' });
    expect(itemLook({ state: 'upcoming' })).toMatchObject({ word: 'Later' });
    expect(RESULTS_FOR.rop).toEqual(['no_rop', 'rop_found']);
    expect(ROLE_LABELS.followup_coordinator).toBe('Newborn follow-up coordinator');
  });

  it('lists each baby with her phone and what is due or missed', () => {
    const out = text(<NewbornFollowUpPage />);
    expect(out).toContain('Baby Sample · P-000009');
    expect(out).toContain('+91 00000 00000');
    expect(out).toContain('Pulse oximetry: Overdue');
  });
});
