// Daily expenses: the form's checks and what is sent (fake sample data).
import { describe, expect, it } from 'vitest';
import { BANKS, OTHER_BANK, blankExpense, expenseFor, expensePayload, expenseProblems, expensesTotal, hospitalNow, paidHow } from './expenseFormat.js';

const NOW = new Date('2026-10-28T03:53:00Z'); // 09:23 in the hospital
const filled = (more = {}) => ({ ...blankExpense(NOW), headId: 'h1', paidTo: 'Sample Driver', amount: '1,500', ...more });

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
