// Pharmacy → Settlement (24 Nov 2026): what Search asks for, the Settlement window's sums and what Save sends, the
// screen with the earlier window's boxes, and – the same day's request – the Sales bill's list saying it holds today's
// bills. Rendered to HTML (react-dom/server) from fake answers, as the other pharmacy screens are tested. Made-up names
// and numbers only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const answers = {};
vi.mock('../../hooks/useFetch.js', () => ({
  useFetch: (path) => ({ data: path ? (answers[path] ?? null) : null, loading: false, error: null, status: null, reload: () => {} }),
}));
vi.mock('../../auth/AuthContext.jsx', () => ({ useAuth: () => ({ activeMembership: { roles: ['pharmacist'] }, user: { name: 'Sample Pharmacist' }, activeTenantId: 't1' }) }));

const { PharmacySettlementPage, SettlementReceipt } = await import('./SettlementPage.jsx');
const { findProblem, findQuery, findWindowProblem, findWindowQuery, newFindFilters, newSettle, selectedOf, settleBody, settleLeft, settleSums, settledWords, toPaise } = await import('./settlement.js');
const { InvoicesPage } = await import('./InvoicesPage.jsx');
const { describeAudit } = await import('../../components/auditFormat.js');
const { PatientPickList } = await import('./pharmacyUi.jsx');
const { amount } = await import('./searchBill.js');

const words = (html) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const text = (html) => words(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const SETTINGS = { name: 'Sample Medical Stores', address: '4 Sample Road, Sample Town', phone: '99999 00000', gstin: '', licence20: '', licence21: '' };
const credit = [
  { id: 'b', number: 'PH-000011', balancePaise: 30000 },
  { id: 'a', number: 'PH-000010', balancePaise: 100000 },
];

beforeEach(() => {
  for (const k of Object.keys(answers)) delete answers[k];
});

describe('what Search asks for', () => {
  const ALL_ON = { byMrn: true, byName: true };
  it('the UHID when one is ticked and typed, otherwise the name; External needs nothing typed', () => {
    expect(findQuery({ type: 'opd', mrn: ' SH-0001 ', name: 'asha', ...ALL_ON })).toEqual({ type: 'opd', search: 'SH-0001' });
    expect(findQuery({ type: 'ipd', mrn: '', name: ' Asha ', ...ALL_ON })).toEqual({ type: 'ipd', search: 'Asha' });
    expect(findQuery({ type: 'external', mrn: '', name: '', ...ALL_ON })).toEqual({ type: 'external' });
    expect(findProblem({ type: 'opd', mrn: '', name: 'A', ...ALL_ON })).toContain('at least two letters');
    expect(findProblem({ type: 'opd', mrn: 'SH', name: '', ...ALL_ON })).toBe('');
    expect(findProblem({ type: 'opd', mrn: '', name: '', ...ALL_ON })).toBe(''); // nothing typed: the list of patients (24 Nov 2026)
    expect(findQuery({ type: 'ipd', mrn: ' ', name: '', ...ALL_ON })).toEqual({ type: 'ipd' });
    expect(findProblem({ type: 'external', mrn: '', name: '', ...ALL_ON })).toBe('');
    // 25 Nov 2026 (the pharmacy's request): UHID and Patient name each ticked on or off, as on the Sale return window –
    // a box left unticked is skipped even when something is typed in it
    expect(findQuery({ type: 'opd', mrn: 'SH-0001', name: 'Asha', byMrn: false, byName: false })).toEqual({ type: 'opd' });
    expect(findQuery({ type: 'opd', mrn: 'SH-0001', name: 'Asha', byMrn: false, byName: true })).toEqual({ type: 'opd', search: 'Asha' });
  });

  it('Search opens the Find patient window, as the earlier software: what was typed goes in, ticked', () => {
    const day = '2026-11-24';
    // nothing typed: OPD – Date ticked for today; IPD – everyone admitted now
    expect(newFindFilters({ type: 'opd', mrn: '', name: '', ...ALL_ON }, day)).toMatchObject({ byName: false, byMrn: false, byDate: true, from: day, to: day });
    expect(findWindowQuery('opd', newFindFilters({ type: 'opd', mrn: '', name: '', ...ALL_ON }, day))).toEqual({ type: 'opd', from: day, to: day });
    expect(findWindowQuery('ipd', newFindFilters({ type: 'ipd', mrn: '', name: '', ...ALL_ON }, day))).toEqual({ type: 'ipd' });
    // typed: that, any day
    const typed = newFindFilters({ type: 'opd', mrn: ' SH-0001 ', name: ' Asha Kale ', ...ALL_ON }, day);
    expect(typed).toMatchObject({ byName: true, first: 'Asha Kale', byMrn: true, mrn: 'SH-0001', byDate: false });
    expect(findWindowQuery('opd', typed)).toEqual({ type: 'opd', name: 'Asha Kale', mrn: 'SH-0001' });
    // only the ticked boxes count; the name's parts and the mobile number
    const f = { ...typed, byMrn: false, first: 'Asha', middle: ' ', last: 'Kale', phone: '98220 12345', byDate: true, from: '2026-11-01', to: day };
    expect(findWindowQuery('ipd', f)).toEqual({ type: 'ipd', name: 'Asha Kale', phone: '98220 12345', from: '2026-11-01', to: day });
    expect(findWindowProblem(f)).toBe('');
    expect(findWindowProblem({ ...f, phone: '98ab' })).toBe('Write the mobile number in digits.');
    expect(findWindowProblem({ ...f, from: day, to: '2026-11-01' })).toBe('The To date is before the From date.');
  });
});

describe('the Settlement window', () => {
  const ctx = { selectedPaise: 130000, advancePaise: 40000 };
  it('opens from Advance with the advance filled in, from Settlement with the rest in cash, from Discount empty', () => {
    expect(newSettle('advance', ctx)).toMatchObject({ advance: '400.00', concession: '' });
    expect(newSettle('advance', { selectedPaise: 10000, advancePaise: 40000 }).advance).toBe('100.00'); // never more than chosen
    expect(newSettle('settle', ctx).ways.cash).toMatchObject({ on: true, amount: '1300.00' });
    expect(newSettle('discount', ctx)).toMatchObject({ advance: '', concession: '' });
    expect(Object.values(newSettle('discount', ctx).ways).some((w) => w.on)).toBe(false);
  });

  it('every rupee once: advance, discount and money received must make up the bills chosen', () => {
    const s = newSettle('advance', ctx);
    expect(settleSums(s, ctx)).toMatchObject({ advance: 40000, left: 90000 });
    expect(settleSums(s, ctx).problem).toBe('₹900.00 is still to settle: add it as advance, discount or money received.');
    const full = { ...s, concession: '100', reason: 'Sample reason', ways: { ...s.ways, cash: { on: true, amount: '700', reference: '', bank: '' }, upi: { on: true, amount: '100.00', reference: 'TXN1', bank: '' } } };
    const sums = settleSums(full, ctx);
    expect(sums).toMatchObject({ advance: 40000, concession: 10000, received: 80000, accounted: 130000, left: 0, problem: '' });
    expect(settleSums({ ...full, reason: ' ' }, ctx).problem).toBe('Write why the discount is given.');
    expect(settleSums({ ...full, advance: '500' }, ctx).problem).toBe('Only ₹400.00 of advance is available.');
    expect(settleSums({ ...full, concession: '200' }, ctx).problem).toBe('₹100.00 more than the bills chosen: lower an amount.');
    expect(settleSums({ ...full, concession: '1,00' }, ctx).problem).toContain('Write amounts in rupees');
    expect(settleSums({ ...full, ways: { ...full.ways, card: { on: true, amount: '', reference: '', bank: '' } } }, ctx).problem).toBe('Write the amount of each way ticked, or untick it.');
    const card = { ...full, ways: { ...full.ways, upi: { on: false, amount: '', reference: '', bank: '' }, card: { on: true, amount: '100', reference: '4111111111', bank: '' } } };
    expect(settleSums(card, ctx).problem).toContain('last 4 digits');
    // What Save sends
    expect(settleBody(full, { patientId: 'p1', invoiceIds: ['b', 'a'], sums })).toEqual({
      patientId: 'p1',
      invoiceIds: ['b', 'a'],
      advancePaise: 40000,
      concessionPaise: 10000,
      concessionReason: 'Sample reason',
      remarks: '',
      payments: [{ mode: 'cash', amountPaise: 70000 }, { mode: 'upi', amountPaise: 10000, reference: 'TXN1' }],
    });
    expect(toPaise('12.5')).toBe(1250);
    expect(toPaise('')).toBe(0);
    expect(toPaise('12.345')).toBeNull();
  });

  it('the bills chosen, and the words after saving', () => {
    expect(selectedOf(credit, new Set(['a']))).toEqual({ rows: [credit[1]], paise: 100000 });
    expect(selectedOf(credit, new Set())).toEqual({ rows: [], paise: 0 });
    expect(settledWords({ receivedPaise: 80000, advancePaise: 40000, concessionPaise: 10000 }, ['cash', 'upi'])).toBe('₹800.00 received in Cash and UPI, ₹400.00 from the advance, ₹100.00 discount');
    expect(settledWords({ receivedPaise: 0, advancePaise: 40000, concessionPaise: 0 }, [])).toBe('₹400.00 from the advance');
  });
});

describe('the list of patients found (Settlement, Sale return patient-wise)', () => {
  it('shows one line a patient – name, UHID and what she owes – the chosen one marked', () => {
    const people = Array.from({ length: 22 }, (_, i) => ({ id: `p${i}`, fullName: `Sample Patient ${i + 1}`, mrn: `SH-${1000 + i}`, creditPaise: i === 1 ? 40800 : 0 }));
    const html = renderToStaticMarkup(
      <PatientPickList title="Today’s OPD patients (22) – click one" people={people} chosenId="p1" onChoose={() => {}} extra={{ header: 'Due (₹)', render: (p) => (p.creditPaise > 0 ? amount(p.creditPaise) : '–') }} />,
    );
    expect(text(html)).toMatch(/^ ?Today’s OPD patients \(22\) – click one Patient name UHID Due \(₹\) Sample Patient 1 SH-1000 – Sample Patient 2 SH-1001 408\.00 Sample Patient 3/);
    expect((html.match(/<tr/g) ?? []).length).toBe(23); // the header and the 22 patients, one line each
    expect(words(html)).toContain('<tr class="is-on"><td><button type="button" class="ph-plist-name" aria-pressed="true" title="Sample Patient 2">');
    // Sale return: no money column
    expect(text(renderToStaticMarkup(<PatientPickList title="Billed today (1) – choose one" people={people.slice(0, 1)} onChoose={() => {}} />))).toMatch(/Patient name UHID Sample Patient 1 SH-1000 $/);
  });
});

describe('the Settlement screen', () => {
  it('opens blank – only Patient type (OPD, IPD) and Search – until Search finds the patient (26 Nov 2026)', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/pharmacy/settlement']}>
        <PharmacySettlementPage />
      </MemoryRouter>,
    );
    expect(text(html).trim()).toBe('Settlement Patient type OPD IPD Search');
    for (const gone of ['External', 'Paid bills', 'Credit bills', 'Advance available', 'UHID']) expect(text(html)).not.toContain(gone);
    // OPD chosen to begin with
    const radios = words(html).match(/<input type="radio" name="st-type"[^>]*>/g);
    expect(radios).toHaveLength(2);
    const checked = radios.filter((tag) => tag.includes('checked=""'));
    expect(checked).toHaveLength(1);
    expect(checked[0]).toContain('value="opd"');
    expect(text(html)).not.toMatch(/!/);
  });

  it('has the boxes, tables, figures and buttons of the earlier window once the patient is found', () => {
    const row = (id, number, date, bill, net, paid) => ({ id, number, date, patientId: 'p1', mrn: 'SH-0001', name: 'Sample Asha Kale', type: 'opd', billAmountPaise: bill, concessionPaise: bill - net, netPayablePaise: net, paidPaise: paid, balancePaise: net - paid, eligible: net > paid });
    answers['/pharmacy/settlement'] = {
      patientId: 'p1',
      patient: { id: 'p1', fullName: 'Sample Asha Kale', mrn: 'SH-0001', phone: '' },
      paidBills: [row('c', 'PH-000012', '2026-11-22T06:00:00Z', 42000, 39900, 39900)],
      // date-wise, the oldest first (as the server sends them)
      creditBills: [row('a', 'PH-000010', '2026-11-20T06:00:00Z', 64000, 60800, 20000), row('b', 'PH-000011', '2026-11-21T06:00:00Z', 9600, 9600, 0)],
      totalCreditPaise: 50400,
      advance: { balancePaise: 0 },
    };
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/pharmacy/settlement']}>
        <PharmacySettlementPage patientId="p1" />
      </MemoryRouter>,
    );
    const shown = text(html);
    expect(shown).toMatch(/Patient type OPD IPD Search Clear UHID Patient name/);
    expect(shown).toMatch(/Paid bills .*Sales date Print bill no UHID Bill amt Con\. amt Net pay amt Paid amt Balance/);
    // 26 Nov 2026 (the pharmacy's request): the earlier software's columns – Amount is what this settlement pays (filled
    // when ticked), Balance amount = Net pay − Paid amount − Amount
    expect(shown).toMatch(/Credit bills Select all .*Sale date Pt\. bill no UHID Bill amount Net pay Amount Paid amount Balance amount/);
    expect(shown).toMatch(/PH-000010 SH-0001 640\.00 608\.00 200\.00 408\.00 .*PH-000011 SH-0001 96\.00 96\.00 0\.00 96\.00/);
    expect(shown).toMatch(/Advance available .*Total credit .*Selected total .*Advance Discount Settlement Close/);
    for (const b of ['Advance', 'Discount', 'Settlement']) expect(words(html)).toMatch(new RegExp(`<button type="button" class="btn btn-[a-z]+" disabled="">.*?${b}</button>`));
    // Brand: one primary button (Settlement), no exclamation marks
    expect((html.match(/class="btn btn-primary[^"]*"/g) ?? []).length).toBe(1);
    expect(shown).not.toMatch(/!/);
  });

  it('a credit bill’s Balance amount: Net pay − Paid amount − Amount (26 Nov 2026)', () => {
    const r = { netPayablePaise: 60800, paidPaise: 20000, balancePaise: 40800 };
    expect(settleLeft(r, false)).toBe(40800);
    expect(settleLeft(r, true)).toBe(0); // ticked: this settlement pays the whole balance
  });

  it('prints a receipt of what was settled', () => {
    const done = {
      patient: { fullName: 'Sample Asha Kale', mrn: 'SH-0001' },
      at: '2026-11-24T06:00:00Z',
      result: {
        duePaise: 130000,
        receivedPaise: 80000,
        advancePaise: 40000,
        concessionPaise: 10000,
        invoices: [
          { invoiceId: 'a', number: 'PH-000010', receivedPaise: 50000, advancePaise: 40000, concessionPaise: 10000 },
          { invoiceId: 'b', number: 'PH-000011', receivedPaise: 30000, advancePaise: 0, concessionPaise: 0 },
        ],
      },
    };
    const shown = text(renderToStaticMarkup(<SettlementReceipt done={done} settings={SETTINGS} />));
    expect(shown).toContain('Sample Medical Stores');
    expect(shown).toContain('Settlement receipt');
    expect(shown).toContain('Patient Sample Asha Kale UHID SH-0001');
    expect(shown).toContain('PH-000010 500.00 400.00 100.00');
    expect(shown).toContain('Total 1,300.00 800.00 400.00 100.00');
  });
});

describe('the audit log', () => {
  it('says what was settled and how, and that patients were looked up for a settlement', () => {
    expect(describeAudit({ action: 'PHARMACY_DUES_SETTLED', details: { settlement: true, amountPaise: 130000, invoices: [{ number: 'PH-000010' }, { number: 'PH-000011' }], receivedPaise: 80000, advancePaise: 40000, concessionPaise: 10000 } })).toBe(
      '₹1,300 settled · on PH-000010, PH-000011 · ₹800 received · ₹400 from the advance · ₹100 concession',
    );
    expect(describeAudit({ action: 'PHARMACY_DUES_SETTLED', details: { amountPaise: 1000, invoices: [{ number: 'PH-000010' }], duePaise: 200 } })).toBe('₹10 · on PH-000010 · ₹2 still due'); // Receive payment, as before
    expect(describeAudit({ action: 'PHARMACY_PATIENT_LOOKED_UP', details: { by: 'settlement', patientIds: ['p1', 'p2'] } })).toBe('Settlement · 2 records');
  });
});

describe('Sales bill: the list says which bills it holds (24 Nov 2026)', () => {
  it('today’s bills when the page opens', () => {
    answers['/pharmacy/invoices'] = { today: '2026-11-24', from: '2026-11-24', to: '2026-11-24', more: false, invoices: [] };
    const shown = text(renderToStaticMarkup(<MemoryRouter initialEntries={['/pharmacy/invoices']}><InvoicesPage /></MemoryRouter>));
    expect(shown).toContain('Today’s bills – 24 Nov 2026 · 0 bills · ₹0');
    expect(shown).toContain('Nothing sold on this day.');
  });
  it('a period chosen, and a note when there are more than are listed', () => {
    answers['/pharmacy/invoices'] = { today: '2026-11-24', from: '2026-11-01', to: '2026-11-24', more: true, invoices: [] };
    const shown = text(renderToStaticMarkup(<MemoryRouter initialEntries={['/pharmacy/invoices']}><InvoicesPage /></MemoryRouter>));
    expect(shown).toContain('Bills from 1 Nov 2026 to 24 Nov 2026');
    expect(shown).toContain('Choose fewer days to see the rest.');
  });
});
