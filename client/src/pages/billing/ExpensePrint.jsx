import { Hospital } from 'lucide-react';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { amountInWords } from './amountWords.js';
import { expenseFor, expenseSheet, paidHow } from './expenseFormat.js';

// Printing expenses from the Daily Expenses page (owner, 11 Nov 2026), like the hospital's old software: one expense
// ticked prints its voucher (paid to, date, voucher no., head and reason, amount, how paid, the amount in words, who
// entered it and the receiver's signature); several print the "Daily expenses sheet" – grouped by how they were paid,
// with a total for each and for all. A cancelled expense is never printed.

const amount = (paise) => (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const periodLabel = (from, to) => (from === to ? formatDate(from) : `${formatDate(from)} to ${formatDate(to)}`);

/**
 * The head of a printed voucher or sheet (owner, 11 Nov 2026: "make the header attractive"): the hospital's logo, name
 * and address on the left, the document's name in an indigo badge on the right with its number and date under it, and
 * a two-tone rule below. facts: [label, value] pairs shown in the badge.
 */
export function ExpenseDocHead({ letterhead, title, facts = [] }) {
  const lh = letterhead ?? {};
  const contact = [lh.phone && `Phone ${lh.phone}`, lh.email].filter(Boolean).join('  ·  ');
  return (
    <header className="exh">
      <div className="exh-hospital">
        {lh.logo ? (
          <img className="exh-logo" src={lh.logo} alt="" />
        ) : (
          <div className="exh-mark" aria-hidden="true">
            <Hospital />
          </div>
        )}
        <div className="exh-text">
          <div className="exh-name">{lh.name || 'Hospital name'}</div>
          {lh.tagline && <div className="exh-tagline">{lh.tagline}</div>}
          {lh.address && <div className="exh-line">{lh.address}</div>}
          {contact && <div className="exh-line">{contact}</div>}
          {lh.registrationNumber && <div className="exh-line">Reg. No. {lh.registrationNumber}</div>}
        </div>
      </div>
      <div className="exh-badge">
        <h1 className="exh-title">{title}</h1>
        {facts.length > 0 && (
          <dl className="exh-facts">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </header>
  );
}

/** One expense as a voucher. */
export function ExpenseVoucher({ expense: e, hospitalName }) {
  return (
    <div className="exv">
      <table className="exv-table">
        <tbody>
          <tr>
            <td>
              <span className="exv-label">Paid to:</span> {e.paidTo}
            </td>
            <td className="exv-right">
              <span className="exv-label">Date:</span> {formatDate(e.date)}
              {e.time && ` ${e.time}`}
            </td>
          </tr>
          <tr>
            <td>
              <span className="exv-label">Voucher no.:</span> {e.voucherNo}
            </td>
            <th scope="col" className="exv-amount">
              Amount
            </th>
          </tr>
          <tr className="exv-body">
            <td>
              <p>
                <span className="exv-label">On account:</span> {expenseFor(e)}
              </p>
              <p>
                <span className="exv-label">Narration:</span> {e.description}
              </p>
            </td>
            <td className="exv-amount">{amount(e.amountPaise)}</td>
          </tr>
          <tr>
            <td>
              <span className="exv-label">Payment:</span> {paidHow(e)}
              <span className="exv-total-label">Total:</span>
            </td>
            <td className="exv-amount">
              <strong>{amount(e.amountPaise)}</strong>
            </td>
          </tr>
          <tr>
            <td colSpan={2} className="exv-foot">
              <p>
                <span className="exv-label">Amount in words:</span> {amountInWords(e.amountPaise)}
              </p>
              <div className="exv-signs">
                <span>
                  <span className="exv-label">User:</span> {e.byName}
                </span>
                <strong>For {hospitalName}</strong>
                <span className="exv-receiver">
                  <span className="exv-sign-box" />
                  Receiver's signature
                </span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Several expenses as the daily expenses sheet. */
export function ExpenseSheet({ expenses }) {
  const sheet = expenseSheet(expenses);
  return (
    <>
      <table className="exs-table">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Voucher no.</th>
            <th scope="col">Person name</th>
            <th scope="col">Head</th>
            <th scope="col" className="num">
              Amount
            </th>
            <th scope="col">Narration</th>
            <th scope="col">User name</th>
          </tr>
        </thead>
        {sheet.groups.map((g) => (
          <tbody key={g.mode}>
            <tr className="exs-group">
              <th scope="rowgroup" colSpan={7}>
                {g.label}
              </th>
            </tr>
            {g.expenses.map((e) => (
              <tr key={e.id}>
                <td>{formatDate(e.date)}</td>
                <td>{e.voucherNo}</td>
                <td>{e.paidTo}</td>
                <td>{expenseFor(e)}</td>
                <td className="num">{amount(e.amountPaise)}</td>
                <td>{g.mode === 'cash' ? e.description : [paidHow(e), e.description].filter(Boolean).join(' – ')}</td>
                <td>{e.byName}</td>
              </tr>
            ))}
            <tr className="exs-subtotal">
              <th scope="row" colSpan={4}>
                {g.label} amount
              </th>
              <td className="num">{amount(g.totalPaise)}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        ))}
        <tfoot>
          <tr className="exs-total">
            <th scope="row" colSpan={4}>
              Total amount
            </th>
            <td className="num">{amount(sheet.totalPaise)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </>
  );
}

/** What the head says: a voucher's number and date, or the sheet's period, count and print time. */
export function expenseHead(expenses, printedAt = new Date()) {
  const days = expenses.map((e) => e.date).sort();
  const [from, to] = [days[0], days[days.length - 1]];
  if (expenses.length === 1) {
    const e = expenses[0];
    return { title: 'Payment voucher', facts: [e.voucherNo && ['Voucher no.', e.voucherNo], ['Date', `${formatDate(e.date)}${e.time ? `, ${e.time}` : ''}`]].filter(Boolean) };
  }
  return {
    title: 'Daily expenses sheet',
    facts: [
      [from === to ? 'Date' : 'Period', periodLabel(from, to)],
      ['Expenses', String(expenses.filter((e) => !e.cancelled).length)],
      ['Printed', formatDateTime(printedAt)],
    ],
  };
}

/** The print preview: a voucher for one expense, the sheet for several (its period: their first and last day). */
export function ExpensePrintPreview({ expenses, onClose }) {
  const days = expenses.map((e) => e.date).sort();
  const [from, to] = [days[0], days[days.length - 1]];
  const lh = useFetch('/tenant/settings/letterhead');
  const letterhead = lh.data?.letterhead ?? (lh.data ? { name: lh.data.hospitalName } : null);
  const hospitalName = letterhead?.name || 'the hospital';
  const one = expenses.length === 1 ? expenses[0] : null;
  const name = one ? `Expense voucher ${one.date}` : `Daily expenses sheet ${from === to ? from : `${from} to ${to}`}`;
  return (
    <PrintPreview
      title={one ? 'Expense voucher – print preview' : 'Daily expenses sheet – print preview'}
      hint={one ? 'The voucher for the person paid to sign.' : `${expenses.length} expenses, grouped by how they were paid.`}
      pdf={{ fileName: `${name}.pdf`, title: name, share: false }}
      docKey={lh.data ? `${expenses.map((e) => e.id).join(',')}` : null}
      pageNumbers={!one}
      onClose={onClose}
    >
      <PrintDocument className="bill-doc exp-print-doc">
        {letterhead && <ExpenseDocHead letterhead={letterhead} {...expenseHead(expenses)} />}
        {one ? <ExpenseVoucher expense={one} hospitalName={hospitalName} /> : <ExpenseSheet expenses={expenses} />}
      </PrintDocument>
    </PrintPreview>
  );
}
