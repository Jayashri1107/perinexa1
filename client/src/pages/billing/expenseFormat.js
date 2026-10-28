// Expenses paid from the counter: the words and checks shared by the Daily Expenses page and the daily summary
// (server/src/routes/billing.js). Amounts are paise. Never a patient's name or details in an expense.

import { toPaise } from './billingFormat.js';

// Entries before the Daily Expenses page (28 Oct 2026) have one of these instead of a head
export const EXPENSE_CATEGORY_LABELS = {
  petty_cash: 'Petty cash',
  refreshments: 'Tea and refreshments',
  stationery: 'Stationery and printing',
  courier: 'Courier and post',
  transport: 'Transport',
  cleaning: 'Cleaning and housekeeping',
  repairs: 'Repairs and maintenance',
  salary_advance: 'Staff advance',
  other: 'Other',
};

export const EXPENSE_MODE_LABELS = { cash: 'Cash', cheque: 'Cheque', upi: 'UPI / wallet', bank: 'Bank transfer', card: 'Card' };

// The banks of the hospital's old billing software, then other common ones; "Other bank" lets the name be typed
export const BANKS = [
  'ADCC Bank (Aurangabad)',
  'Ahmednagar Merchants Co-op Bank',
  'Axis Bank',
  'Bandhan Bank',
  'Bank of Baroda',
  'Bank of India',
  'Bank of Maharashtra',
  'Canara Bank',
  'Central Bank of India',
  'Corporation Bank',
  'Cosmos Bank',
  'Federal Bank',
  'HDFC Bank',
  'ICICI Bank',
  'IDBI Bank',
  'Indian Bank',
  'Indian Overseas Bank',
  'IndusInd Bank',
  'Janata Sahakari Bank (Aurangabad)',
  'Janata Sahakari Bank Ltd',
  'Karnataka Bank',
  'Kerala Bank',
  'Kotak Mahindra Bank',
  'Krishna Grameen Bank',
  'Maharashtra Gramin Bank',
  'Oriental Bank',
  'Pune District Central Co-op Bank',
  'Punjab National Bank',
  'Rajarshi Shahu Sahakari Bank',
  'RBL Bank',
  'Saraswat Bank',
  'State Bank of India',
  'UCO Bank',
  'Union Bank of India',
  'Yes Bank',
];
export const OTHER_BANK = 'other';

export const WALLETS = ['Google Pay', 'PhonePe', 'Paytm', 'BHIM', 'Amazon Pay'];

/** What an expense was for: its head, or the category of an older entry. */
export const expenseFor = (e) => e.head || EXPENSE_CATEGORY_LABELS[e.category] || e.category || '';

/** How it was paid, with the cheque or wallet details. */
export function paidHow(e) {
  const mode = EXPENSE_MODE_LABELS[e.mode] ?? e.mode;
  if (e.mode === 'cheque') return [mode, e.chequeNo && `no. ${e.chequeNo}`, e.bankName].filter(Boolean).join(', ');
  if (e.mode === 'upi' && e.walletName) return `${mode}, ${e.walletName}`;
  if (e.mode === 'bank' && e.bankName) return `${mode}, ${e.bankName}`;
  return mode;
}

/** The hospital's date and time now: { date: 'YYYY-MM-DD', time: 'HH:MM' }. */
export function hospitalNow(now = new Date()) {
  const date = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const time = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
  return { date, time };
}

/** An empty form for a new expense. */
export function blankExpense(now = new Date()) {
  const { date, time } = hospitalNow(now);
  return { date, time, headId: '', paidTo: '', voucherNo: '', amount: '', mode: 'cash', chequeNo: '', bank: '', otherBank: '', chequeDate: date, walletName: '', description: '' };
}

const bankOf = (v) => (v.bank === OTHER_BANK ? v.otherBank.trim() : v.bank);

/** The form's problems by field ({} when it can be saved). */
export function expenseProblems(v) {
  const p = {};
  if (!v.headId) p.headId = 'Choose a head from the list.';
  if (!v.paidTo.trim()) p.paidTo = 'Enter the name of the person paid.';
  const amountPaise = toPaise(v.amount);
  if (!amountPaise || amountPaise < 100) p.amountPaise = 'Enter the amount in rupees, for example 120.';
  if (v.mode === 'cheque') {
    if (!v.chequeNo.trim()) p.chequeNo = 'Enter the cheque number.';
    if (!bankOf(v)) p.bankName = 'Choose the bank.';
    if (!v.chequeDate) p.chequeDate = 'Enter the cheque date.';
  }
  return p;
}

/** The request body for the server: only the details of the chosen mode. */
export function expensePayload(v) {
  const body = {
    date: v.date,
    time: v.time,
    headId: v.headId,
    paidTo: v.paidTo.trim(),
    voucherNo: v.voucherNo.trim(),
    mode: v.mode,
    amountPaise: toPaise(v.amount),
    description: v.description.trim(),
  };
  if (v.mode === 'cheque') Object.assign(body, { chequeNo: v.chequeNo.trim(), bankName: bankOf(v), chequeDate: v.chequeDate });
  if (v.mode === 'bank' && bankOf(v)) body.bankName = bankOf(v);
  if (v.mode === 'upi' && v.walletName.trim()) body.walletName = v.walletName.trim();
  return body;
}

/** The total of the expenses not cancelled. */
export const expensesTotal = (list = []) => list.filter((e) => !e.cancelled).reduce((s, e) => s + e.amountPaise, 0);
