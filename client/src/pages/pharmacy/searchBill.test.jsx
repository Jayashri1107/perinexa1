// Pharmacy → Search bill (23 Nov 2026): what Show asks the server for, the words and sums of the printed list, and the
// screen itself – rendered to HTML (react-dom/server) from fake answers, as the other pharmacy screens are tested.
// Made-up names and numbers only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const answers = {};
vi.mock('../../hooks/useFetch.js', () => ({
  useFetch: (path) => ({ data: path ? (answers[path] ?? null) : null, loading: false, error: null, status: null, reload: () => {} }),
}));
vi.mock('../../auth/AuthContext.jsx', () => ({ useAuth: () => ({ activeMembership: { roles: ['pharmacist'] }, user: { name: 'Sample Pharmacist' } }) }));

const { BillItems, BillListDocument, SearchBillPage } = await import('./SearchBillPage.jsx');
const { admittedSearch, amount, filterWords, ipBills, isSearch, newSearch, noBillsWords, periodWords, searchProblem, searchQuery, sumBills, yearBefore } = await import('./searchBill.js');

const words = (html) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const text = (html) => words(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const page = (state = null) => renderToStaticMarkup(<MemoryRouter initialEntries={[{ pathname: '/pharmacy/search-bill', state }]}><SearchBillPage /></MemoryRouter>);

const SETTINGS = { name: 'Sample Medical Stores', address: '4 Sample Road, Sample Town', phone: '99999 00000', gstin: '27ABCDE1234F1Z5', licence20: 'S-20-1', licence21: 'S-21-1', pharmacistName: 'Sample Pharmacist', place: 'Sample Town' };
const line = { id: 'l1', name: 'Sample Folic 5', batch: 'F1', expiry: '2028-06-30', mrpPaise: 200, qty: 3, returnedQty: 1, amountPaise: 540 };
const opd = { id: 'i1', number: 'PH-000007', date: '2026-11-21T08:48:25Z', type: 'opd', mrn: 'SH-0042', name: 'Sample Asha Kale', discPaise: 200, netPaise: 14000, paidPaise: 14000, balPaise: 0, onHospitalBill: false, lines: [line] };
const walkIn = { id: 'i2', number: 'PH-000008', date: '2026-11-21T09:10:00Z', type: 'external', mrn: '', name: 'Sample Walk In', discPaise: 0, netPaise: 4000, paidPaise: 4000, balPaise: 0, onHospitalBill: false, lines: [line] };
const ward = { id: 'i3', number: 'PH-000009', date: '2026-11-21T10:00:00Z', type: 'ipd', mrn: 'SH-0050', name: 'Sample Meera Patil', discPaise: 1900, netPaise: 40000, paidPaise: 0, balPaise: 40000, onHospitalBill: true, lines: [line] };
const found = (extra = {}) => ({ bills: [ward, walkIn, opd], totals: { count: 3, salesPaise: 58000, receivedPaise: 18000, creditPaise: 40000, hospitalPaise: 40000 }, more: false, limit: 1000, settings: SETTINGS, ...extra });

beforeEach(() => {
  for (const k of Object.keys(answers)) delete answers[k];
});

describe('what Show asks the server for', () => {
  it('opens on today’s bills: every type, Date ticked, cash and credit', () => {
    expect(searchQuery(newSearch('2026-11-21'))).toEqual({ from: '2026-11-21', to: '2026-11-21' });
  });

  it('sends only the parts that are ticked and filled in, without the spaces around them', () => {
    const all = { type: 'ipd', byName: true, first: ' asha ', last: ' kale', byMrn: true, mrn: ' SH-0042 ', byNumber: true, number: ' PH-000007 ', byDate: true, from: '2026-11-01', to: '2026-11-21', item: ' folic ', pay: 'credit' };
    expect(searchQuery(all)).toEqual({ type: 'ipd', first: 'asha', last: 'kale', mrn: 'SH-0042', number: 'PH-000007', from: '2026-11-01', to: '2026-11-21', item: 'folic', pay: 'credit' });
    // A part typed but not ticked is not used; a part ticked but empty is not sent
    expect(searchQuery({ ...all, byName: false, byMrn: false, byNumber: false, byDate: false })).toEqual({ type: 'ipd', item: 'folic', pay: 'credit' });
    expect(searchQuery({ ...all, first: ' ', last: '', mrn: '', number: '  ', item: '', type: 'all', pay: 'all' })).toEqual({ from: '2026-11-01', to: '2026-11-21' });
    expect(searchQuery({ ...newSearch('2026-11-21'), byDate: false })).toEqual({}); // every bill, newest first
  });

  it('stops a To date before the From date, and dates more than a year apart', () => {
    const f = newSearch('2026-11-21');
    expect(searchProblem(f)).toBeNull();
    expect(searchProblem({ ...f, from: '2026-11-22' })).toBe('The To date is before the From date.');
    expect(yearBefore('2026-11-21')).toBe('2025-11-20');
    expect(searchProblem({ ...f, from: '2025-11-20' })).toBeNull();
    expect(searchProblem({ ...f, from: '2025-11-19' })).toBe('Choose dates at most one year apart.');
    expect(searchProblem({ ...f, from: '2020-01-01', byDate: false })).toBeNull(); // the dates are not used
  });

  it('Current admitted list: a patient chosen lists the IPD bills of the stay, by UHID, from the admission day', () => {
    const stay = { patient: { id: 'p1', fullName: 'Sample Meera Patil', mrn: 'SH-0050' }, ward: 'Labour room', bed: '2', admittedAt: '2026-11-18T12:00:00Z' };
    const f = admittedSearch(stay, '2026-11-21');
    expect(f).toMatchObject({ type: 'ipd', byMrn: true, mrn: 'SH-0050', byName: false, byNumber: false, byDate: true, from: '2026-11-18', to: '2026-11-21', pay: 'all' });
    expect(searchQuery(f)).toEqual({ type: 'ipd', mrn: 'SH-0050', from: '2026-11-18', to: '2026-11-21' });
    // Never past today, never more than the year the server searches at once
    expect(admittedSearch({ ...stay, admittedAt: '2026-12-25T12:00:00Z' }, '2026-11-21').from).toBe('2026-11-21');
    expect(admittedSearch({ ...stay, admittedAt: '2024-01-01T12:00:00Z' }, '2026-11-21').from).toBe('2025-11-20');
    expect(admittedSearch({ ...stay, admittedAt: null }, '2026-11-21').from).toBe('2026-11-21');
  });
});

describe('the words and sums of the printed list', () => {
  it('says the dates and the other parts of the search', () => {
    expect(periodWords({ from: '2026-11-21', to: '2026-11-21' })).toBe('21 Nov 2026');
    expect(periodWords({ from: '2026-11-01', to: '2026-11-21' })).toBe('1 Nov 2026 to 21 Nov 2026');
    expect(periodWords({})).toBe('All dates');
    expect(filterWords({ from: '2026-11-21', to: '2026-11-21' })).toBe('');
    expect(filterWords({ type: 'ipd', pay: 'credit', first: 'asha', last: 'kale', mrn: 'SH-0042', number: 'PH-000007', item: 'folic' })).toBe('IPD bills · Credit · Name: asha kale · UHID: SH-0042 · Sales no: PH-000007 · Item: folic');
    // No bill fits: the list says what was searched (23 Nov 2026)
    expect(noBillsWords({ type: 'ipd', from: '2026-11-23', to: '2026-11-23' })).toBe('No bills match: IPD bills · 23 Nov 2026. Change the search and press Show.');
    expect(noBillsWords({})).toBe('No bills match: all bills · All dates. Change the search and press Show.');
  });

  it('writes amounts as on the bill, and adds the bills up: sales = received + credit', () => {
    expect([130861, 14000, 0, 5].map(amount)).toEqual(['1,308.61', '140.00', '0.00', '0.05']);
    expect(sumBills([opd, walkIn, ward])).toEqual({ count: 3, salesPaise: 58000, receivedPaise: 18000, creditPaise: 40000, hospitalPaise: 40000 });
    expect(sumBills([])).toEqual({ count: 0, salesPaise: 0, receivedPaise: 0, creditPaise: 0, hospitalPaise: 0 });
  });

  it('IP bill summary takes the listed IPD bills of the clicked bill’s patient only', () => {
    const earlier = { ...ward, id: 'i4', number: 'PH-000002' };
    const another = { ...ward, id: 'i5', mrn: 'SH-0051', name: 'Sample Other Patient' };
    expect(ipBills([ward, walkIn, opd, earlier, another], ward).map((r) => r.id)).toEqual(['i3', 'i4']);
    expect(ipBills([ward, walkIn, opd], opd)).toEqual([]); // not an IPD bill
    expect(ipBills([ward, walkIn, opd], walkIn)).toEqual([]);
    expect(ipBills([ward], null)).toEqual([]);
  });

  it('prints the store’s heading, what was searched, each bill and the sums', () => {
    const shown = text(renderToStaticMarkup(<BillListDocument title="Sales bills" facts={['21 Nov 2026', '', 'IPD bills']} rows={[ward, walkIn, opd]} settings={SETTINGS} />));
    expect(shown).toContain('Sample Medical Stores');
    expect(shown).toContain('Sales bills 21 Nov 2026 IPD bills');
    expect(shown).toMatch(/Sales date Sales no UHID Patient name Disc amt Net amt Received amt Bal amt/);
    expect(shown).toContain('PH-000007 SH-0042 Sample Asha Kale 2.00 140.00 140.00 0.00');
    expect(shown).toContain('3 bills 21.00 580.00 180.00 400.00');
    expect(shown).toContain('Of the balance, 400.00 is on hospital bills, paid at the billing desk.');
    expect(text(renderToStaticMarkup(<BillListDocument title="IP bill summary" rows={[opd]} settings={SETTINGS} />))).toContain('1 bill 2.00 140.00 140.00 0.00');
  });
});

describe('the Search bill screen', () => {
  it('has the boxes of the earlier window, in its order, with today’s search ticked', () => {
    answers['/pharmacy/bill-search'] = found();
    const html = page();
    const shown = text(html);
    expect(shown).toMatch(/Patient type OPD IPD External All Patient name First name Last name UHID Sales no Date From date To date Item name Cash or credit Cash Credit All Show Total count 3/);
    expect(shown).toContain('Double-click a bill to print it again.');
    // Every type and "cash and credit" to begin with; only Date is ticked
    const checked = (name) => (words(html).match(new RegExp(`<input[^>]*name="${name}"[^>]*>`, 'g')) ?? []).filter((tag) => /\schecked=""/.test(tag));
    expect(checked('sb-type')).toHaveLength(1);
    expect(checked('sb-type')[0]).toContain('value="all"');
    expect(checked('sb-pay')[0]).toContain('value="all"');
    const panel = html.slice(html.indexOf('<form'), html.indexOf('</form>'));
    expect((panel.match(/type="checkbox"[^>]*\schecked=""|\schecked=""[^>]*type="checkbox"/g) ?? []).length).toBe(1);
    // Brand: one primary button (Show), no exclamation marks
    expect((html.match(/class="btn btn-primary[^"]*"/g) ?? []).length).toBe(1);
    expect(shown).not.toMatch(/!/);
  });

  it('lists the bills with the earlier window’s columns, the sums under them and the list’s buttons', () => {
    answers['/pharmacy/bill-search'] = found();
    const shown = text(page());
    expect(shown).toMatch(/Sales date Sales no UHID Patient name Disc amt Net amt Bal amt/);
    expect(shown).toContain('PH-000007 SH-0042 Sample Asha Kale 2.00 140.00 0.00');
    expect(shown).toContain('PH-000008 – Sample Walk In 0.00 40.00 0.00'); // a walk-in has no UHID
    expect(shown).toContain('PH-000009 SH-0050 Sample Meera Patil 19.00 400.00 400.00 on hospital bill');
    expect(shown).toContain('Total sales amt 580.00 Received amt 180.00 Credit amount 400.00 Credit on hospital bills 400.00');
    expect(shown).toMatch(/Direct print Current admitted list IP bill summary Print list Close/);
    // No bill clicked yet: its medicines are not shown, and the IP bill summary waits for an IPD bill
    expect(shown).toContain('Click a bill to see its medicines.');
    // Every bill in the one scrolling grid: no page bar under it
    expect(shown).not.toMatch(/Rows per page|Showing \d/);
    expect(shown).toContain('IP bill summary: click an IPD patient’s bill first');
    expect(shown).not.toContain('The newest');
  });

  it('says when more bills fit than are listed, and shows no sums before the first answer', () => {
    answers['/pharmacy/bill-search'] = found({ more: true });
    expect(text(page())).toContain('The newest 1,000 bills are listed and added up.');
    delete answers['/pharmacy/bill-search'];
    const waiting = text(page());
    expect(waiting).toContain('Total count …');
    expect(waiting).not.toContain('Total sales amt');
    answers['/pharmacy/bill-search'] = found({ bills: [], totals: { count: 0, salesPaise: 0, receivedPaise: 0, creditPaise: 0, hospitalPaise: 0 } });
    const none = text(page());
    expect(none).toMatch(/No bills match: all bills · \d{1,2} \w{3} \d{4}\. Change the search and press Show\./);
    expect(none).toContain('Total sales amt 0.00 Received amt 0.00 Credit amount 0.00');
    expect(none).not.toContain('on hospital bills');
  });

  it('back from a bill opened here, the search and the clicked bill are as they were', () => {
    answers['/pharmacy/bill-search'] = found();
    const form = { ...newSearch('2026-11-21'), type: 'ipd', byName: true, first: 'meera', pay: 'credit' };
    const html = words(page({ billSearch: { form, picked: 'i3' } }));
    const shown = text(html);
    expect(html).toMatch(/<input[^>]*value="meera"[^>]*>/);
    expect((html.match(/<input[^>]*name="sb-type"[^>]*>/g) ?? []).find((tag) => /\schecked=""/.test(tag))).toContain('value="ipd"');
    expect((html.match(/<input[^>]*name="sb-pay"[^>]*>/g) ?? []).find((tag) => /\schecked=""/.test(tag))).toContain('value="credit"');
    // The clicked bill: its medicines, Re-print and Open the bill; an IPD bill, so the IP bill summary is ready
    expect(shown).toContain('Bill PH-000009 · Sample Meera Patil Re-print bill Open the bill');
    expect(html).toContain('href="/pharmacy/invoices/i3"');
    expect(shown).toContain('1 Sample Folic 5 F1 Jun 2028 2.00 3 (1 returned) 5.40');
    expect(shown).not.toContain('IP bill summary: click an IPD patient’s bill first');
    // What was kept is used only when it is a whole search
    expect(isSearch(form)).toBe(true);
    expect([null, undefined, 'x', {}, { ...form, first: 5 }, { ...form, byDate: 'yes' }].map(isSearch)).toEqual([false, false, false, false, false, false]);
    const fresh = text(page({ billSearch: { form: { type: 'ipd' }, picked: 'i3' } }));
    expect(fresh).toContain('Click a bill to see its medicines.');
  });

  it('a bill’s medicines: Sr no, Item name, Batch no, Expiry date, Rate, Qty, Total amt', () => {
    const shown = text(renderToStaticMarkup(<BillItems bill={opd} />));
    expect(shown).toMatch(/Sr no Item name Batch no Expiry date Rate Qty Total amt/);
    expect(shown).toContain('1 Sample Folic 5 F1 Jun 2028 2.00 3 (1 returned) 5.40');
    expect(text(renderToStaticMarkup(<BillItems bill={{ ...opd, lines: [{ ...line, returnedQty: 0 }] }} />))).toContain('2.00 3 5.40');
    // Before a bill is clicked the headings stay, with the line saying what to do
    expect(text(renderToStaticMarkup(<BillItems bill={null} />))).toMatch(/Sr no Item name Batch no Expiry date Rate Qty Total amt Click a bill to see its medicines\./);
  });
});
