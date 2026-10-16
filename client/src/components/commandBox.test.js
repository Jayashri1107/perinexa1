import { describe, expect, it } from 'vitest';
import { bookingDay, commandsFrom, matchCommands, patientTerm } from './commandBox.js';

// Doctor ideas #1: the one box for everything (16 Oct 2026). Today is Friday 16 Oct 2026.
const TODAY = '2026-10-16';

describe('the command box', () => {
  it('reads the day in "book …"', () => {
    expect(bookingDay('book today', TODAY)).toBe('2026-10-16');
    expect(bookingDay('book tomorrow', TODAY)).toBe('2026-10-17');
    expect(bookingDay('book Friday', TODAY)).toBe('2026-10-16');
    expect(bookingDay('book mon', TODAY)).toBe('2026-10-19');
    expect(bookingDay('book 21 Oct', TODAY)).toBe('2026-10-21');
    expect(bookingDay('book oct 2', TODAY)).toBe('2027-10-02'); // passed this year
    expect(bookingDay('book 31 feb', TODAY)).toBeNull();
    expect(bookingDay('Friday', TODAY)).toBeNull();
    expect(bookingDay('book', TODAY)).toBeNull();
  });

  it('searches a patient number alone when one is typed', () => {
    expect(patientTerm('P-000003 anaemia')).toBe('P-000003');
    expect(patientTerm('p000003')).toBe('P-000003');
    expect(patientTerm('Asha')).toBe('Asha');
  });

  it("offers the person's own pages, best first", () => {
    const modules = [
      { label: 'Billing', to: '/billing', tabs: [{ label: 'Bills', to: '/billing' }, { label: 'Unpaid', to: '/billing/unpaid' }] },
      { label: 'Patients', to: '/patients', tabs: [{ label: 'All patients', to: '/patients' }] },
    ];
    const cmds = commandsFrom(modules, [{ label: 'New patient – Pregnancy', to: '/patients/new/antenatal', keywords: 'new patient pregnancy' }]);
    expect(matchCommands('unpaid', cmds).map((c) => c.to)).toEqual(['/billing/unpaid']);
    expect(matchCommands('new preg', cmds).map((c) => c.to)).toEqual(['/patients/new/antenatal']);
    expect(matchCommands('bil', cmds)[0].to).toBe('/billing');
    expect(matchCommands('pharmacy', cmds)).toEqual([]); // not in this person's menu
  });
});
