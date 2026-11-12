import { useState } from 'react';
import { Ban, Paperclip } from 'lucide-react';
import { Alert, StatusPill, formatDayMonth } from '../../components/ui.jsx';
import { rupees } from './billingFormat.js';
import { openBill } from './ExpenseEntry.jsx';
import { EXPENSE_MODE_LABELS, expenseFor, expensesTotal } from './expenseFormat.js';

// The expenses table of the Daily Expenses page (12 Nov 2026: "make it proper and user friendly"). Each cell has one
// main line and a small grey line under it, so a row stays two or three lines high however narrow the screen:
// when (time, date), paid to (voucher no.), head (how paid), reason (who entered it), amount. A tick box on each
// expense not cancelled chooses what to print. A cancelled expense stays listed, greyed, with a "Cancelled" badge and
// why – its amount struck through and counted nowhere.

/** How it was paid, short: "Cash", "Cheque 004512 · HDFC Bank", "UPI / wallet · PhonePe". */
export function payLine(e) {
  const mode = EXPENSE_MODE_LABELS[e.mode] ?? e.mode;
  if (e.mode === 'cheque') return [`${mode}${e.chequeNo ? ` ${e.chequeNo}` : ''}`, e.bankName].filter(Boolean).join(' · ');
  if (e.mode === 'upi') return [mode, e.walletName].filter(Boolean).join(' · ');
  if (e.mode === 'bank') return [mode, e.bankName].filter(Boolean).join(' · ');
  return mode;
}

const timeOf = (e) => e.time || (e.at ? new Date(e.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');

export function ExpensesTable({ expenses, selected = [], onSelect, onCancel, empty = 'No expenses entered in this period.' }) {
  const [error, setError] = useState(null);
  const choosable = expenses.filter((e) => !e.cancelled).map((e) => e.id);
  const picked = new Set(selected);
  const allPicked = choosable.length > 0 && choosable.every((id) => picked.has(id));
  const toggle = (id) => onSelect(picked.has(id) ? [...picked].filter((x) => x !== id) : [...picked, id]);
  const open = async (e) => {
    setError(null);
    try {
      await openBill(e);
    } catch (err) {
      setError(err.message);
    }
  };
  const total = expensesTotal(expenses);

  return (
    <>
      <Alert type="error">{error}</Alert>
      <div className="exp-table-wrap">
        <table className="exp-table">
          <caption className="sr-only">Expenses of the period</caption>
          <thead>
            <tr>
              <th scope="col" className="exp-pick">
                <input type="checkbox" aria-label="Tick all to print" title="Tick all to print" checked={allPicked} disabled={!choosable.length} onChange={() => onSelect(allPicked ? [] : choosable)} />
              </th>
              <th scope="col">When</th>
              <th scope="col">Paid to</th>
              <th scope="col">Head</th>
              <th scope="col">Reason</th>
              <th scope="col" className="num">
                Amount
              </th>
              <th scope="col" className="exp-acts">
                <span className="sr-only">Bill and cancel</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id} className={e.cancelled ? 'exp-row-cancelled' : picked.has(e.id) ? 'exp-row-picked' : undefined}>
                <td className="exp-pick">
                  {!e.cancelled && <input type="checkbox" aria-label={`Tick to print: ${e.paidTo}, ${rupees(e.amountPaise)}`} checked={picked.has(e.id)} onChange={() => toggle(e.id)} />}
                </td>
                <td className="exp-when">
                  <span className="exp-main">{timeOf(e)}</span>
                  <span className="exp-sub">{formatDayMonth(e.date)}</span>
                </td>
                <td className="exp-col-name">
                  <span className="exp-main exp-name">{e.paidTo}</span>
                  {e.cancelled ? (
                    <span className="exp-sub">
                      <StatusPill tone="inactive" icon={Ban}>
                        Cancelled
                      </StatusPill>
                    </span>
                  ) : (
                    e.voucherNo && <span className="exp-sub">Voucher {e.voucherNo}</span>
                  )}
                </td>
                <td className="exp-col-head">
                  <span className="exp-main">{expenseFor(e)}</span>
                  <span className="exp-sub">{payLine(e)}</span>
                </td>
                <td className="exp-reason">
                  {e.description && (
                    <span className="exp-main exp-clamp" title={e.description}>
                      {e.description}
                    </span>
                  )}
                  <span className="exp-sub">{e.cancelled ? `Cancelled by ${e.cancelled.byName}: ${e.cancelled.reason}` : `Entered by ${e.byName}`}</span>
                </td>
                <td className="num exp-amount">{rupees(e.amountPaise)}</td>
                <td className="exp-acts">
                  {e.file && (
                    <button type="button" className="icon-btn" aria-label={`Open the bill ${e.file.fileName}`} title="Open the bill" onClick={() => open(e)}>
                      <Paperclip aria-hidden="true" />
                    </button>
                  )}
                  {!e.cancelled && onCancel && (
                    <button type="button" className="icon-btn" aria-label={`Cancel the expense of ${rupees(e.amountPaise)}`} title="Cancel (entered by mistake)" onClick={() => onCancel(e)}>
                      <Ban aria-hidden="true" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!expenses.length && (
              <tr>
                <td colSpan={7} className="exp-empty">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
          {total > 0 && (
            <tfoot>
              <tr>
                <th scope="row" colSpan={5}>
                  Total
                </th>
                <td className="num exp-amount">{rupees(total)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
