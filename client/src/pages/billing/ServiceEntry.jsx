import { useEffect, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
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

/**
 * Service name as a box to type in (11 Nov 2026): a few letters show the services that match, with their price, under
 * their group; pick one with the mouse or with the arrow keys and Enter. Escape closes the list. Every word typed must
 * be in the name ("room del" finds "Room charge per day – Deluxe AC").
 */
export function ServicePicker({ id, items, groups, value, onPick, loading = false, ...aria }) {
  const [text, setText] = useState(value?.name ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  useEffect(() => setText(value?.name ?? ''), [value?.id]);
  const typed = open && text !== (value?.name ?? '') ? text : '';
  const words = typed.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const order = groups.map((g) => g.key);
  const shown = items.filter((i) => words.every((w) => i.name.toLowerCase().includes(w))).sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  const labelOf = Object.fromEntries(groups.map((g) => [g.key, g.label]));
  const pick = (item) => {
    onPick(item);
    setText(item.name);
    setOpen(false);
  };
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);
  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && open && shown[active]) {
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
      setText(value?.name ?? '');
    }
  };
  const listId = `${id}-list`;
  return (
    <div className="svc-pick">
      <span className="svc-pick-box">
        <Search aria-hidden="true" />
        <input
          {...aria}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${listId}-${shown[active].id}` : undefined}
          autoComplete="off"
          placeholder={loading ? 'Loading the price list…' : 'Type to search, e.g. room, anaes'}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={(e) => {
            e.target.select();
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
            setText(value?.name ?? '');
          }}
          onKeyDown={onKey}
        />
      </span>
      {open && (
        <ul id={listId} ref={listRef} className="svc-pick-list" role="listbox" aria-label="Services">
          {shown.length === 0 && <li className="svc-pick-none">No service matches. Check the spelling, or ask the hospital admin to add it to the price list.</li>}
          {shown.map((i, n) => (
            <li
              key={i.id}
              id={`${listId}-${i.id}`}
              data-index={n}
              role="option"
              aria-selected={n === active}
              className={n === active ? 'svc-pick-opt is-active' : 'svc-pick-opt'}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(i);
              }}
              onMouseEnter={() => setActive(n)}
            >
              {(n === 0 || shown[n - 1].group !== i.group) && <span className="svc-pick-group">{labelOf[i.group] ?? ''}</span>}
              <span className="svc-pick-name">{i.name}</span>
              <span className="svc-pick-price tabular">{i.pricePaise ? rupees(i.pricePaise) : 'Enter rate'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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

  // Enter in the rate or the quantity adds the line; the service box is then ready for the next one
  const enterAdds = (e) => {
    if (e.key !== 'Enter' || !ready) return;
    e.preventDefault();
    add().then(() => document.getElementById('svc-entry-item')?.focus());
  };

  return (
    <section className="svc-entry" aria-label="Add a service">
      <Alert type="error">{error || prices.error}</Alert>
      <div className="svc-entry-row">
        <Field label="Service name" id="svc-entry-item" error={fields.priceItemId}>
          <ServicePicker
            id="svc-entry-item"
            items={items}
            groups={groups}
            value={item ?? null}
            loading={!prices.data}
            onPick={(i) => {
              choose(i.id);
              // Straight on to the rate (when it may be typed) or the quantity
              setTimeout(() => document.getElementById(i.pricePaise && !canChangeRate(roles) ? 'svc-entry-qty' : 'svc-entry-rate')?.focus(), 0);
            }}
          />
        </Field>
        <Field label="Rate (₹)" id="svc-entry-rate" error={fields.ratePaise}>
          <input id="svc-entry-rate" inputMode="decimal" className="tabular" value={rate} readOnly={!rateEditable} onChange={(e) => setRate(e.target.value)} onKeyDown={enterAdds} />
        </Field>
        <Field label="Qty" id="svc-entry-qty" error={fields.qty}>
          <input id="svc-entry-qty" inputMode="numeric" className="tabular" value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={enterAdds} />
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
