// Billing → Reports: a report downloaded for Excel (fake sample data).
import { describe, expect, it } from 'vitest';
import { reportCsv } from './MisReportsPage.jsx';

describe('a report for Excel', () => {
  it('has the title, the columns, the rows in rupees and the totals – and never a formula', () => {
    const csv = reportCsv({
      title: 'Daily collection',
      from: '2026-10-27',
      to: '2026-10-27',
      columns: [{ key: 'patient', label: 'Patient' }, { key: 'amount', label: 'Amount', money: true }],
      rows: [{ patient: '=Sample Asha', amount: 30000 }],
      totals: { amount: 30000 },
    });
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    expect(lines).toEqual(['Daily collection,2026-10-27 to 2026-10-27', 'Patient,Amount', "'=Sample Asha,300.00", 'Total,300.00']);
  });
});
