import { useRef, useState } from 'react';
import { Ban, Paperclip, Plus } from 'lucide-react';
import { api, apiFile } from '../../api.js';
import { Alert, Field, formatDate } from '../../components/ui.jsx';
import { fileBody, fileProblem, fileSize } from '../../components/fileUpload.js';
import { downloadFile } from '../../components/print/pdfExport.js';
import { rupees } from './billingFormat.js';
import { Modal } from './billingUi.jsx';
import { BANKS, EXPENSE_MODE_LABELS, OTHER_BANK, WALLETS, blankExpense, expenseFor, expensePayload, expenseProblems, expensesTotal, paidHow } from './expenseFormat.js';

// Entering and listing the expenses paid from the counter: the Daily Expenses page and Billing → Daily summary share
// these (owner, 28 Oct 2026). The form follows the hospital's old "Daily Expenses" screen: date and time, the person
// paid, the head, the voucher number, the amount, cash / cheque / UPI or wallet / bank / card with their details, the
// reason and the bill as a file.

/**
 * Enter one expense. heads: the hospital's list ({ id, name, active }); date: a fixed day (the daily summary) or
 * undefined to let the date be chosen (the Daily Expenses page). primary: the screen's main button.
 */
export function ExpenseEntryForm({ heads = [], date, onAdded, idPrefix = 'exp', primary = false }) {
  const [v, setV] = useState(() => ({ ...blankExpense(), ...(date ? { date } : {}) }));
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [fields, setFields] = useState({});
  const fileInput = useRef(null);
  const id = (k) => `${idPrefix}-${k}`;
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const active = heads.filter((h) => h.active);

  const chooseFile = (e) => {
    const f = e.target.files?.[0] ?? null;
    const problem = f ? fileProblem(f) : '';
    setFields({ ...fields, file: problem || undefined });
    setFile(problem ? null : f);
    if (problem && fileInput.current) fileInput.current.value = '';
  };

  const save = async (e) => {
    e.preventDefault();
    setSaved(null);
    const problems = expenseProblems(v);
    if (Object.keys(problems).length) {
      setFields(problems);
      setError('Check the marked fields.');
      return;
    }
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const { expense } = await api('/billing/expenses', { method: 'POST', body: expensePayload(v) });
      // The bill: sent after the expense is saved; if it fails, the expense stays and the bill can be tried again
      let fileError = null;
      if (file) {
        try {
          await api(`/billing/expenses/${expense.id}/file`, { method: 'POST', body: await fileBody(file) });
        } catch (err) {
          fileError = `The expense is saved, but the bill was not attached: ${err.message}`;
        }
      }
      setV({ ...blankExpense(), ...(date ? { date } : {}), headId: v.headId });
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      setSaved(`Saved: ${rupees(expense.amountPaise)} to ${expense.paidTo} for ${expense.head}.`);
      setError(fileError);
      onAdded?.(expense);
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="dc-expense-form exp-form" onSubmit={save} noValidate>
      <Alert type="error">{error}</Alert>
      <Alert type="success">{saved}</Alert>
      <div className="exp-grid">
        {!date && (
          <Field label="Date" id={id('date')} error={fields.date}>
            <input id={id('date')} type="date" value={v.date} max={blankExpense().date} onChange={set('date')} />
          </Field>
        )}
        <Field label="Time" id={id('time')} error={fields.time}>
          <input id={id('time')} type="time" value={v.time} onChange={set('time')} />
        </Field>
        <Field label="Person name" id={id('paidto')} error={fields.paidTo} hint="Who was paid. Never a patient.">
          <input id={id('paidto')} value={v.paidTo} onChange={set('paidTo')} maxLength={100} autoComplete="off" />
        </Field>
        <Field label="Head name" id={id('head')} error={fields.headId}>
          <select id={id('head')} value={v.headId} onChange={set('headId')}>
            <option value="">Select</option>
            {active.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Voucher no. (optional)" id={id('voucher')} error={fields.voucherNo}>
          <input id={id('voucher')} value={v.voucherNo} onChange={set('voucherNo')} maxLength={30} autoComplete="off" />
        </Field>
        <Field label="Amount ₹" id={id('amount')} error={fields.amountPaise}>
          <input id={id('amount')} inputMode="decimal" value={v.amount} onChange={set('amount')} placeholder="e.g. 1200" />
        </Field>
      </div>

      <fieldset className="exp-modes">
        <legend>Paid by</legend>
        {Object.entries(EXPENSE_MODE_LABELS).map(([k, label]) => (
          <label key={k} className="exp-mode">
            <input type="radio" name={id('mode')} value={k} checked={v.mode === k} onChange={set('mode')} /> {label}
          </label>
        ))}
      </fieldset>

      {v.mode === 'cheque' && (
        <div className="exp-grid">
          <Field label="Cheque no." id={id('chequeno')} error={fields.chequeNo}>
            <input id={id('chequeno')} inputMode="numeric" value={v.chequeNo} onChange={set('chequeNo')} maxLength={20} autoComplete="off" />
          </Field>
          <Field label="Cheque date" id={id('chequedate')} error={fields.chequeDate}>
            <input id={id('chequedate')} type="date" value={v.chequeDate} onChange={set('chequeDate')} />
          </Field>
        </div>
      )}
      {(v.mode === 'cheque' || v.mode === 'bank') && (
        <div className="exp-grid">
          <Field label={v.mode === 'cheque' ? 'Bank name' : 'Bank name (optional)'} id={id('bank')} error={v.bank === OTHER_BANK ? undefined : fields.bankName}>
            <select id={id('bank')} value={v.bank} onChange={set('bank')}>
              <option value="">Select</option>
              {BANKS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
              <option value={OTHER_BANK}>Other bank</option>
            </select>
          </Field>
          {v.bank === OTHER_BANK && (
            <Field label="Name of the bank" id={id('otherbank')} error={fields.bankName}>
              <input id={id('otherbank')} value={v.otherBank} onChange={set('otherBank')} maxLength={80} />
            </Field>
          )}
        </div>
      )}
      {v.mode === 'upi' && (
        <div className="exp-grid">
          <Field label="Wallet name (optional)" id={id('wallet')} error={fields.walletName}>
            <input id={id('wallet')} list={id('wallets')} value={v.walletName} onChange={set('walletName')} maxLength={40} />
            <datalist id={id('wallets')}>
              {WALLETS.map((w) => (
                <option key={w} value={w} />
              ))}
            </datalist>
          </Field>
        </div>
      )}

      <Field label="Reason (optional)" id={id('reason')} error={fields.description} hint="Never a patient's name or details.">
        <textarea id={id('reason')} rows={2} value={v.description} onChange={set('description')} maxLength={200} />
      </Field>
      <Field label="Bill or voucher (optional)" id={id('file')} error={fields.file} hint="A PDF or a photo, at most 5 MB.">
        <input id={id('file')} ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={chooseFile} />
      </Field>
      {file && (
        <p className="muted exp-file-chosen">
          <Paperclip aria-hidden="true" /> {file.name} ({fileSize(file.size)})
        </p>
      )}
      <button type="submit" className={primary ? 'btn btn-primary' : 'btn btn-secondary'} disabled={busy}>
        <Plus aria-hidden="true" /> {busy ? 'Saving…' : 'Save expense'}
      </button>
    </form>
  );
}

/** Open an expense's attached bill (downloaded to the computer). */
async function openBill(e) {
  const { blob } = await apiFile(`/billing/expenses/${e.id}/file`);
  downloadFile(blob, e.file.fileName);
}

/**
 * The expenses as a table. showDate: a period (the Daily Expenses page); onCancel: the cancel button (screen only).
 * A cancelled expense stays listed, struck through, and counts nothing.
 */
export function ExpensesList({ expenses, onCancel, showDate = false, caption = 'Expenses paid from the counter', empty = 'No expenses entered for this day.' }) {
  const [error, setError] = useState(null);
  const cols = 6 + (showDate ? 1 : 0) + (onCancel ? 1 : 0);
  const open = async (e) => {
    setError(null);
    try {
      await openBill(e);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <>
      <Alert type="error">{error}</Alert>
      <table className="bill-report dc-table dc-expenses">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {showDate && <th scope="col">Date</th>}
            <th scope="col">Time</th>
            <th scope="col">Person name</th>
            <th scope="col">Head</th>
            <th scope="col">Paid by</th>
            <th scope="col" className="num">
              Amount
            </th>
            <th scope="col">Reason</th>
            {onCancel && (
              <th scope="col">
                <span className="sr-only">Bill and cancel</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {expenses.map((e) => (
            <tr key={e.id} className={e.cancelled ? 'dc-cancelled' : undefined}>
              {showDate && <td>{formatDate(e.date)}</td>}
              <td>{e.time || (e.at ? new Date(e.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '')}</td>
              <td>{e.paidTo}</td>
              <td>
                {expenseFor(e)}
                {e.voucherNo && <span className="dc-cancel-note">Voucher {e.voucherNo}</span>}
              </td>
              <td>{paidHow(e)}</td>
              <td className="num">{rupees(e.amountPaise)}</td>
              <td className="dc-wrap">
                {e.description}
                <span className="dc-cancel-note">Entered by {e.byName}</span>
                {e.cancelled && (
                  <span className="dc-cancel-note">
                    Cancelled by {e.cancelled.byName}: {e.cancelled.reason}
                  </span>
                )}
              </td>
              {onCancel && (
                <td className="exp-actions">
                  {e.file && (
                    <button type="button" className="icon-btn" aria-label={`Open the bill ${e.file.fileName}`} title="Open the bill" onClick={() => open(e)}>
                      <Paperclip aria-hidden="true" />
                    </button>
                  )}
                  {!e.cancelled && (
                    <button type="button" className="icon-btn" aria-label={`Cancel the expense of ${rupees(e.amountPaise)}`} title="Cancel (entered by mistake)" onClick={() => onCancel(e)}>
                      <Ban aria-hidden="true" />
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
          {!expenses.length && (
            <tr>
              <td colSpan={cols} className="muted">
                {empty}
              </td>
            </tr>
          )}
          {expensesTotal(expenses) > 0 && (
            <tr className="bill-report-total">
              <th scope="row" colSpan={showDate ? 5 : 4}>
                Total expenses
              </th>
              <td className="num">{rupees(expensesTotal(expenses))}</td>
              <td colSpan={onCancel ? 2 : 1} />
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

export function CancelExpenseDialog({ expense, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/billing/expenses/${expense.id}/cancel`, { method: 'POST', body: { reason: reason.trim() } });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal id="dc-cancel" title={`Cancel the expense of ${rupees(expense.amountPaise)}?`} onClose={onClose}>
      <p>It stays listed, struck through, and is no longer taken off the day's total.</p>
      <Alert type="error">{error}</Alert>
      <Field label="Why is it cancelled" id="dc-cancel-reason">
        <input id="dc-cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. entered twice" autoFocus />
      </Field>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={reason.trim().length < 3 || busy} onClick={send}>
          {busy ? 'Saving…' : 'Cancel the expense'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Keep it
        </button>
      </div>
    </Modal>
  );
}

/** The hospital admin's list of heads: add, rename, switch off or on (a head is never deleted). */
export function ExpenseHeadsDialog({ heads, onClose, onChanged }) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null); // { id, name }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err.fields?.name ?? err.message);
    } finally {
      setBusy(false);
    }
  };
  const add = () =>
    run(async () => {
      await api('/billing/expense-heads', { method: 'POST', body: { name: name.trim() } });
      setName('');
    });
  const rename = () =>
    run(async () => {
      await api(`/billing/expense-heads/${editing.id}`, { method: 'PATCH', body: { name: editing.name.trim() } });
      setEditing(null);
    });
  const toggle = (h) => run(() => api(`/billing/expense-heads/${h.id}`, { method: 'PATCH', body: { active: !h.active } }));
  return (
    <Modal id="exp-heads" title="Expense heads" onClose={onClose}>
      <p className="muted">A head that is switched off is no longer offered; expenses already entered keep it.</p>
      <Alert type="error">{error}</Alert>
      <ul className="exp-heads">
        {heads.map((h) => (
          <li key={h.id} className={h.active ? undefined : 'muted'}>
            {editing?.id === h.id ? (
              <>
                <input aria-label={`New name for ${h.name}`} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={60} autoFocus />
                <button type="button" className="btn btn-secondary" disabled={busy || editing.name.trim().length < 2} onClick={rename}>
                  Save
                </button>
                <button type="button" className="btn btn-link" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span>
                  {h.name}
                  {!h.active && ' (switched off)'}
                </span>
                <button type="button" className="btn btn-link" disabled={busy} onClick={() => setEditing({ id: h.id, name: h.name })}>
                  Rename
                </button>
                <button type="button" className="btn btn-link" disabled={busy} onClick={() => toggle(h)}>
                  {h.active ? 'Switch off' : 'Switch on'}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="row">
        <Field label="New head" id="exp-head-new">
          <input id="exp-head-new" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Generator fuel" />
        </Field>
        <button type="button" className="btn btn-secondary" disabled={busy || name.trim().length < 2} onClick={add}>
          <Plus aria-hidden="true" /> Add head
        </button>
      </div>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
