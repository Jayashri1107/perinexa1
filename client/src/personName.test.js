// Names capitalised while typing (24 Oct 2026) – the same rule as the server's (server/tests/person-names.test.js)
import { describe, expect, it } from 'vitest';
import { asName, capitalizeName } from './personName.js';

describe('a name as it is typed', () => {
  it('every word starts with a capital; the rest stays as typed', () => {
    expect(capitalizeName('jayashri sable')).toBe('Jayashri Sable');
    expect(capitalizeName('asha  patil ')).toBe('Asha  Patil ');
    expect(capitalizeName('mcDonald a.k. walk-in')).toBe('McDonald A.k. Walk-in');
    expect(capitalizeName('baby of asha patil')).toBe('Baby of Asha Patil');
    expect(capitalizeName('of asha')).toBe('Of Asha');
    expect(capitalizeName('आशा पाटील')).toBe('आशा पाटील');
  });
  it('the box shows the capital and the cursor stays where it was', () => {
    let range = null;
    const box = { value: 'asha patil', selectionStart: 3, selectionEnd: 3, setSelectionRange: (a, b) => (range = [a, b]) };
    let seen = null;
    asName((e) => (seen = e.target.value))({ target: box });
    expect(box.value).toBe('Asha Patil');
    expect(seen).toBe('Asha Patil');
    expect(range).toEqual([3, 3]);
  });
});
