import { useState } from 'react';
import { Ban, CircleAlert, CircleCheck, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, Field, StatusPill, formatDate } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { toPaise } from '../billing/billingFormat.js';
import { Modal, money, useSend } from './pharmacyUi.jsx';
import { DateText } from '../../components/DateText.jsx';

// PH11 (docs/PHARMACY_BUILD_NOTE.md): what a supplier is owed – its bills with tax, less returns (debit notes) and
// the payments entered here; due on the bill date + the supplier's credit days; what is paid settles the oldest bills
// first (or the bills a payment names). The pharmacist enters payments; the hospital admin sees them. Not sent to
// Tally yet – the accountant keeps entering payments there until purchases go to Tally.

export const PAYMENT_MODE_WORDS = { cash: 'Cash', cheque: 'Cheque', bank: 'Bank transfer', upi: 'UPI' };

function PayDialog({ supplierId, bills, onClose, onDone }) {
  const [on, setOn] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('bank');
  const [reference, setReference] = useState('');
  const [chosen, setChosen] = useState([]);
  const s = useSend(onDone);
  const amountPaise = toPaise(amount);
  const open = bills.filter((b) => b.leftPaise > 0);
  const ready = Number.isFinite(amountPaise) && amountPaise > 0 && (mode === 'cash' || reference.trim().length >= 2);
  return (
    <Modal id="sp-pay" title="Record a payment to the supplier" onClose={onClose}>
      <Alert type="error">{s.error}</Alert>
      <div className="form-grid">
        <Field label="Date" id="sp-on" error={s.fields.on}>
          <DateText id="sp-on" value={on} onChange={(v) => setOn(v)} />
        </Field>
        <Field label="Amount ₹" id="sp-amt" error={s.fields.amountPaise}>
          <input id="sp-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label="How" id="sp-mode">
          <select id="sp-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            {Object.entries(PAYMENT_MODE_WORDS).map(([k, w]) => (
              <option key={k} value={k}>
                {w}
              </option>
            ))}
          </select>
        </Field>
        <Field label={mode === 'cash' ? 'Reference (optional)' : 'Cheque or transaction number'} id="sp-ref" error={s.fields.reference}>
          <input id="sp-ref" maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
      {open.length > 0 && (
        <fieldset className="fieldset">
          <legend>The bills it pays (optional – otherwise the oldest first)</legend>
          {open.map((b) => (
            <label key={b.id} className="check">
              <input type="checkbox" checked={chosen.includes(b.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, b.id] : chosen.filter((x) => x !== b.id))} /> {b.invoiceNo} of {formatDate(b.invoiceDate)} – {money(b.leftPaise)} left
            </label>
          ))}
        </fieldset>
      )}
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={!ready || s.busy} onClick={() => s.send(`/pharmacy/suppliers/${supplierId}/payments`, { on, amountPaise, mode, reference: reference.trim(), purchaseIds: chosen })}>
          {s.busy ? 'Saving…' : 'Save the payment'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function CancelPayment({ payment, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const s = useSend(onDone);
  return (
    <Modal id="sp-cancel" title={`Cancel payment ${payment.number}`} onClose={onClose}>
      <p>It stays on the list, marked cancelled, and no longer counts.</p>
      <Alert type="error">{s.error}</Alert>
      <Field label="Reason" id="sp-cancel-reason">
        <input id="sp-cancel-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
      <div className="row">
        <button type="button" className="btn btn-danger" disabled={reason.trim().length < 3 || s.busy} onClick={() => s.send(`/pharmacy/supplier-payments/${payment.id}/cancel`, { reason: reason.trim() })}>
          Cancel the payment
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Keep it
        </button>
      </div>
    </Modal>
  );
}

/** The supplier's account on its page. */
export function SupplierAccountCard({ supplierId }) {
  const res = useFetch(`/pharmacy/suppliers/${supplierId}/account`);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [flash, setFlash] = useState(null);
  const a = res.data;
  if (res.error) return <Alert type="error">{res.error}</Alert>;
  if (!a) return null;
  const t = a.totals;
  const after = (message) => () => {
    setPaying(false);
    setCancelling(null);
    setFlash(message);
    res.reload();
  };
  return (
    <section className="card bill-section" aria-labelledby="sup-account">
      <div className="row-between">
        <h2 id="sup-account">
          <Wallet aria-hidden="true" /> Account
        </h2>
        {a.canPay && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPaying(true)}>
            Record a payment
          </button>
        )}
      </div>
      <Alert type="success" onClose={() => setFlash(null)}>
        {flash}
      </Alert>
      <dl className="ph-facts">
        <div>
          <dt>Bills (with tax)</dt>
          <dd>{money(t.billedPaise)}</dd>
        </div>
        <div>
          <dt>Returned (debit notes)</dt>
          <dd>{t.returnedPaise ? `−${money(t.returnedPaise)}` : '—'}</dd>
        </div>
        <div>
          <dt>Paid</dt>
          <dd>{t.paidPaise ? `−${money(t.paidPaise)}` : '—'}</dd>
        </div>
        <div>
          <dt>Owed</dt>
          <dd>
            <strong>{money(t.owedPaise)}</strong>{' '}
            {t.overduePaise > 0 ? (
              <StatusPill tone="high" icon={CircleAlert}>
                {money(t.overduePaise)} overdue
              </StatusPill>
            ) : t.owedPaise <= 0 ? (
              <StatusPill tone="stable" icon={CircleCheck}>
                Settled
              </StatusPill>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Credit days</dt>
          <dd>{a.supplier.creditDays || 'None (due on the bill date)'}</dd>
        </div>
      </dl>
      {a.taxMissing > 0 && <p className="hint">{a.taxMissing} older bill{a.taxMissing === 1 ? ' has' : 's have'} no GST recorded: counted at the value before tax.</p>}
      {a.bills.some((b) => b.leftPaise > 0) && (
        <table className="bill-report">
          <caption className="sr-only">Bills still to pay</caption>
          <thead>
            <tr>
              <th scope="col">Bill</th>
              <th scope="col">Due</th>
              <th scope="col" className="num">Amount</th>
              <th scope="col" className="num">Left</th>
            </tr>
          </thead>
          <tbody>
            {a.bills
              .filter((b) => b.leftPaise > 0)
              .map((b) => (
                <tr key={b.id}>
                  <td>
                    {b.invoiceNo} <span className="muted">({b.number}, {formatDate(b.invoiceDate)})</span>
                  </td>
                  <td>
                    {formatDate(b.dueDate)}{' '}
                    {b.overdue && (
                      <StatusPill tone="high" icon={CircleAlert}>
                        Overdue
                      </StatusPill>
                    )}
                  </td>
                  <td className="num">{money(b.amountPaise)}</td>
                  <td className="num">{money(b.leftPaise)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
      {a.payments.length > 0 && (
        <>
          <h3>Payments</h3>
          <ul className="plain-list">
            {a.payments.map((p) => (
              <li key={p.id} className={p.cancelled ? 'muted' : ''}>
                {p.number} · {formatDate(p.on)} · {money(p.amountPaise)} · {PAYMENT_MODE_WORDS[p.mode] ?? p.mode}
                {p.reference ? ` ${p.reference}` : ''} · {p.byName}
                {p.cancelled ? (
                  <>
                    {' '}
                    <StatusPill tone="inactive" icon={Ban}>
                      Cancelled
                    </StatusPill>{' '}
                    {p.cancelled.reason}
                  </>
                ) : (
                  a.canPay && (
                    <button type="button" className="btn btn-link btn-sm" onClick={() => setCancelling(p)}>
                      Cancel
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {paying && <PayDialog supplierId={supplierId} bills={a.bills} onClose={() => setPaying(false)} onDone={after('Payment saved.')} />}
      {cancelling && <CancelPayment payment={cancelling} onClose={() => setCancelling(null)} onDone={after(`Payment ${cancelling.number} cancelled.`)} />}
    </section>
  );
}

/** PH11: Reports → Purchases – owed and overdue for every supplier. */
export function SupplierDues() {
  const res = useFetch('/pharmacy/reports/supplier-dues');
  const d = res.data;
  if (res.error) return <Alert type="error">{res.error}</Alert>;
  if (!d) return null;
  return (
    <section className="card bill-section" aria-labelledby="rep-dues">
      <h2 id="rep-dues">What each supplier is owed</h2>
      <p className="hint">Bills with tax, less returns and the payments entered in Perinexa. Overdue: past the bill date plus the supplier’s credit days.</p>
      <table className="bill-report">
        <thead>
          <tr>
            <th scope="col">Supplier</th>
            <th scope="col" className="num">Owed</th>
            <th scope="col" className="num">Overdue</th>
          </tr>
        </thead>
        <tbody>
          {d.suppliers.map((s) => (
            <tr key={s.id}>
              <td>
                <Link to={`/pharmacy/suppliers/${s.id}`}>{s.name}</Link>
              </td>
              <td className="num">{money(s.owedPaise)}</td>
              <td className="num">{s.overduePaise ? money(s.overduePaise) : '—'}</td>
            </tr>
          ))}
          {!d.suppliers.length && (
            <tr>
              <td colSpan={3} className="muted">
                No bills yet.
              </td>
            </tr>
          )}
          <tr className="bill-report-total">
            <th scope="row">All suppliers</th>
            <td className="num">{money(d.owedPaise)}</td>
            <td className="num">{d.overduePaise ? money(d.overduePaise) : '—'}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
