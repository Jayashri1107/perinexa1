// Printing expenses (owner, 11 Nov 2026): one expense prints as a voucher, several as the daily expenses sheet, and the
// list on the Daily Expenses page has a tick box on each expense not cancelled. Made-up names and amounts.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExpenseDocHead, ExpenseSheet, ExpenseVoucher, expenseHead } from './ExpensePrint.jsx';
import { ExpensesTable, payLine } from './ExpensesTable.jsx';

const text = (html) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const exp = (id, more = {}) => ({ id, date: '2026-11-11', time: '08:30', head: 'Doctor charges', paidTo: 'Sample Doctor A', voucherNo: '01', mode: 'cash', amountPaise: 150000, description: 'Evening locum charges', byName: 'Sample Reception', cancelled: null, ...more });

describe('the expense voucher', () => {
  it('has who was paid, the head and narration, the amount, how paid, the words and the signatures', () => {
    const t = text(renderToStaticMarkup(<ExpenseVoucher expense={exp('1')} hospitalName="Sample Hospital" />));
    for (const part of ['Voucher', 'Paid to: Sample Doctor A', 'Date: 11 Nov 2026 08:30', 'Voucher no.: 01', 'On account: Doctor charges', 'Narration: Evening locum charges', '1,500.00', 'Payment: Cash', 'Total:', 'Rs. One Thousand Five Hundred Only', 'User: Sample Reception', 'For Sample Hospital', "Receiver's signature"]) expect(t).toContain(part);
  });
});

describe('the daily expenses sheet', () => {
  it('groups by how paid with a total for each and for all, without the cancelled', () => {
    const list = [exp('1'), exp('2', { paidTo: 'Sample Doctor B', amountPaise: 450000, time: '10:12' }), exp('3', { paidTo: 'Sample Recharge', amountPaise: 22000, mode: 'upi', walletName: 'PhonePe' }), exp('4', { paidTo: 'Entered twice', cancelled: { reason: 'x' } })];
    const t = text(renderToStaticMarkup(<table><tbody><tr><td><ExpenseSheet expenses={list} /></td></tr></tbody></table>));
    const order = ['Cash', 'Sample Doctor A', 'Sample Doctor B', 'Cash amount 6,000.00', 'UPI / wallet', 'Sample Recharge', 'UPI / wallet amount 220.00', 'Total amount 6,220.00'];
    const at = order.map((p) => t.indexOf(p));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(t).not.toContain('Entered twice');
  });
});

describe('the Daily Expenses table', () => {
  it('a tick box on each expense not cancelled, a ticked one shown as ticked', () => {
    const html = renderToStaticMarkup(<ExpensesTable expenses={[exp('1'), exp('2', { cancelled: { byName: 'Sample Admin', reason: 'twice' } })]} selected={['1']} onSelect={() => {}} onCancel={() => {}} />);
    expect(html.match(/type="checkbox"/g)).toHaveLength(2); // tick all + the one not cancelled
    expect(html).toContain('Tick to print: Sample Doctor A');
    expect(html).toMatch(/exp-row-picked/);
  });
  it('each cell a main line and a small line: voucher under the name, payment under the head, who entered it under the reason', () => {
    const t = text(renderToStaticMarkup(<ExpensesTable expenses={[exp('1', { mode: 'cheque', chequeNo: '004512', bankName: 'HDFC Bank' })]} onSelect={() => {}} onCancel={() => {}} />));
    for (const part of ['08:30 11 Nov', 'Sample Doctor A Voucher 01', 'Doctor charges Cheque 004512 · HDFC Bank', 'Evening locum charges Entered by Sample Reception', '₹1,500', 'Total ₹1,500']) expect(t).toContain(part);
  });
  it('a cancelled expense: the Cancelled badge, who cancelled it and why, no cancel button, left out of the total', () => {
    const html = renderToStaticMarkup(<ExpensesTable expenses={[exp('1'), exp('2', { amountPaise: 99900, cancelled: { byName: 'Sample Admin', reason: 'entered twice' } })]} onSelect={() => {}} onCancel={() => {}} />);
    const t = text(html);
    expect(t).toContain('Sample Doctor A Cancelled');
    expect(t).toContain('Cancelled by Sample Admin: entered twice');
    expect(t).toContain('Total ₹1,500');
    expect(html.match(/Cancel the expense/g)).toHaveLength(1);
  });
  it('says so when there is nothing in the period', () => {
    expect(text(renderToStaticMarkup(<ExpensesTable expenses={[]} onSelect={() => {}} />))).toContain('No expenses entered in this period.');
  });
  it('how it was paid, short', () => {
    expect(payLine({ mode: 'cash' })).toBe('Cash');
    expect(payLine({ mode: 'upi', walletName: 'PhonePe' })).toBe('UPI / wallet · PhonePe');
    expect(payLine({ mode: 'bank', bankName: '' })).toBe('Bank transfer');
  });
});

describe('the head of the printout', () => {
  const lh = { name: 'Sample Hospital', address: 'Sample Road', phone: '0000000000' };
  const head = (list) => text(renderToStaticMarkup(<ExpenseDocHead letterhead={lh} {...expenseHead(list, new Date('2026-11-11T10:00:00Z'))} />));
  it('a voucher: the hospital, "Payment voucher", its number and date', () => {
    const t = head([exp('1')]);
    for (const part of ['Sample Hospital', 'Sample Road', 'Phone 0000000000', 'Payment voucher', 'Voucher no. 01', 'Date 11 Nov 2026, 08:30']) expect(t).toContain(part);
  });
  it('a voucher without a number leaves the number out', () => {
    expect(head([exp('1', { voucherNo: '' })])).not.toContain('Voucher no.');
  });
  it('the sheet: its period, how many expenses and when printed', () => {
    const t = head([exp('1'), exp('2', { date: '2026-11-12' }), exp('3', { cancelled: { reason: 'x' } })]);
    for (const part of ['Daily expenses sheet', 'Period 11 Nov 2026 to 12 Nov 2026', 'Expenses 2', 'Printed 11 Nov 2026']) expect(t).toContain(part);
  });
});
