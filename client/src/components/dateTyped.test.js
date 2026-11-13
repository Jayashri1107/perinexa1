import { describe, expect, it } from 'vitest';
import { isoToTyped, typedToIso, typingDate } from './dateTyped.js';

// A typed date, dd/mm/yyyy (13 Nov 2026): what the pharmacy types, read the Indian way.
describe('a typed date', () => {
  it('reads dd/mm/yyyy and its usual forms', () => {
    for (const t of ['13/11/2026', '13-11-2026', '13.11.2026', '13112026', '13/11/26', ' 13 / 11 / 2026 ']) expect(typedToIso(t)).toBe('2026-11-13');
    expect(typedToIso('1/2/2027')).toBe('2027-02-01');
    expect(typedToIso('29/02/2028')).toBe('2028-02-29');
  });
  it('refuses what is not a real date', () => {
    for (const t of ['', '31/11/2026', '29/02/2027', '13/13/2026', '00/11/2026', '2026-11-13', 'today', '1311']) expect(typedToIso(t)).toBeNull();
  });
  it('adds the slashes while typing and shows a saved date back', () => {
    expect(typingDate('13', '1')).toBe('13/');
    expect(typingDate('13/11', '13/1')).toBe('13/11/');
    expect(typingDate('13', '13/')).toBe('13'); // deleting
    expect(typingDate('13/11/2026x', '13/11/2026')).toBe('13/11/2026');
    expect(isoToTyped('2026-11-13')).toBe('13/11/2026');
    expect(isoToTyped('')).toBe('');
  });
});
