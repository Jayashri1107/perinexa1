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

const { BillPaper, InvoicesPage, PeopleFound, billFits } = await import('./InvoicesPage.jsx');
const { ChoiceBox, DOSE_CHOICES, SellPage } = await import('./SellPage.jsx');

const settings = { name: 'Sample Medical Stores', address: '4 Sample Road, Sample Town', phone: '99999 00000', gstin: '27ABCDE1234F1Z5', licence20: 'S-20-1', licence21: 'S-21-1', pharmacistName: 'Sample Pharmacist', place: 'Sample Town' };
const line = { id: 'l1', name: 'Sampleol 650', schedule: '', batch: 'B100', expiry: '2029-08-01', qty: 2, mrpPaise: 35000, amountPaise: 66500 };
const invoice = { id: 'i1', number: 'PH-000007', kind: 'sale', date: '2026-10-17T06:00:00Z', patient: { fullName: 'Sample Asha Kale', mrn: 'SH-0042' }, doctor: { name: 'Dr Sample Rao' }, lines: [line], totalPaise: 66500, returnedPaise: 0, paidPaise: null, byName: 'Sample Clerk' };
const paper = (v, s = settings) => renderToStaticMarkup(<BillPaper invoice={v} settings={s} />).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('the pharmacy bill', () => {
  it('has the earlier bill’s details and columns', () => {
    const text = paper(invoice);
    for (const part of ['Sample Medical Stores', 'D.L. No. S-20-1 S-21-1', 'GSTN No. 27ABCDE1234F1Z5', 'Mobile No. 99999 00000', 'Bill No PH-000007', 'Reg No SH-0042', 'Patient Name Sample Asha Kale', 'Type OPD Patient', 'Doctor Name Dr Sample Rao']) expect(text).toContain(part);
    expect(text).toMatch(/Sr\. Item Name Batch No Expiry MRP Disc Amt Qty Amount/);
    expect(text).toContain('1 Sampleol 650 B100 Aug-2029 350.00 35.00 2.00 665.00');
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

describe('which bills fit Sold’s filters', () => {
  const patientBill = { kind: 'sale', patient: { fullName: 'Sample Asha Kale' }, doctor: { name: 'Dr Sample Rao' }, netPaise: 120000, payments: [] };
  const issue = { kind: 'issue', patient: { fullName: 'Sample Rani More' }, netPaise: 12050, payments: [] };
  const walkIn = { kind: 'sale', patient: null, customer: { name: 'Sample Walkin' }, netPaise: 50000, payments: [{ mode: 'upi' }] };
  const fits = (f) => [patientBill, issue, walkIn].filter((v) => billFits(v, f));

  it('fits by type, doctor, amount and how it was paid, and all of them together', () => {
    expect(fits({})).toHaveLength(3);
    expect(fits({ type: 'opd' })).toEqual([patientBill]);
    expect(fits({ type: 'ipd' })).toEqual([issue]);
    expect(fits({ type: 'external' })).toEqual([walkIn]);
    expect(fits({ doctor: 'Dr Sample Rao' })).toEqual([patientBill]);
    expect(fits({ amount: '12' })).toEqual([patientBill, issue]);
    expect(fits({ amount: '120.5' })).toEqual([issue]);
    expect(fits({ paidBy: 'upi' })).toEqual([walkIn]);
    expect(fits({ paidBy: 'hospital' })).toEqual([patientBill, issue]);
    expect(fits({ paidBy: 'hospital', amount: '12', type: 'ipd' })).toEqual([issue]);
    expect(fits({ paidBy: 'cash' })).toEqual([]);
  });
});

describe('Sold’s filters', () => {
  const page = () => renderToStaticMarkup(<MemoryRouter initialEntries={['/pharmacy/invoices']}><InvoicesPage /></MemoryRouter>);

  beforeEach(() => {
    roles = ['pharmacist'];
    answers['/pharmacy/invoices/people'] = { people: [{ key: 'p1', type: 'opd', name: 'Sample Asha Kale', mrn: 'SH-0042', phone: '', lastAt: '2026-10-17T06:00:00Z', billCount: 2, bills: [] }], more: false };
    answers['/pharmacy/invoices/doctors'] = { doctors: ['Dr Sample Rao'] };
    answers['/pharmacy/invoices'] = { today: '2026-10-17', invoices: [] };
  });

  it('shows the filters at the side with the day’s bills beside them, no filter button, and no patient until a search', () => {
    const html = page();
    expect(html).toContain('ph-sold-split');
    expect(html.indexOf('Find bills')).toBeLessThan(html.indexOf('ph-sold-results'));
    expect(html).not.toMatch(/>\s*(Filter|Apply|Search)\s*</);
    expect(html).not.toContain('Clear the filters');
    for (const part of ['Patient number', 'Patient name', 'Doctor name', 'Dr Sample Rao', 'External', 'Amount ₹', 'Paid by', 'On the hospital bill', 'Pharmacy invoices']) expect(html).toContain(part);
    expect(html).not.toContain('Sample Asha Kale');
  });

  it('lists people found, each opening a new bill; those with bills also have their Bills', () => {
    const people = [
      { key: 'p1', type: 'opd', name: 'Sample Asha Kale', mrn: 'SH-0042', phone: '', lastAt: '2026-10-17T06:00:00Z', billCount: 2, bills: [{ id: 'i1', number: 'PH-000007', at: '2026-10-17T06:00:00Z' }] },
      { key: 'p2', type: '', name: 'Sample Mira Unbilled', mrn: 'SH-0043', phone: '', lastAt: null, billCount: 0, bills: [] },
    ];
    const html = renderToStaticMarkup(<MemoryRouter><PeopleFound found={{ data: { people } }} people={people} onPick={() => {}} onBills={() => {}} /></MemoryRouter>);
    for (const part of ['Click a name to make a new bill', 'Sample Asha Kale', '2 bills', 'Bills of Sample Asha Kale', 'Sample Mira Unbilled', 'No pharmacy bill yet']) expect(html).toContain(part);
    expect(html).not.toContain('Bills of Sample Mira Unbilled');
  });

  it('the bill inside Sold: no page header or type buttons; dose, MRP and amount columns', () => {
    const bill = renderToStaticMarkup(<MemoryRouter><SellPage kind="issue" start={{ patient: { id: 'p9', fullName: 'Sample Rekha Shinde', mrn: 'SH-0050' } }} embedded onMade={() => {}} onCancel={() => {}} /></MemoryRouter>);
    expect(bill).toContain('Sample Rekha Shinde');
    expect(bill).not.toContain('Issue to an admitted patient');
    expect(bill).not.toContain('aria-label="Type of patient"');
    const walkIn = renderToStaticMarkup(<MemoryRouter><SellPage start={{ type: 'external', customer: { name: 'Sample Walk Customer', phone: '' } }} embedded onMade={() => {}} /></MemoryRouter>);
    expect(walkIn).toContain('value="Sample Walk Customer"');
  });

  it('the dose box offers the prescription frequencies to choose from', () => {
    expect(DOSE_CHOICES).toEqual(expect.arrayContaining(['1-0-1 (twice a day)', '1-0-0 (morning)', '0-0-1 (night)', 'SOS (when needed)', 'STAT (once, now)', 'Weekly', 'Alternate days']));
    expect(DOSE_CHOICES.some((d) => /custom/i.test(d))).toBe(false);
    // A real drop-down: the choices, and a way to type another; a dose not on the list shows as typed
    const box = renderToStaticMarkup(<ChoiceBox label="Dose" value="" choices={DOSE_CHOICES} placeholder="No dose" ownLabel="Type another dose…" onChange={() => {}} />);
    for (const part of ['<select', 'No dose', '1-0-1 (twice a day)', 'Type another dose…']) expect(box).toContain(part);
    const own = renderToStaticMarkup(<ChoiceBox label="Dose" value="1 tablet at bedtime" choices={DOSE_CHOICES} placeholder="No dose" onChange={() => {}} />);
    expect(own).toContain('value="1 tablet at bedtime"');
    expect(own).not.toContain('<select');
  });

  it('the printed bill shows a Dose column when a medicine has one', () => {
    const text = paper({ ...invoice, lines: [{ ...line, dose: '1-0-1 after food' }] });
    expect(text).toMatch(/Sr\. Item Name Dose Batch No/);
    expect(text).toContain('Sampleol 650 1-0-1 after food B100');
    expect(paper(invoice)).not.toMatch(/Item Name Dose/);
  });

  it('is not shown to the hospital admin', () => {
    roles = ['admin'];
    const html = page();
    expect(html).not.toContain('Doctor name');
    expect(html).toContain('Pharmacy invoices');
  });
});
