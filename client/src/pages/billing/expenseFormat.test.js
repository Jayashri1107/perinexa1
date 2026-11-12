// Daily expenses: the form's checks and what is sent (fake sample data).
import { describe, expect, it } from 'vitest';
import { BANKS, OTHER_BANK, blankExpense, expenseFor, expensePayload, expenseProblems, expensesTotal, hospitalNow, paidHow, expenseFilter, filterExpenses, isFiltering, expenseSheet, quickPeriods, expenseFigures } from './expenseFormat.js';

const NOW = new Date('2026-10-28T03:53:00Z'); // 09:23 in the hospital
const filled = (more = {}) => ({ ...blankExpense(NOW), headId: 'h1', paidTo: 'Sample Driver', amount: '1,500', ...more });

describe('filtering the list from the new-expense form', () => {
  const list = [
    { id: '1', date: '2026-11-03', paidTo: 'Sample Ravi', headId: 'h1', voucherNo: 'V-10', mode: 'cash', amountPaise: 120000, description: 'Tea for staff', chequeNo: '', bankName: '', walletName: '' },
    { id: '2', date: '2026-11-03', paidTo: 'Sample Meera', headId: 'h2', voucherNo: '', mode: 'upi', amountPaise: 12050, description: '', chequeNo: '', bankName: '', walletName: 'PhonePe' },
    { id: '3', date: '2026-11-02', paidTo: 'Sample Ravi', headId: 'h2', voucherNo: '', mode: 'cheque', amountPaise: 50000, description: '', chequeNo: '12345', bankName: 'Axis Bank', walletName: '' },
  ];
  const ids = (v, touched) => filterExpenses(list, expenseFilter({ ...blankExpense(), ...v }, touched)).map((e) => e.id);

  it('an empty form filters nothing: the date and "paid by" start filled in', () => {
    expect(ids({})).toEqual(['1', '2', '3']);
    expect(isFiltering(expenseFilter(blankExpense()))).toBe(false);
  });
  it('narrows by each thing typed or chosen, and by all of them together', () => {
    expect(ids({ paidTo: 'ravi' })).toEqual(['1', '3']);
    expect(ids({ headId: 'h2' })).toEqual(['2', '3']);
    expect(ids({ voucherNo: 'v-1' })).toEqual(['1']);
    expect(ids({ description: 'tea' })).toEqual(['1']);
    expect(ids({ paidTo: 'ravi', headId: 'h2' })).toEqual(['3']);
    expect(ids({ mode: 'upi', walletName: 'phone' }, { mode: true })).toEqual(['2']);
    expect(ids({ mode: 'cheque', chequeNo: '123', bank: 'Axis Bank' }, { mode: true })).toEqual(['3']);
    expect(ids({ date: '2026-11-02' }, { date: true })).toEqual(['3']);
  });
  it('finds an amount by its first digits, with or without commas', () => {
    expect(ids({ amount: '12' })).toEqual(['1', '2']);
    expect(ids({ amount: '1,200' })).toEqual(['1']);
    expect(ids({ amount: '120.5' })).toEqual(['2']);
    expect(ids({ amount: '9' })).toEqual([]);
  });
});

describe('a new expense', () => {
  it("starts on the hospital's date and time, paid in cash", () => {
    expect(hospitalNow(NOW)).toEqual({ date: '2026-10-28', time: '09:23' });
    expect(blankExpense(NOW)).toMatchObject({ date: '2026-10-28', time: '09:23', mode: 'cash', headId: '', paidTo: '' });
  });

  it('needs a head, the person paid and an amount; a cheque also needs its number, bank and date', () => {
    expect(Object.keys(expenseProblems(blankExpense(NOW))).sort()).toEqual(['amountPaise', 'headId', 'paidTo']);
    expect(expenseProblems(filled())).toEqual({});
    expect(Object.keys(expenseProblems(filled({ mode: 'cheque', chequeDate: '' }))).sort()).toEqual(['bankName', 'chequeDate', 'chequeNo']);
    expect(expenseProblems(filled({ mode: 'cheque', chequeNo: '004512', bank: OTHER_BANK, otherBank: '' }))).toHaveProperty('bankName');
    expect(expenseProblems(filled({ mode: 'cheque', chequeNo: '004512', bank: OTHER_BANK, otherBank: 'Vidarbha Bank' }))).toEqual({});
  });

  it('sends only the details of the chosen mode, in paise', () => {
    expect(expensePayload(filled({ walletName: 'PhonePe', chequeNo: '1' }))).toEqual({
      date: '2026-10-28',
      time: '09:23',
      headId: 'h1',
      paidTo: 'Sample Driver',
      voucherNo: '',
      mode: 'cash',
      amountPaise: 150000,
      description: '',
    });
    expect(expensePayload(filled({ mode: 'cheque', chequeNo: ' 004512 ', bank: 'Bank of Maharashtra' }))).toMatchObject({ chequeNo: '004512', bankName: 'Bank of Maharashtra', chequeDate: '2026-10-28' });
    expect(expensePayload(filled({ mode: 'upi', walletName: 'PhonePe' }))).toMatchObject({ mode: 'upi', walletName: 'PhonePe' });
    expect(expensePayload(filled({ mode: 'upi' }))).not.toHaveProperty('walletName');
  });

  it("offers the old software's banks", () => {
    expect(BANKS).toContain('Bank of Maharashtra');
    expect(BANKS).toContain('Maharashtra Gramin Bank');
    expect(new Set(BANKS).size).toBe(BANKS.length);
  });
});

describe('the list of expenses', () => {
  it('names the head (or the category of an older entry) and how it was paid', () => {
    expect(expenseFor({ head: 'Diesel expenses' })).toBe('Diesel expenses');
    expect(expenseFor({ head: '', category: 'refreshments' })).toBe('Tea and refreshments');
    expect(paidHow({ mode: 'cheque', chequeNo: '004512', bankName: 'Bank of Maharashtra' })).toBe('Cheque, no. 004512, Bank of Maharashtra');
    expect(paidHow({ mode: 'upi', walletName: 'PhonePe' })).toBe('UPI / wallet, PhonePe');
    expect(paidHow({ mode: 'cash' })).toBe('Cash');
  });

  it('totals only what was not cancelled', () => {
    expect(expensesTotal([{ amountPaise: 150000 }, { amountPaise: 2000, cancelled: { reason: 'twice' } }, { amountPaise: 500 }])).toBe(150500);
  });
});

describe('the printed expenses sheet', () => {
  const e = (id, mode, amountPaise, more = {}) => ({ id, date: '2026-11-11', time: '10:00', mode, amountPaise, cancelled: null, ...more });
  it('groups by how it was paid, cash first, with a total for each and for all', () => {
    const sheet = expenseSheet([e('1', 'upi', 22000), e('2', 'cash', 450000, { time: '10:12' }), e('3', 'cash', 150000, { time: '08:30' })]);
    expect(sheet.groups.map((g) => [g.label, g.expenses.map((x) => x.id), g.totalPaise])).toEqual([
      ['Cash', ['3', '2'], 600000],
      ['UPI / wallet', ['1'], 22000],
    ]);
    expect(sheet.totalPaise).toBe(622000);
  });
  it('leaves out a cancelled expense', () => {
    const sheet = expenseSheet([e('1', 'cash', 10000), e('2', 'cash', 99900, { cancelled: { reason: 'entered twice' } })]);
    expect(sheet.totalPaise).toBe(10000);
    expect(sheet.groups[0].expenses).toHaveLength(1);
  });
  it('an empty list prints no groups', () => {
    expect(expenseSheet([])).toEqual({ groups: [], totalPaise: 0 });
  });
});

describe('the Daily Expenses page: quick periods and figures', () => {
  it('today, yesterday, this week from Monday and this month', () => {
    const p = Object.fromEntries(quickPeriods('2026-11-12').map((q) => [q.key, [q.from, q.to]])); // a Thursday
    expect(p).toEqual({ today: ['2026-11-12', '2026-11-12'], yesterday: ['2026-11-11', '2026-11-11'], week: ['2026-11-09', '2026-11-12'], month: ['2026-11-01', '2026-11-12'] });
    expect(quickPeriods('2026-11-01').find((q) => q.key === 'yesterday').from).toBe('2026-10-31');
    expect(quickPeriods('2026-11-09').find((q) => q.key === 'week').from).toBe('2026-11-09'); // a Monday
  });
  it('the total, how many, cash and the rest – without the cancelled', () => {
    const e = (mode, amountPaise, cancelled = null) => ({ mode, amountPaise, cancelled });
    expect(expenseFigures([e('cash', 150000), e('upi', 22000), e('cash', 18000, { reason: 'x' })])).toEqual({ totalPaise: 172000, count: 2, cashPaise: 150000, otherPaise: 22000, cancelled: 1 });
    expect(expenseFigures([])).toEqual({ totalPaise: 0, count: 0, cashPaise: 0, otherPaise: 0, cancelled: 0 });
  });
});
