import { describe, expect, it } from 'vitest';
import { misCell, misCsv } from './MisReports.jsx';

// Pharmacy → Reports → Report list (13 Nov 2026): the cells as shown, and the file for Excel.
describe('the pharmacy report list', () => {
  it('shows money in rupees, dates as 13 Nov 2026, a dash for no amount', () => {
    expect(misCell('date', '2026-11-13')).toBe('13 Nov 2026');
    expect(misCell('money', null)).toBe('—');
    expect(misCell('text', '')).toBe('');
    expect(misCell('num', 3)).toBe('3');
  });
  it('makes a CSV for Excel: rupees as plain numbers, quotes where needed, no formulas, the total last', () => {
    const csv = misCsv({
      columns: [
        { k: 'date', label: 'Date', type: 'date' },
        { k: 'name', label: 'Customer', type: 'text' },
        { k: 'amount', label: 'Amount', type: 'money' },
      ],
      rows: [
        { date: '2026-11-13', name: 'Sample, Walk In', amount: 123450 },
        { date: '2026-11-13', name: '=SUM(A1)', amount: 50 },
      ],
      total: { date: '2 bills', amount: 123500 },
    });
    expect(csv.split('\r\n')).toEqual(['﻿Date,Customer,Amount', '13 Nov 2026,"Sample, Walk In",1234.50', "13 Nov 2026,'=SUM(A1),0.50", '2 bills,,1235.00', '']);
  });
});

describe('the report form', () => {
  it('reads the expiry month as typed on the pack', async () => {
    const { typedMonth } = await import('./MisReports.jsx');
    expect(typedMonth('08/27')).toBe('2027-08');
    expect(typedMonth('8/2028')).toBe('2028-08');
    expect(typedMonth('13/27')).toBeNull();
    expect(typedMonth('aug')).toBeNull();
  });
});
