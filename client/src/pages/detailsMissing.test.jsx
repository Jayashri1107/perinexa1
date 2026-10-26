// Reception's "Details missing" on Today (26 Oct 2026): what is missing in words, and Fill details on each row
// (rendered to HTML, no browser). Fake data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DetailsMissing, missingText } from './DetailsMissing.jsx';

const row = (id, fullName, missing) => ({ patient: { id, fullName, mrn: `P-00000${id}`, phone: '98765 43210', doctorName: null }, missing, registeredOn: '2026-10-26' });
const text = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('details missing', () => {
  it('says what is missing in plain words', () => {
    expect(missingText(['address'])).toBe('Address missing');
    expect(missingText(['address', 'emergencyContact', 'doctor'])).toBe('Address, emergency contact and doctor missing');
    expect(missingText([])).toBe('');
  });

  it('a warning box with each patient, what is missing and Fill details; nothing when all are complete', () => {
    const shown = text(<DetailsMissing rows={[row('1', 'Bare Sample', ['address', 'emergencyContact']), row('2', 'Quick Sample', ['doctor'])]} onSaved={() => {}} />);
    expect(shown).toContain('Details missing (2)');
    expect(shown).toContain('Bare Sample P-000001 · 98765 43210 · registered 26 Oct 2026');
    expect(shown).toContain('Address and emergency contact missing');
    expect(shown).toContain('Fill details');
    expect(renderToStaticMarkup(<MemoryRouter><DetailsMissing rows={[]} onSaved={() => {}} /></MemoryRouter>)).toBe('');
    expect(renderToStaticMarkup(<MemoryRouter><DetailsMissing rows={null} onSaved={() => {}} /></MemoryRouter>)).toBe('');
  });

  it('shows 5 at first, then Show all', () => {
    const rows = ['1', '2', '3', '4', '5', '6', '7'].map((i) => row(i, `Sample ${i}`, ['address']));
    const shown = text(<DetailsMissing rows={rows} onSaved={() => {}} />);
    expect(shown).toContain('Sample 5');
    expect(shown).not.toContain('Sample 6');
    expect(shown).toContain('Show all 7');
  });
});
