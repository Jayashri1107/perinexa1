import { describe, expect, it } from 'vitest';
import { adminChargeOf, advanceTotal, billTitle, linesByDate, stayStep, summaryByGroup } from './ipdFormat.js';

const line = (group, amountPaise, addedAt, extra = {}) => ({ id: `${group}-${amountPaise}`, group, amountPaise, addedAt, ...extra });

describe('the IPD desk', () => {
  it('follows the HIMS order: in hospital, card signed, discharge recorded, final bill, cleared', () => {
    expect(stayStep({ status: 'admitted' }, {}).key).toBe('in');
    expect(stayStep({ status: 'discharged', discharge: null }, {}).key).toBe('card');
    expect(stayStep({ status: 'discharged', discharge: { type: 'normal' } }, { final: null }).key).toBe('recorded');
    expect(stayStep({ status: 'discharged', discharge: { type: 'normal' } }, { final: { byName: 'x' } }).key).toBe('final');
    expect(stayStep({ status: 'discharged', cleared: true }, { final: { byName: 'x' } }).key).toBe('cleared');
    // every step says it with a word and an icon, not colour alone
    expect(stayStep({ status: 'admitted' }, {})).toMatchObject({ label: 'In hospital', icon: expect.anything() });
  });

  it('names the printed bill', () => {
    expect(billTitle({ status: 'admitted' }, {})).toBe('Interim bill');
    expect(billTitle({ status: 'discharged' }, { final: null })).toBe('Draft bill – not final');
    expect(billTitle({ status: 'discharged' }, { final: { byName: 'x' } })).toBe('Final bill');
  });

  it('groups items by date and by group, and adds up advances and the administrative charges', () => {
    const lines = [line('inpatient', 300000, '2026-11-08T14:00:00'), line('lab', 50000, '2026-11-09T09:00:00'), line('other', 20000, '2026-11-08T15:00:00', { key: 'admin-charge' })];
    expect(linesByDate(lines).map((d) => [d.day, d.lines.length, d.amountPaise])).toEqual([
      ['2026-11-08', 2, 320000],
      ['2026-11-09', 1, 50000],
    ]);
    expect(summaryByGroup(lines).map((g) => [g.label, g.amountPaise])).toEqual([
      ['Lab test', 50000],
      ['Inpatient', 300000],
      ['Other', 20000],
    ]);
    expect(advanceTotal([{ kind: 'deposit', amountPaise: 1000 }, { kind: 'refund', amountPaise: 300 }])).toBe(700);
    expect(adminChargeOf([...lines, line('other', 10000, '2026-11-08', { key: 'admin-charge', removed: { reason: 'changed' } })])).toBe(20000);
  });
});
