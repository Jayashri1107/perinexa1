import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, Field } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { linesByHead } from './billHeads.js';
import { NO_SEX_WORDS_HINT, rupees, toInput, toPaise } from './billingFormat.js';
import { Modal } from './billingUi.jsx';

// Adding and taking off services as on the hospital's old billing screen (11 Nov 2026): one row above the services –
// Service, Rate, Qty, Doctor, Total, Add – and tick boxes to take several off at once (one reason for all). Used by the
// IPD bill window and the OPD bill page. The printed bill's items under their headings (billHeads.js).

/** The billing department and the hospital admin may type another rate for a listed service (audited on the server). */
export const canChangeRate = (roles = []) => roles.includes('billing') || roles.includes('admin');

export function ServiceEntryRow({ bill, roles, onDone, onMore }) {
  const prices = useFetch('/billing/prices');
  const doctors = useFetch('/tenant/doctors');
  const [itemId, setItemId] = useState('');
  const [rate, setRate] = useState('');
  const [qty, setQty] = useState('1');
  const [doctorId, setDoctorId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const items = (prices.data?.items ?? []).filter((i) => i.active);
  const groups = prices.data?.groups ?? [];
  const allDoctors = doctors.data?.doctors ?? [];
  const own = allDoctors.find((d) => d.name === bill.doctorName);
  const doctor = doctorId ?? own?.id ?? '';
  const item = items.find((i) => i.id === itemId);
  const listed = Boolean(item?.pricePaise);
  const rateEditable = Boolean(item) && (!listed || canChangeRate(roles));
  const ratePaise = toPaise(rate);
  const count = Number(qty);
  const qtyOk = Number.isInteger(count) && count >= 1 && count <= 365;
  const total = ratePaise != null && qtyOk ? ratePaise * count : null;
  const ready = Boolean(item) && ratePaise > 0 && qtyOk && !busy;

  const choose = (id) => {
    const next = items.find((i) => i.id === id);
    setItemId(id);
    setRate(next ? toInput(next.pricePaise) : '');
    setFields({});
    setError(null);
  };
  const add = async () => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const sendRate = !listed || ratePaise !== item.pricePaise;
      const out = await api(`/billing/bills/${bill.id}/lines`, {
        method: 'POST',
        body: { priceItemId: item.id, qty: count, ...(sendRate ? { ratePaise } : {}), ...(doctor ? { doctorId: doctor } : {}) },
      });
      setBusy(false);
      choose('');
      setQty('1');
      onDone(out, `Added ${item.name}: ${rupees(ratePaise * count)}.`);
    } catch (err) {
      setBusy(false);
      setError(err.message);
      setFields(err.fields ?? {});
    }
  };

  return (
    <section className="svc-entry" aria-label="Add a service">
      <Alert type="error">{error || prices.error}</Alert>
      <div className="svc-entry-row">
        <Field label="Service name" id="svc-entry-item" error={fields.priceItemId}>
          <select id="svc-entry-item" value={itemId} onChange={(e) => choose(e.target.value)}>
            <option value="">{prices.data ? 'Choose a service…' : 'Loading the price list…'}</option>
            {groups
              .filter((g) => items.some((i) => i.group === g.key))
              .map((g) => (
                <optgroup key={g.key} label={g.label}>
                  {items
                    .filter((i) => i.group === g.key)
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                        {i.pricePaise ? ` – ${rupees(i.pricePaise)}` : ''}
                      </option>
                    ))}
                </optgroup>
              ))}
          </select>
        </Field>
        <Field label="Rate (₹)" id="svc-entry-rate" error={fields.ratePaise}>
          <input id="svc-entry-rate" inputMode="decimal" className="tabular" value={rate} readOnly={!rateEditable} onChange={(e) => setRate(e.target.value)} />
        </Field>
        <Field label="Qty" id="svc-entry-qty" error={fields.qty}>
          <input id="svc-entry-qty" inputMode="numeric" className="tabular" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Doctor name" id="svc-entry-doctor" error={fields.doctorId}>
          <select id="svc-entry-doctor" value={doctor} onChange={(e) => setDoctorId(e.target.value)}>
            <option value="">No doctor</option>
            {allDoctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="svc-entry-total">
          <span className="svc-entry-total-label">Total amount</span>
          <strong className="tabular" aria-live="polite">
            {total != null ? rupees(total) : '–'}
          </strong>
        </div>
        <button type="button" className="btn btn-secondary" disabled={!ready} onClick={add}>
          <Plus aria-hidden="true" /> {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
      <p className="muted svc-entry-hint">
        {item && listed && !rateEditable ? 'Listed rate. The billing department or the hospital admin can change it for this bill.' : ''}
        {item && listed && rateEditable && ratePaise !== item.pricePaise ? `List rate ${rupees(item.pricePaise)} – the rate you typed is kept in the audit log. ` : ''}
        {item && !listed ? 'This service has no listed price: enter the rate. ' : ''}
        {onMore && (
          <button type="button" className="btn btn-link btn-sm" onClick={onMore}>
            Add several at once
          </button>
        )}
      </p>
    </section>
  );
}

/** Take the ticked lines off, with one reason for all. Stops at the first refusal; what was taken off stays off. */
export function RemoveTickedDialog({ bill, lines, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const sum = lines.reduce((s, l) => s + l.amountPaise, 0);
  const go = async () => {
    setBusy(true);
    setError(null);
    let last = null;
    let n = 0;
    try {
      for (const l of lines) {
        last = await api(`/billing/bills/${bill.id}/lines/${l.id}/remove`, { method: 'POST', body: { reason: reason.trim() } });
        n += 1;
      }
      onDone(last, `${n} service${n > 1 ? 's' : ''} removed: ${rupees(sum)}.`);
    } catch (err) {
      setBusy(false);
      setError(`${lines[n].name}: ${err.message}${n ? ` (${n} removed before it)` : ''}`);
      if (last) onDone(last, null, { keepOpen: true });
    }
  };
  return (
    <Modal id="bill-remove-ticked" title={`Remove ${lines.length} service${lines.length > 1 ? 's' : ''}`} onClose={onClose}>
      <p>
        {lines.map((l) => l.name).join(', ')} – {rupees(sum)} comes off the bill. The lines are kept, marked Removed, with the reason.
      </p>
      <Alert type="error">{error}</Alert>
      <Field label="Reason" id="bill-remove-ticked-reason" hint={NO_SEX_WORDS_HINT}>
        <input id="bill-remove-ticked-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
      <div className="row">
        <button type="button" className="btn btn-danger" disabled={reason.trim().length < 3 || busy} onClick={go}>
          {busy ? 'Removing…' : 'Remove them'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Keep them
        </button>
      </div>
    </Modal>
  );
}

/**
 * The printed bill's items under their headings, as on the old IP final bill: the heading with its total, the ward
 * (class) under it for a stay, then each service with its doctor, "price × qty" and amount.
 */
export function HeadedBillLines({ lines, classLabel = '' }) {
  return (
    <table className="bill-doc-lines bill-doc-headed">
      <thead>
        <tr>
          <th scope="col">Service name</th>
          <th scope="col">Doctor</th>
          <th scope="col" className="num">
            Price
          </th>
          <th scope="col" className="num">
            Qty
          </th>
          <th scope="col" className="num">
            Total amount
          </th>
        </tr>
      </thead>
      {linesByHead(lines).map((h) => (
        <tbody key={h.key}>
          <tr className="bill-doc-group">
            <th scope="rowgroup" colSpan={4}>
              {h.label}
              {classLabel && <span className="bill-doc-class">{classLabel}</span>}
            </th>
            <td className="num">{rupees(h.amountPaise)}</td>
          </tr>
          {h.lines.map((l) => (
            <tr key={l.id}>
              <td className="bill-doc-indent">{l.name}</td>
              <td>{l.doctorName}</td>
              <td className="num">{rupees(l.ratePaise)}</td>
              <td className="num">× {l.qty}</td>
              <td className="num">{rupees(l.amountPaise)}</td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}
