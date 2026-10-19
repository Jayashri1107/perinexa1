// Billing → Accounts (the Tally link, docs/TALLY_PLAN.md): the batches page with its preview, one batch, the account
// names, the exceptions, the control sheet and the mark on a bill. The website has no browser test setup, so each
// screen is rendered to HTML (react-dom/server) from fake answers. Made-up names and numbers only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const answers = {};
vi.mock('../../hooks/useFetch.js', () => ({
  useFetch: (path) => ({ data: path ? (answers[path] ?? null) : null, loading: false, error: null, status: null, reload: () => {} }),
}));
vi.mock('../../auth/AuthContext.jsx', () => ({ useAuth: () => ({ activeMembership: { roles: ['admin'] }, user: { name: 'Sample Admin' } }) }));

const { TallyBatchPage, TallyBatchesPage, TallyControlPage, TallyExceptionsPage, TallyMarks, TallySettingsPage, VoucherActions } = await import('./TallyPage.jsx');

const words = (html) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const at = (path, route, node) =>
  words(
    renderToStaticMarkup(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={node} />
        </Routes>
      </MemoryRouter>,
    ),
  );
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const primaries = (html) => (html.match(/class="btn btn-primary"/g) ?? []).length;
// Brand rules every screen keeps: one primary button at most, no exclamation marks
const brand = (html) => {
  expect(primaries(html)).toBeLessThanOrEqual(1);
  expect(text(html)).not.toMatch(/!/);
};

const BID = 'b'.repeat(24);
const batch = { id: BID, number: 'TB-000001', from: '2026-09-01', to: '2026-09-28', vouchers: 5, amountPaise: 128136, byKind: { sales: 3, receipt: 2 }, masters: [{ name: 'Patients', parent: 'Sundry Debtors' }], voucherTypes: ['Perinexa Sales'], hasMastersFile: true, downloads: { all: 2, vouchers: 1, masters: 1 }, imported: null, createdByName: 'Sample Admin', createdAt: '2026-09-29T04:30:00.000Z' };
const voucher = (extra = {}) => ({
  id: 'v'.repeat(24),
  key: 'B-000001',
  kind: 'sales',
  kindLabel: 'Sales',
  date: '2026-09-28',
  amountPaise: 75000,
  status: 'exported',
  statusLabel: 'Waiting for Tally',
  batchNumber: 'TB-000001',
  batchId: BID,
  note: '',
  source: { model: 'Bill', id: 'a'.repeat(24), number: 'B-000001' },
  narration: 'Perinexa bill B-000001',
  lines: [
    { ledger: 'Patients', paise: 75000, side: 'dr' },
    { ledger: 'Consultation income', paise: 50000, side: 'cr' },
    { ledger: 'Lab test income', paise: 25000, side: 'cr' },
  ],
  handled: null,
  ...extra,
});
const settings = {
  companyName: 'Tally Hospital Books',
  booksFrom: '2026-09-01T00:00:00.000Z',
  inpatientIssues: 'taxable',
  ledgers: {
    income: { consultation: 'Consultation income', procedure: 'Procedure income', scan: 'Scan income', lab: 'Lab test income', inpatient: 'Inpatient income', medicine: 'Medicine income (hospital bill)', other: 'Other income' },
    modes: { cash: 'Cash', upi: 'Bank (UPI)', card: 'Bank (card)', insurance: 'Insurance receivable' },
    schemes: [{ scheme: 'PM-JAY', ledger: 'PM-JAY receivable' }],
    patients: 'Patients',
    counter: 'Pharmacy counter customers',
    deposits: 'Patient deposits',
    discount: 'Discount allowed',
    pharmacySales: { 5: 'Pharmacy sales 5%' },
    exemptIssues: 'Medicines to admitted patients (exempt)',
    outputCgst: 'Output CGST',
    outputSgst: 'Output SGST',
    inputCgst: 'Input CGST',
    inputSgst: 'Input SGST',
    inputIgst: 'Input IGST',
    purchaseReturns: 'Purchase returns',
  },
  voucherTypes: { sales: 'Perinexa Sales', receipt: 'Perinexa Receipt', payment: 'Perinexa Payment', creditNote: 'Perinexa Credit Note', debitNote: 'Perinexa Debit Note', journal: 'Perinexa Journal' },
  updatedByName: 'Sample Admin',
  updatedAt: '2026-09-29T04:00:00.000Z',
};

beforeEach(() => {
  for (const k of Object.keys(answers)) delete answers[k];
});

describe('Billing → Accounts', () => {
  it('the batches page: what the next batch holds, what stops it, the batches so far', () => {
    answers['/tally/batches'] = { batches: [batch], statuses: { exported: 5 }, today: '2026-09-29' };
    answers['/tally/preview'] = { from: '2026-09-29', to: '2026-09-28', lastBatch: { number: 'TB-000001', to: '2026-09-28' }, entries: 2, resend: 1, byKind: { credit_note: 2, debit_note: 1 }, amountPaise: 26498, problems: { blockers: [], warnings: ['1 stay bill (patients still in hospital) will go at discharge; its deposits go now.'] }, newLedgers: [{ name: 'Sample Distributors', parent: 'Sundry Creditors' }], newVoucherTypes: [], gstLedgers: ['Input CGST', 'Input SGST'] };
    const html = at('/billing/accounts', '/billing/accounts', <TallyBatchesPage />);
    brand(html);
    const t = text(html);
    expect(t).toMatch(/Prepare a batch/);
    expect(t).toMatch(/3 entries \(2 Credit note, 1 Debit note\), of which 1 sent again after Tally refused it · debits ₹264\.98/);
    expect(t).toMatch(/will go at discharge/);
    expect(t).toMatch(/Sample Distributors \(Sundry Creditors\)/);
    expect(t).toMatch(/Input CGST, Input SGST/);
    expect(t).toMatch(/Make the batch/);
    expect(t).toMatch(/TB-000001/);
    expect(t).toMatch(/5 waiting for Tally/);
    expect(t).not.toMatch(/Sample Mother|P-0000/);
  });

  it('the batches page with blockers: the button is off and the reasons are listed', () => {
    answers['/tally/batches'] = { batches: [], statuses: {}, today: '2026-09-29' };
    answers['/tally/preview'] = { from: null, to: '2026-09-28', lastBatch: null, entries: 0, resend: 0, byKind: {}, amountPaise: 0, problems: { blockers: ['Enter the Tally company’s name (Accounts → Account names).'], warnings: [] }, newLedgers: [], newVoucherTypes: [], gstLedgers: [] };
    const html = at('/billing/accounts', '/billing/accounts', <TallyBatchesPage />);
    brand(html);
    expect(text(html)).toMatch(/Before a batch can be made: Enter the Tally company’s name/);
    expect(html).toMatch(/class="btn btn-primary" disabled=""/);
    expect(text(html)).toMatch(/No batch yet/);
  });

  it('one batch: the files, the steps for the accountant, the entries with their lines and status actions', () => {
    answers[`/tally/batches/${BID}`] = { batch, vouchers: [voucher(), voucher({ id: 'w'.repeat(24), key: 'R-000001', kind: 'receipt', kindLabel: 'Receipt', amountPaise: 50000, lines: [{ ledger: 'Patients', paise: 50000, side: 'cr' }, { ledger: 'Cash', paise: 50000, side: 'dr' }] })], shown: 2, waiting: 2 };
    const html = at(`/billing/accounts/batches/${BID}`, '/billing/accounts/batches/:id', <TallyBatchPage />);
    brand(html);
    const t = text(html);
    expect(t).toMatch(/Batch TB-000001/);
    expect(t).toMatch(/Entries file/);
    expect(t).toMatch(/Account names file/);
    expect(t).toMatch(/Download for Tally \(one file\)/);
    expect(html.match(/btn btn-primary/g)).toHaveLength(1); // the one file is the main button
    expect(t).toMatch(/Import → Transactions, and choose the one file \(Download for Tally\) – it brings the 2 new account names first, then the entries/);
    expect(t).toMatch(/If Tally does not take the one file, use the two separate files instead: first Import → Masters/);
    expect(t).toMatch(/Downloads: one file 2, entries 1, account names 1/);
    expect(t).toMatch(/Mark the whole batch imported \(2 waiting\)/);
    expect(t).toMatch(/B-000001 Sales 28 Sep 2026 ₹750 Waiting for Tally TB-000001/);
    expect(t).toMatch(/R-000001 Receipt/);
  });

  it('the status actions: a refusal or a skip asks for a note first; an imported entry can only be marked refused', () => {
    const waiting = words(renderToStaticMarkup(<MemoryRouter><VoucherActions v={voucher()} /></MemoryRouter>));
    expect(text(waiting)).toMatch(/Imported Refused by Tally Skip/);
    expect(primaries(waiting)).toBe(0);
    const imported = words(renderToStaticMarkup(<MemoryRouter><VoucherActions v={voucher({ status: 'imported' })} /></MemoryRouter>));
    expect(text(imported)).toMatch(/Tally refused it after all/);
    expect(text(imported)).not.toMatch(/Skip/);
    const failed = words(renderToStaticMarkup(<MemoryRouter><VoucherActions v={voucher({ status: 'failed', note: 'Voucher totals do not match' })} /></MemoryRouter>));
    expect(text(failed)).toMatch(/Send again Skip Imported after all/);
  });

  it('the exceptions page lists refused, skipped and waiting entries', () => {
    answers['/tally/vouchers'] = { vouchers: [voucher({ status: 'failed', statusLabel: 'Refused by Tally', note: 'Voucher totals do not match' })], statuses: { failed: 1 } };
    const html = at('/billing/accounts/exceptions', '/billing/accounts/exceptions', <TallyExceptionsPage />);
    brand(html);
    const t = text(html);
    expect(t).toMatch(/Refused by Tally/);
    expect(t).toMatch(/Skipped/);
    expect(t).toMatch(/Waiting for Tally/);
    expect(t).toMatch(/same identifier \(Tally overwrites rather than doubles it/);
  });

  it('the account names: every section, the scheme rows, the GST note, one Save button', () => {
    answers['/tally/settings'] = { settings, canEdit: true };
    const html = at('/billing/accounts/settings', '/billing/accounts/settings', <TallySettingsPage />);
    brand(html);
    const t = text(html);
    expect(html).toContain('value="Tally Hospital Books"');
    expect(html).toContain('value="2026-09-01"');
    expect(t).toMatch(/Income accounts \(hospital bills, no GST\)/);
    expect(html).toContain('value="PM-JAY receivable"');
    expect(t).toMatch(/Pharmacy sales at 5% GST/);
    expect(t).toMatch(/Pharmacy sales at 18% GST/);
    expect(t).toMatch(/Perinexa never creates these in Tally/);
    expect(t).toMatch(/Last changed by Sample Admin/);
    expect(primaries(html)).toBe(1);
  });

  it('the control sheet: totals per account and the count of entries by status', () => {
    answers['/tally/control'] = { month: '2026-09', rows: [{ ledger: 'Cash', debitPaise: 50448, creditPaise: 0 }, { ledger: 'Patients', debitPaise: 77240, creditPaise: 75448 }], entries: 8, statuses: { exported: 2, imported: 6, failed: 0, skipped: 0 } };
    const html = at('/billing/accounts/control', '/billing/accounts/control', <TallyControlPage />);
    brand(html);
    const t = text(html);
    expect(t).toMatch(/8 entries dated in this month: 2 waiting for Tally, 6 imported/);
    expect(t).toMatch(/Patients ₹772\.40 ₹754\.48/);
    expect(t).toMatch(/Total ₹1,276\.88 ₹754\.48/);
  });

  it('the mark on a bill names the entries, their batch and status – and nothing when none was sent', () => {
    answers['/tally/marks'] = { marks: [{ key: 'B-000001', kind: 'sales', kindLabel: 'Sales', status: 'exported', statusLabel: 'Waiting for Tally', batchNumber: 'TB-000001', date: '2026-09-28', amountPaise: 75000 }, { key: 'B-000001/CN1', kind: 'credit_note', kindLabel: 'Credit note', status: 'exported', statusLabel: 'Waiting for Tally', batchNumber: '', date: '2026-09-30', amountPaise: 25000 }] };
    const html = words(renderToStaticMarkup(<MemoryRouter><TallyMarks model="bill" id={'a'.repeat(24)} /></MemoryRouter>));
    expect(text(html)).toMatch(/Sent to Tally: B-000001 \(Sales, TB-000001, Waiting for Tally\) · B-000001\/CN1 \(Credit note, next batch, Waiting for Tally\)/);
    answers['/tally/marks'] = { marks: [] };
    expect(renderToStaticMarkup(<MemoryRouter><TallyMarks model="bill" id={'a'.repeat(24)} /></MemoryRouter>)).toBe('');
  });
});
