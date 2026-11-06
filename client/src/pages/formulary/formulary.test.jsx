// Clinical Requirements Group A, item 7: a formulary row shows whether it is verified (colour, icon, word) and offers a
// dose only when it is. The doses are FAKE test numbers. Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const row = (over) => ({ id: 'f1', name: 'Testmedicine', strength: '', form: '', population: 'neonatal', indication: '', doseMg: 5, doseBasis: 'per_kg', frequency: '', highAlert: false, version: 1, verified: false, confirmations: [], ...over });
let items = [];
vi.mock('../../hooks/useFetch.js', () => ({ useFetch: () => ({ data: { items, editor: false }, error: null, loading: false, reload: () => {} }) }));
const { FormularyPage, verifiedLook } = await import('./FormularyPage.jsx');
const text = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('the formulary', () => {
  it('says verified, needs the other person, or not verified', () => {
    expect(verifiedLook(row({ verified: true }))).toMatchObject({ tone: 'stable', word: 'Verified' });
    expect(verifiedLook(row({ confirmations: [{ role: 'doctor' }] }))).toMatchObject({ tone: 'watch', word: 'Needs the pharmacist' });
    expect(verifiedLook(row({ confirmations: [{ role: 'pharmacist' }] })).word).toBe('Needs the doctor');
    expect(verifiedLook(row()).word).toBe('Not verified');
  });

  it('offers "Work out a dose" only on a verified row; an empty formulary says why nothing is calculated', () => {
    items = [];
    expect(text(<FormularyPage />)).toContain('until a row is verified, no dose is worked out from it');
    items = [row(), row({ id: 'f2', name: 'Othermedicine', verified: true })];
    const out = text(<FormularyPage />);
    expect(out.match(/Work out a dose/g)).toHaveLength(1);
    expect(out).not.toContain('Add a row'); // a nurse reads only
  });
});
