// Pharmacy → Sale return patient-wise (24 Nov 2026): what Search asks for, the figures under the list (cash, credit,
// total – money back only for what was paid), the barcode, the screen with the earlier window's boxes and the return
// slip. Rendered to HTML (react-dom/server) from fake answers. Made-up names and numbers only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useFetch.js', () => ({ useFetch: () => ({ data: null, loading: false, error: null, status: null, reload: () => {} }) }));
vi.mock('../../auth/AuthContext.jsx', () => ({ useAuth: () => ({ activeMembership: { roles: ['pharmacist'] }, user: { name: 'Sample Pharmacist' }, activeTenantId: 't1' }) }));

const { PatientReturnPage, ReturnSlip } = await import('./PatientReturnPage.jsx');
const { findProblem, findQuery, lineForCode, lineReturn, linesShown, payWord, pickChoices, returnBody, returnFigures, returnSplit, typedQty } = await import('./patientReturn.js');

const words = (html) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const text = (html) => words(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const SETTINGS = { name: 'Sample Medical Stores', address: '4 Sample Road, Sample Town', phone: '99999 00000', gstin: '', licence20: '', licence21: '' };
// 10 × ₹5 less 10% = ₹45, paid in full; 6 × ₹10 on credit (₹10 paid); 5 × ₹5 issued to the ward
const L = (key, invoiceId, number, name, qty, mrp, amount, extra = {}) => ({ key, invoiceId, lineId: `${key}-l`, number, date: '2026-11-20T06:00:00Z', name, generic: '', batch: 'B1', expiry: '2028-06-30', mrpPaise: mrp, unitGrossPaise: mrp, qty, returnedQty: 0, canReturnQty: qty, discountPercent: 0, gstRate: 12, amountPaise: amount, barcodes: [], ...extra });
const DATA = {
  patient: { id: 'p1', fullName: 'Sample Asha Kale', mrn: 'SH-0001' },
  type: 'opd',
  lines: [
    L('a', 'i100', 'PH-000100', 'Sample Iron 100', 10, 500, 4500, { discountPercent: 10, barcodes: ['8901000000011'] }),
    L('b', 'i101', 'PH-000101', 'Sample Iron 100', 6, 1000, 6000, { barcodes: ['8901000000011'] }),
    L('c', 'i110', 'PH-000110', 'Sample Folic 5', 5, 500, 2500),
  ],
  bills: [
    { invoiceId: 'i100', number: 'PH-000100', onHospitalBill: false, netPaise: 4500, paidPaise: 4500, concessionPaise: 0, balancePaise: 0 },
    { invoiceId: 'i101', number: 'PH-000101', onHospitalBill: false, netPaise: 6000, paidPaise: 1000, concessionPaise: 0, balancePaise: 5000 },
    { invoiceId: 'i110', number: 'PH-000110', onHospitalBill: true, netPaise: 2500, paidPaise: null, concessionPaise: 0, balancePaise: null },
  ],
};

describe('what Search asks for', () => {
  const ALL_ON = { byMrn: true, byFirst: true, byDoctor: true, byDate: false, date: '' };
  it('the registration no, the first name and the doctor, as typed', () => {
    expect(findQuery({ type: 'ipd', mrn: ' SH-0001 ', first: '', doctor: ' rao ', ...ALL_ON })).toEqual({ type: 'ipd', mrn: 'SH-0001', doctor: 'rao' });
    expect(findQuery({ type: 'opd', mrn: '', first: 'Asha', doctor: '', ...ALL_ON })).toEqual({ type: 'opd', first: 'Asha' });
    expect(findProblem({ type: 'opd', mrn: '', first: 'A', doctor: 'Rao', byMrn: true, byFirst: true })).toContain('at least two letters');
    expect(findProblem({ type: 'opd', mrn: 'SH', first: '', doctor: '', byMrn: true, byFirst: true })).toBe('');
    expect(findProblem({ type: 'ipd', mrn: '', first: '', doctor: '', byMrn: true, byFirst: true })).toBe(''); // nothing typed: today's patients (24 Nov 2026)
    expect(findQuery({ type: 'ipd', mrn: '', first: ' ', doctor: '', ...ALL_ON })).toEqual({ type: 'ipd' });
  });
  // 25 Nov 2026 (the pharmacy's request): a box left unticked is never sent, even when something is typed in it – and a
  // Date ticked is sent, to browse a day other than today
  it('a box unticked is skipped; Date ticked browses that day', () => {
    expect(findQuery({ type: 'opd', mrn: 'SH-0001', first: 'Asha', doctor: 'Rao', byMrn: false, byFirst: false, byDoctor: false, byDate: false, date: '' })).toEqual({ type: 'opd' });
    expect(findQuery({ type: 'opd', mrn: '', first: '', doctor: '', byMrn: false, byFirst: false, byDoctor: false, byDate: true, date: '2026-11-20' })).toEqual({ type: 'opd', date: '2026-11-20' });
    expect(findProblem({ type: 'opd', mrn: 'SH', first: '', doctor: '', byMrn: false, byFirst: true })).toBe(''); // the UHID is typed but unticked: not "typed" at all
  });
});

describe('the figures under the list', () => {
  it('a quantity typed is a whole number up to what can be taken back', () => {
    expect([typedQty('', 5), typedQty('3', 5), typedQty('6', 5), typedQty('1.5', 5), typedQty('x', 5)]).toEqual([0, 3, null, null, null]);
    expect(lineReturn(DATA.lines[0], 2)).toEqual({ grossPaise: 1000, discountPaise: 100, amountPaise: 900 });
  });

  it('money back only for what was paid beyond what is still owed; credit and hospital bills come off what is owed', () => {
    expect(returnSplit(DATA.bills[0], 900)).toEqual({ refundPaise: 900, creditPaise: 0 });
    expect(returnSplit(DATA.bills[1], 5500)).toEqual({ refundPaise: 500, creditPaise: 5000 });
    expect(returnSplit(DATA.bills[2], 1000)).toEqual({ refundPaise: 0, creditPaise: 1000 });
    const f = returnFigures(DATA, { a: '2', b: '3', c: '2' });
    expect(f.problem).toBe('');
    expect(f.cash).toEqual({ grossPaise: 1000, discountPaise: 100, amountPaise: 900, moneyPaise: 900 });
    expect(f.credit).toEqual({ grossPaise: 4000, discountPaise: 0, amountPaise: 4000, moneyPaise: 4000 });
    expect(f.total).toEqual({ grossPaise: 5000, discountPaise: 100, amountPaise: 4900, moneyPaise: 4900 });
    expect(returnFigures(DATA, { a: '11' }).problem).toBe('Sample Iron 100 (bill PH-000100): type a whole number from 0 to 10.');
    expect(returnBody({ patientId: 'p1', type: 'opd', chosen: f.chosen, reason: ' Sample: not opened ', mode: 'upi' })).toEqual({
      patientId: 'p1',
      type: 'opd',
      items: [{ invoiceId: 'i100', lineId: 'a-l', qty: 2 }, { invoiceId: 'i101', lineId: 'b-l', qty: 3 }, { invoiceId: 'i110', lineId: 'c-l', qty: 2 }],
      reason: 'Sample: not opened',
      refund: { mode: 'upi' },
    });
    expect(DATA.bills.map(payWord)).toEqual(['Cash', 'Credit', 'Hospital bill']);
  });

  it('a scanned barcode adds one to the newest line with it; Item name shows only that medicine', () => {
    expect(lineForCode(DATA.lines, {}, ' 8901 0000 00011 ').key).toBe('a');
    expect(lineForCode(DATA.lines, { a: '10' }, '8901000000011').key).toBe('b'); // the first is all in the return already
    expect(lineForCode(DATA.lines, {}, '123')).toBe(null);
    expect(linesShown(DATA.lines, 'folic').map((l) => l.key)).toEqual(['c']);
    // Item name, as the earlier window (24 Nov 2026): what is typed lists her bills' medicines to choose; one already in
    // the return, or with nothing left to take back, is not offered again; nothing typed (↓) lists them all
    expect(pickChoices(DATA.lines, 'iron', []).map((l) => [l.key, l.number])).toEqual([['a', 'PH-000100'], ['b', 'PH-000101']]);
    expect(pickChoices(DATA.lines, 'IRON', ['a']).map((l) => l.key)).toEqual(['b']);
    expect(pickChoices(DATA.lines, '', ['c']).map((l) => l.key)).toEqual(['a', 'b']);
    expect(pickChoices([{ ...DATA.lines[2], canReturnQty: 0 }], 'folic', [])).toEqual([]);
  });
});

describe('the Sale return patient-wise screen', () => {
  it('has the boxes, list, figures and buttons of the earlier window', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/pharmacy/patient-return']}>
        <PatientReturnPage />
      </MemoryRouter>,
    );
    const shown = text(html);
    expect(shown).toMatch(/Patient type OPD IPD Search Direct print Registration no First name Doctor name Date Tax CGST \/ SGST/);
    expect(shown).toMatch(/Item name Barcode .*Item name Batch no Exp date Unit MRP Return qty Return amt Qty Disc % Bill no Bill date Pay/);
    expect(shown).toContain('Total cash return Total cash disc Total cash N disc Net cash return Total credit return Total credit disc Total credit N disc Net credit return Total return amt Total discount amt Total N discount amt Net return amt');
    expect((html.match(/<input id="pr-[a-z-]+"[^>]*value="0.00"/g) ?? []).length).toBe(12);
    expect(shown).toMatch(/Reason for the return Money given back by .*Save Close/);
    expect(shown).toContain('Choose OPD or IPD and press Search for today’s patients – or type a registration no or first name.');
    expect((html.match(/class="btn btn-primary[^"]*"/g) ?? []).length).toBe(1); // Save
    expect(words(html)).toMatch(/<button type="button" class="btn btn-primary" disabled="">/);
    expect(shown).not.toMatch(/!/);
  });

  it('prints a return slip: every medicine with its bill and credit note, and the money', () => {
    const f = returnFigures(DATA, { a: '2', b: '3' });
    const done = {
      patient: DATA.patient,
      at: '2026-11-24T06:00:00Z',
      mode: 'cash',
      chosen: f.chosen,
      creditNotes: [
        { invoiceId: 'i100', number: 'PH-000100', creditNote: 'CN-000007', amountPaise: 900, refundPaise: 900, creditPaise: 0, onHospitalBill: false },
        { invoiceId: 'i101', number: 'PH-000101', creditNote: 'CN-000008', amountPaise: 3000, refundPaise: 0, creditPaise: 3000, onHospitalBill: false },
      ],
      totals: { amountPaise: 3900, refundPaise: 900, creditPaise: 3000 },
    };
    const shown = text(renderToStaticMarkup(<ReturnSlip done={done} settings={SETTINGS} />));
    // as the earlier software's Pharmacy Sales Return Bill (24 Nov 2026)
    expect(shown).toContain('Pharmacy Sales Return Bill');
    expect(shown).toContain('Reg No SH-0001 Sales Ret. No CN-000007, CN-000008 Patient Name Sample Asha Kale Date 24/11/2026 Against bill PH-000100, PH-000101 Time 11:30:00');
    expect(shown).toContain('Item Name Batch No Expiry Qty Total Amount Sample Iron 100 B1 Jun-2028 2 9.00 Sample Iron 100 B1 Jun-2028 3 30.00');
    expect(shown).toContain('Total Amount 39.00 Cash Return 9.00 Credit Return 30.00');
    expect(shown).toContain('OVERCHARGE IF ANY IS REFUNDABLE, E.&O.E');
    expect(shown).toContain('Pharmacist');
  });
});
