// Sold's fixed side list of people billed, and the pharmacy bill in the layout of the store's earlier bill. Rendered to
// HTML (react-dom/server) from fake answers. Made-up names and numbers only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const answers = {};
let roles = ['pharmacist'];
vi.mock('../../hooks/useFetch.js', () => ({
  useFetch: (path) => ({ data: path ? (answers[path] ?? null) : null, loading: false, error: null, status: null, reload: () => {} }),
}));
vi.mock('../../auth/AuthContext.jsx', () => ({ useAuth: () => ({ activeMembership: { roles }, user: { name: 'Sample Pharmacist' } }) }));

const { BillPaper, InvoicesPage } = await import('./InvoicesPage.jsx');

const settings = { name: 'Sample Medical Stores', address: '4 Sample Road, Sample Town', phone: '99999 00000', gstin: '27ABCDE1234F1Z5', licence20: 'S-20-1', licence21: 'S-21-1', pharmacistName: 'Sample Pharmacist', place: 'Sample Town' };
const line = { id: 'l1', name: 'Sampleol 650', schedule: '', batch: 'B100', expiry: '2029-08-01', qty: 2, mrpPaise: 35000, amountPaise: 66500 };
const invoice = { id: 'i1', number: 'PH-000007', kind: 'sale', date: '2026-10-17T06:00:00Z', patient: { fullName: 'Sample Asha Kale', mrn: 'SH-0042' }, doctor: { name: 'Dr Sample Rao' }, lines: [line], totalPaise: 66500, returnedPaise: 0, paidPaise: null, byName: 'Sample Clerk' };
const paper = (v, s = settings) => renderToStaticMarkup(<BillPaper invoice={v} settings={s} />).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('the pharmacy bill', () => {
  it('has the earlier bill’s details and columns', () => {
    const text = paper(invoice);
    for (const part of ['Sample Medical Stores', 'D.L. No. S-20-1 S-21-1', 'GSTN No. 27ABCDE1234F1Z5', 'Mobile No. 99999 00000', 'Bill No PH-000007', 'Reg No SH-0042', 'Patient Name Sample Asha Kale', 'Type OPD Patient', 'Doctor Name Dr Sample Rao']) expect(text).toContain(part);
    expect(text).toMatch(/Sr\. Item Name Batch No Expiry Disc Amt Qty Amount/);
    expect(text).toContain('1 Sampleol 650 B100 Aug-2029 35.00 2.00 665.00');
    expect(text).toContain('Gross 665.00');
    expect(text).toContain('GET WELL SOON');
    expect(text).toContain('Subject to Sample Town Jurisdiction');
    expect(text).toContain('Pharmacist Sample Pharmacist');
  });

  it('never says a patient’s bill was paid here: it goes on the hospital bill', () => {
    const text = paper(invoice);
    expect(text).not.toContain('Paid Amount');
    expect(text).toContain('Payable at the billing desk');
  });

  it('shows what a walk-in paid, an IPD issue’s type, and no jurisdiction line without a city', () => {
    const walkIn = paper({ ...invoice, patient: null, customer: { name: 'Sample Walkin' }, paidPaise: 66500 }, { ...settings, place: '' });
    expect(walkIn).toContain('Type External');
    expect(walkIn).toContain('Paid Amount 665.00');
    expect(walkIn).not.toContain('Jurisdiction');
    expect(paper({ ...invoice, kind: 'issue' })).toContain('Type IPD Patient');
  });

  it('keeps the schedule mark on a medicine’s name', () => {
    expect(paper({ ...invoice, lines: [{ ...line, schedule: 'H1' }] })).toContain('Sampleol 650 (Sch. H1)');
  });
});

describe('Sold’s side list', () => {
  const page = () => renderToStaticMarkup(<MemoryRouter initialEntries={['/pharmacy/invoices']}><InvoicesPage /></MemoryRouter>);

  beforeEach(() => {
    roles = ['pharmacist'];
    answers['/pharmacy/invoices/people'] = { people: [{ key: 'p1', type: 'opd', name: 'Sample Asha Kale', mrn: 'SH-0042', phone: '', lastAt: '2026-10-17T06:00:00Z', billCount: 2, bills: [] }], more: false };
    answers['/pharmacy/invoices'] = { today: '2026-10-17', invoices: [] };
  });

  it('lists the people billed beside the day’s bills for the pharmacist', () => {
    const html = page();
    expect(html).toContain('Find by patient name');
    expect(html).toContain('Sample Asha Kale');
    expect(html).toContain('2 bills');
    expect(html).toContain('Pharmacy invoices');
  });

  it('is not shown to the hospital admin', () => {
    roles = ['admin'];
    expect(page()).not.toContain('Find by patient name');
  });
});
