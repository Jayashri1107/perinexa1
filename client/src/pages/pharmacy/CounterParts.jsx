import { useEffect, useRef, useState } from 'react';
import { CircleCheck, CircleX } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { expiryLabel } from './pharmacyFormat.js';

// The counter's two windows from the store's earlier software (7 Nov 2026): the batches of the medicine chosen, to pick
// one with the arrow keys, and the Payment window that opens when the bill is saved.

const two = (paise) => (paise == null ? '' : (paise / 100).toFixed(2));
// The hospital's day and time (India), as the expense form reads them
const hospitalTodayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const hospitalTime = (d) => d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
const dmy = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

/**
 * The batches of one medicine in stock (not expired), earliest expiry first, in the earlier software's columns. The first
 * is marked; the arrow keys move, Enter (or a click) takes the batch, Esc goes back. onPick(batch), onCancel().
 */
export function BatchGrid({ medicine, onPick, onCancel }) {
  const res = useFetch(`/pharmacy/medicines/${medicine.id}/batches`);
  const batches = res.data?.batches ?? [];
  const [at, setAt] = useState(0);
  const box = useRef(null);
  useEffect(() => {
    if (res.data) box.current?.focus();
  }, [res.data]);
  useEffect(() => {
    box.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [at]);
  const keys = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setAt((i) => (e.key === 'ArrowDown' ? Math.min(batches.length - 1, i + 1) : Math.max(0, i - 1)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (batches[at]) onPick(batches[at]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };
  const warn = res.data?.warnDays ?? 30;
  return (
    <section className="ph-batchgrid" aria-label={`Batches of ${medicine.name}`}>
      <div className="ph-batchgrid-title">
        <strong>Batch no · {medicine.name}</strong>
        <button type="button" className="btn btn-link btn-sm" onClick={onCancel}>
          Back
        </button>
      </div>
      {res.error && <Alert type="error">{res.error}</Alert>}
      {res.data && !batches.length && <p className="muted">No batch of {medicine.name} is in stock and in date. Receive it under Purchases first.</p>}
      {batches.length > 0 && (
        <div className="ph-batchgrid-scroll" ref={box} tabIndex={0} role="listbox" aria-label={`Choose a batch of ${medicine.name}`} aria-activedescendant={`ph-batch-${at}`} onKeyDown={keys}>
          <table className="ph-batchgrid-table">
            <thead>
              <tr>
                <th scope="col">Batch no</th>
                <th scope="col">Exp. date</th>
                <th scope="col" className="num">Bal qty</th>
                <th scope="col" className="num">Unit landed</th>
                <th scope="col">Pur. from</th>
                <th scope="col">Bill no</th>
                <th scope="col">Bill date</th>
                <th scope="col" className="num">Prod MRP</th>
                <th scope="col" className="num">Conv factor</th>
                <th scope="col" className="num">Unit MRP</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b, i) => (
                <tr key={b.id} id={`ph-batch-${i}`} role="option" aria-selected={i === at} onMouseMove={() => setAt(i)} onClick={() => onPick(b)}>
                  <td className="tabular">{b.batch}</td>
                  <td className="tabular">
                    {expiryLabel(b.expiry)}
                    {b.daysLeft <= warn ? <span className="ph-batch-soon"> · expires soon</span> : null}
                  </td>
                  <td className="num tabular">{b.qtyLeft}</td>
                  <td className="num tabular">{two(b.costPaise)}</td>
                  <td className="ph-batchgrid-from">{b.supplier || (b.billNo ? '' : 'Opening stock')}</td>
                  <td className="tabular">{b.billNo}</td>
                  <td className="tabular">{dmy(b.billDate)}</td>
                  <td className="num tabular">{two(b.packMrpPaise)}</td>
                  <td className="num tabular">{Number(b.conv ?? 1).toFixed(4)}</td>
                  <td className="num tabular">{two(b.mrpPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {batches.length > 0 && <p className="hint">↑ ↓ to move, Enter to choose the batch, Esc to go back.</p>}
    </section>
  );
}

// The ways a walk-in pays, as the Payment window lists them. Online / wallets is kept as UPI.
const WAYS = [
  { mode: 'cash', label: 'Cash' },
  { mode: 'cheque', label: 'Cheque', ref: 'Cheque no', bank: 'Bank name' },
  { mode: 'card', label: 'Card', ref: 'Card no (last 4 digits)', bank: 'Bank name' },
  { mode: 'neft', label: 'NEFT / RTGS', ref: 'Transaction id', bank: 'Bank name' },
  { mode: 'upi', label: 'Online / wallets', ref: 'Transaction id', bank: 'Wallet name' },
];
const toPaise = (text) => (/^\d+(\.\d{0,2})?$/.test(String(text).trim()) ? Math.round(Number(text) * 100) : null);

/**
 * The Payment window: opens when the bill is saved. The bill's figures on the left (worked out by the server, so they are
 * exactly the invoice's); on the right, for a walk-in, how it is paid – cash, cheque, card, NEFT / RTGS or online, alone
 * or in parts that make up the bill. A registered patient pays at the billing desk: her invoice goes on her hospital bill.
 * body: the invoice about to be made (without the payment); who: { uhid, name }; onSave({ payments, paymentRemarks }).
 */
export function PaymentWindow({ body, who, walkIn, saving, error, onSave, onClose }) {
  const ref = useDialogFocus(onClose);
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const today = hospitalTodayIso();
  const [ways, setWays] = useState(() => Object.fromEntries(WAYS.map((w) => [w.mode, { on: false, amount: '', reference: '', bank: '', date: today, authorisedBy: '', narration: '' }])));
  const [remarks, setRemarks] = useState('');
  const [now] = useState(() => new Date());
  useEffect(() => {
    let current = true;
    api('/pharmacy/invoices/quote', { method: 'POST', body })
      .then((res) => current && setQuote(res.quote))
      .catch((err) => current && setQuoteError(err.message));
    return () => {
      current = false;
    };
  }, [body]);

  const net = quote?.totalPaise ?? 0;
  const chosen = WAYS.filter((w) => ways[w.mode].on);
  const amounts = chosen.map((w) => toPaise(ways[w.mode].amount));
  const paid = amounts.reduce((n, a) => n + (a ?? 0), 0);
  const balance = walkIn ? net - paid : net;
  const cardOk = !ways.card.on || !ways.card.reference.trim() || /^\d{4}$/.test(ways.card.reference.trim());
  const ready = Boolean(quote) && !saving && (!walkIn || (chosen.length > 0 && amounts.every((a) => a && a > 0) && balance === 0 && cardOk));
  const set = (mode, change) => setWays((all) => ({ ...all, [mode]: { ...all[mode], ...change } }));
  // Ticking a way fills in what is still to pay; unticking clears it
  const tick = (mode, on) => set(mode, on ? { on, amount: balance > 0 ? two(balance) : '' } : { on, amount: '' });
  const save = () =>
    onSave(
      walkIn
        ? {
            payments: chosen.map((w) => {
              const x = ways[w.mode];
              return {
                mode: w.mode,
                amountPaise: toPaise(x.amount),
                ...(w.ref && x.reference.trim() ? { reference: x.reference.trim() } : {}),
                ...(w.bank && x.bank.trim() ? { bank: x.bank.trim() } : {}),
                ...(w.ref && x.date ? { on: x.date } : {}),
                ...(w.mode === 'cheque' && x.authorisedBy.trim() ? { authorisedBy: x.authorisedBy.trim() } : {}),
                ...(w.mode === 'cheque' && x.narration.trim() ? { narration: x.narration.trim() } : {}),
              };
            }),
            paymentRemarks: remarks.trim(),
          }
        : {},
    );

  const fact = (label, value, id) => (
    <div className="ph-pay-fact">
      <label htmlFor={id}>{label}</label>
      <input id={id} readOnly value={value} className="tabular" />
    </div>
  );
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="modal modal-wide ph-pay" role="dialog" aria-modal="true" aria-labelledby="ph-pay-title">
        <h2 id="ph-pay-title" className="ph-pay-title">
          Payment
        </h2>
        <Alert type="error">{quoteError || error}</Alert>
        <div className="ph-pay-body">
          <div className="ph-pay-left">
            {fact('UHID', who.uhid || '–', 'ph-pay-uhid')}
            {fact('Patient name', who.name, 'ph-pay-name')}
            {fact('Bill no', 'New', 'ph-pay-billno')}
            {fact('Bill date', dmy(today), 'ph-pay-billdate')}
            {fact('Date', `${dmy(today)} ${hospitalTime(now)}`, 'ph-pay-date')}
            {fact('Bill amount', quote ? two(quote.atMrpPaise) : '…', 'ph-pay-amount')}
            {fact('Concession amt.', quote ? two(quote.atMrpPaise - quote.totalPaise) : '…', 'ph-pay-concession')}
            {fact('Net pay amt', quote ? two(net) : '…', 'ph-pay-net')}
            {fact('Balance amount', quote ? two(balance) : '…', 'ph-pay-balance')}
          </div>
          <div className="ph-pay-right">
            {walkIn ? (
              <>
                <div className="ph-pay-grid">
                  {WAYS.map((w) => {
                    const x = ways[w.mode];
                    const id = `ph-pay-${w.mode}`;
                    return (
                      <fieldset key={w.mode} className={`ph-pay-way${x.on ? ' is-on' : ''}`}>
                        <legend className="sr-only">{w.label}</legend>
                        <label className="ph-pay-tick">
                          <input type="checkbox" checked={x.on} onChange={(e) => tick(w.mode, e.target.checked)} /> {w.label}
                        </label>
                        <label className="ph-pay-field">
                          <span>Amount</span>
                          <input id={`${id}-amount`} inputMode="decimal" className="tabular" disabled={!x.on} value={x.amount} maxLength={12} onChange={(e) => set(w.mode, { amount: e.target.value })} />
                        </label>
                        {w.ref && (
                          <>
                            <label className="ph-pay-field">
                              <span>{w.ref}</span>
                              <input
                                disabled={!x.on}
                                value={x.reference}
                                maxLength={w.mode === 'card' ? 4 : 80}
                                inputMode={w.mode === 'card' ? 'numeric' : undefined}
                                autoComplete="off"
                                onChange={(e) => set(w.mode, { reference: w.mode === 'card' ? e.target.value.replace(/\D/g, '') : e.target.value })}
                              />
                            </label>
                            <label className="ph-pay-field">
                              <span>{w.bank}</span>
                              <input disabled={!x.on} value={x.bank} maxLength={80} onChange={(e) => set(w.mode, { bank: e.target.value })} />
                            </label>
                            <label className="ph-pay-field">
                              <span>Date</span>
                              <input type="date" disabled={!x.on} value={x.date} onChange={(e) => set(w.mode, { date: e.target.value })} />
                            </label>
                          </>
                        )}
                        {w.mode === 'cheque' && (
                          <div className="ph-pay-extra">
                            <label className="ph-pay-field">
                              <span>Authorised by</span>
                              <input disabled={!x.on} value={x.authorisedBy} maxLength={100} onChange={(e) => set(w.mode, { authorisedBy: e.target.value })} />
                            </label>
                            <label className="ph-pay-field ph-pay-wide">
                              <span>Narration</span>
                              <input disabled={!x.on} value={x.narration} maxLength={200} onChange={(e) => set(w.mode, { narration: e.target.value })} />
                            </label>
                          </div>
                        )}
                      </fieldset>
                    );
                  })}
                </div>
                {!cardOk && <p className="field-error">Write only the last 4 digits of the card, never the whole number.</p>}
                <label className="ph-pay-field ph-pay-wide">
                  <span>Remarks</span>
                  <input value={remarks} maxLength={200} onChange={(e) => setRemarks(e.target.value)} />
                </label>
              </>
            ) : (
              <p className="ph-pay-hospital">The invoice goes on the patient’s hospital bill. The payment is taken at the billing desk, not at the pharmacy counter.</p>
            )}
          </div>
        </div>
        <div className="ph-pay-foot">
          {walkIn && (
            <div className="ph-pay-sums">
              {fact('Paid amount', two(paid), 'ph-pay-paid')}
              {fact('Bal amt', quote ? two(balance) : '…', 'ph-pay-bal')}
            </div>
          )}
          <div className="ph-pay-actions">
            <button type="button" className="btn btn-primary" disabled={!ready} onClick={save}>
              <CircleCheck aria-hidden="true" /> {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              <CircleX aria-hidden="true" /> Close
            </button>
          </div>
        </div>
        {walkIn && quote && balance !== 0 && chosen.length > 0 && <p className="hint">{balance > 0 ? `₹${two(balance)} is still to be paid.` : `₹${two(-balance)} more than the bill: lower an amount.`}</p>}
      </div>
    </div>
  );
}
