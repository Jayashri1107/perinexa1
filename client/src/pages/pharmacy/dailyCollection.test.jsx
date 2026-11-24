// Reports → Sales collection as the Pharmacy Daily Collection (24 Nov 2026, after the pharmacy's earlier software's
// printed report): the four sections numbered on through, their sub totals, the money by mode, the net collection and
// the sale types – on the paper and in the file for Excel. Made-up names and numbers only.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DailyCollectionPaper, dailyCsv, dcPeriod } from './MisReports.jsx';

const words = (html) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const text = (html) => words(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const SETTINGS = { name: 'Sample Medical Stores', address: '4 Sample Road, Sample Town', phone: '99999 00000', gstin: '', licence20: '', licence21: '' };
const zero = { netPaise: 0, cashPaise: 0, chequePaise: 0, cardPaise: 0, neftPaise: 0, upiPaise: 0, advancePaise: 0 };
const row = (saleNumber, mrn, name, money) => ({ invoiceId: saleNumber, date: '2026-11-23', saleNumber, mrn, name, ...zero, ...money });
const section = (key, title, rows) => ({ key, title, rows, total: Object.fromEntries(Object.keys(zero).map((k) => [k, rows.reduce((n, r) => n + r[k], 0)])) });
const DAILY = {
  title: 'Pharmacy Daily Collection',
  sections: [
    section('cash-sales', 'Cash Sales', [row('PH-000101', '', 'Sample Walk In', { netPaise: 50000, cashPaise: 50000 }), row('PH-000106', 'SH-0002', 'Sample Meera Patil', { netPaise: 80000, cashPaise: 50000, advancePaise: 30000 })]),
    section('cash-sales-return', 'Cash Sales Return', [row('CN-000007', '', 'Sample Walk In', { netPaise: 15000, cashPaise: 15000 })]),
    section('credit-sale', 'Credit Sale', [row('PH-000102', 'SH-0001', 'Sample Asha Kale', { netPaise: 20000 })]),
    section('due-collection', 'Due Collection', []),
  ],
  modes: [
    { mode: 'cash', salesPaise: 100000, returnPaise: 15000, advancePaise: 100000, advanceRefundPaise: 0, netPaise: 185000 },
    { mode: 'cheque', salesPaise: 0, returnPaise: 0, advancePaise: 0, advanceRefundPaise: 0, netPaise: 0 },
    { mode: 'card', salesPaise: 0, returnPaise: 0, advancePaise: 0, advanceRefundPaise: 0, netPaise: 0 },
    { mode: 'neft', salesPaise: 0, returnPaise: 0, advancePaise: 0, advanceRefundPaise: 0, netPaise: 0 },
    { mode: 'upi', salesPaise: 0, returnPaise: 0, advancePaise: 0, advanceRefundPaise: 20000, netPaise: -20000 },
  ],
  saleTypes: [
    { key: 'cash-sales', label: 'Cash Sales', paise: 130000 },
    { key: 'cash-sales-return', label: 'Cash Sales Return', paise: 15000 },
    { key: 'credit-sale', label: 'Credit Sale', paise: 20000 },
    { key: 'due-collection', label: 'Due Collection', paise: 0 },
  ],
  summary: { salesPaise: 100000, returnPaise: 15000, advancePaise: 100000, advanceRefundPaise: 20000, netCollectionPaise: 165000, advanceUsedPaise: 30000 },
};

describe('the Pharmacy Daily Collection on paper', () => {
  const paper = text(renderToStaticMarkup(<DailyCollectionPaper daily={DAILY} from="2026-11-23" to="2026-11-23" settings={SETTINGS} printedAt="Printed 24 Nov 2026, 09:53" />));

  it('has the store’s heading, the title, the day on the left and when it was printed on the right', () => {
    expect(paper).toMatch(/^ ?SAMPLE MEDICAL STORES|Sample Medical Stores/);
    expect(paper).toContain('Pharmacy Daily Collection 23 Nov 2026 Printed 24 Nov 2026, 09:53');
    expect(dcPeriod('2026-11-01', '2026-11-23')).toBe('1 Nov 2026 to 23 Nov 2026');
  });

  it('the earlier paper’s columns, four sections numbered on through, each with its sub total', () => {
    expect(paper).toContain('Sr. No Date Sales no MR No Patient name Net amount Cash Cheque Card NEFT UPI Adv. use amount');
    expect(paper).toContain('Cash Sales 1 23 Nov 2026 PH-000101 – Sample Walk In 500.00 500.00 0.00 0.00 0.00 0.00 0.00');
    expect(paper).toContain('2 23 Nov 2026 PH-000106 SH-0002 Sample Meera Patil 800.00 500.00 0.00 0.00 0.00 0.00 300.00');
    expect(paper).toContain('Sub total 1,300.00 1,000.00 0.00 0.00 0.00 0.00 300.00');
    expect(paper).toContain('Cash Sales Return 3 23 Nov 2026 CN-000007');
    expect(paper).toContain('Credit Sale 4 23 Nov 2026 PH-000102 SH-0001 Sample Asha Kale 200.00 0.00');
    expect(paper).toContain('Due Collection None in this period. Sub total 0.00');
  });

  it('then the money by mode, the net collection, the amounts and the sale types', () => {
    expect(paper).toContain('Sales Sales return Advance Advance refund Cash 1,000.00 150.00 1,000.00 0.00');
    expect(paper).toContain('UPI Transaction 0.00 0.00 0.00 200.00 Total 1,000.00 150.00 1,000.00 200.00');
    expect(paper).toContain('Net collection 1,650.00');
    expect(paper).toContain('CASH AMT 1,850.00 CARD AMT 0.00 NEFT AMT 0.00 UPI AMT -200.00');
    expect(paper).not.toContain('CHEQUE AMT'); // only when a cheque came in, as on the earlier paper
    expect(paper).toContain('Sale type Total Cash Sales 1,300.00 Cash Sales Return 150.00 Credit Sale 200.00 Due Collection 0.00');
    expect(paper).not.toMatch(/!/);
  });

  it('the same for Excel: each row with its section, the sub totals, the modes and the sale types', () => {
    const csv = dailyCsv(DAILY, { from: '2026-11-23', to: '2026-11-23' }).split('\r\n');
    expect(csv[0]).toBe('﻿Pharmacy Daily Collection,23 Nov 2026');
    expect(csv[1]).toBe('Section,Sr. No,Date,Sales no,MR No,Patient name,Net amount,Cash,Cheque,Card,NEFT,UPI,Adv. use amount');
    expect(csv[2]).toBe('Cash Sales,1,23 Nov 2026,PH-000101,,Sample Walk In,500.00,500.00,0.00,0.00,0.00,0.00,0.00');
    expect(csv).toContain('Cash Sales,,,,,Sub total,1300.00,1000.00,0.00,0.00,0.00,0.00,300.00');
    expect(csv).toContain('UPI Transaction,0.00,0.00,0.00,200.00,-200.00');
    expect(csv).toContain('Net collection,,,,,1650.00');
    expect(csv).toContain('Credit Sale,200.00');
  });
});
