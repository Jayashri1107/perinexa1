// Printing expenses (owner, 11 Nov 2026): one expense prints as a voucher, several as the daily expenses sheet, and the
// list on the Daily Expenses page has a tick box on each expense not cancelled. Made-up names and amounts.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExpenseSheet, ExpenseVoucher } from './ExpensePrint.jsx';
import { ExpensesList } from './ExpenseEntry.jsx';

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
    const t = text(renderToStaticMarkup(<table><tbody><tr><td><ExpenseSheet expenses={list} from="2026-11-11" to="2026-11-11" /></td></tr></tbody></table>));
    expect(t).toContain('Daily expenses sheet – 11 Nov 2026');
    const order = ['Cash', 'Sample Doctor A', 'Sample Doctor B', 'Cash amount 6,000.00', 'UPI / wallet', 'Sample Recharge', 'UPI / wallet amount 220.00', 'Total amount 6,220.00'];
    const at = order.map((p) => t.indexOf(p));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(t).not.toContain('Entered twice');
  });
});

describe('ticking expenses to print', () => {
  it('shows a tick box on each expense not cancelled, and a ticked one as ticked', () => {
    const html = renderToStaticMarkup(<ExpensesList expenses={[exp('1'), exp('2', { cancelled: { byName: 'A', reason: 'twice' } })]} selected={['1']} onSelect={() => {}} showDate />);
    expect(html.match(/type="checkbox"/g)).toHaveLength(2); // tick all + the one not cancelled
    expect(html).toContain('Tick to print: Sample Doctor A');
    expect(html).toMatch(/exp-picked/);
  });
  it('has no tick boxes where the list is not for printing (the daily summary)', () => {
    expect(renderToStaticMarkup(<ExpensesList expenses={[exp('1')]} />)).not.toContain('checkbox');
  });
});
