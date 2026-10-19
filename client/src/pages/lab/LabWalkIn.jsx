import { useState } from 'react';
import { Home, Plus } from 'lucide-react';
import { api } from '../../api.js';
import { Field, formatDate, formatDateTime } from '../../components/ui.jsx';
import { Letterhead } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintFacts, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { rupees } from '../billing/billingFormat.js';
import { useFetch } from '../../hooks/useFetch.js';
import { isAbnormal } from './labFormat.js';

// Lab version 2 (docs/LAB_V2_PLAN.md): the home collection of an order, her earlier results of the same values (trends)
// and the receipt of a payment taken at registration (the registration itself: LabRegistrationPage.jsx).

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Home collection fields: address, day, time, collector. value/onChange: { address, on, time, collectorId }. */
export function HomeFields({ value, onChange, collectors, fields = {}, idPrefix = 'home' }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="form-grid">
      <Field label="Address for the collection" id={`${idPrefix}-addr`} error={fields['home.address']}>
        <input id={`${idPrefix}-addr`} maxLength={300} value={value.address} onChange={set('address')} />
      </Field>
      <Field label="Day" id={`${idPrefix}-on`} error={fields['home.on']}>
        <input id={`${idPrefix}-on`} type="date" min={today()} value={value.on} onChange={set('on')} />
      </Field>
      <Field label="Time" id={`${idPrefix}-time`} error={fields['home.time']}>
        <input id={`${idPrefix}-time`} type="time" value={value.time} onChange={set('time')} />
      </Field>
      <Field label="Collector" id={`${idPrefix}-who`} error={fields['home.collectorId']}>
        <select id={`${idPrefix}-who`} value={value.collectorId} onChange={set('collectorId')}>
          <option value="">Not chosen yet</option>
          {(collectors ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}
const homeBody = (h) => ({ address: h.address.trim(), on: h.on, time: h.time, collectorId: h.collectorId || null });
const EMPTY_HOME = { address: '', on: today(), time: '09:00', collectorId: '' };

const HOME_WORDS = { scheduled: 'Scheduled', on_the_way: 'On the way', collected: 'Collected', failed: 'Could not collect' };
export const homeWord = (s) => HOME_WORDS[s] ?? s;

/** The order's home collection: schedule it, or move it along (on the way, collected, could not collect). */
export function HomeCard({ order, onSaved, onError }) {
  const home = useFetch(order.access.canHome || order.home ? '/lab/home' : null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(order.home ? { address: order.home.address, on: order.home.on?.slice(0, 10) ?? today(), time: order.home.time, collectorId: order.home.collectorId ?? '' } : EMPTY_HOME);
  const [note, setNote] = useState('');
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  if (!order.home && !order.access.canHome) return null;
  const save = async () => {
    setBusy(true);
    try {
      const res = await api(`/lab/orders/${order.id}/home`, { method: 'PUT', body: { rev: order.rev, home: homeBody(form) } });
      setEditing(false);
      onSaved(res.order, 'Home collection scheduled.');
    } catch (err) {
      setFields(err.fields ?? {});
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  const step = async (status) => {
    setBusy(true);
    try {
      const res = await api(`/lab/orders/${order.id}/home/status`, { method: 'POST', body: { rev: order.rev, status, note: note.trim() } });
      setNote('');
      onSaved(res.order, status === 'collected' ? 'Collected at home: the sample is taken.' : `Home collection: ${homeWord(status).toLowerCase()}.`);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  const h = order.home;
  return (
    <section className="card" aria-labelledby="lab-home-title">
      <h2 id="lab-home-title">
        <Home aria-hidden="true" /> Home collection
      </h2>
      {h && !editing && (
        <>
          <p>
            <strong>{homeWord(h.status)}</strong> · {formatDate(h.on)} at {h.time} · {h.address}
            {h.collectorName ? ` · ${h.collectorName}` : ' · no collector yet'}
          </p>
          {h.note && <p className="hint">{h.note}</p>}
          {h.updated && <p className="hint">Last changed by {h.updated.byName}, {formatDateTime(h.updated.at)}</p>}
          {order.status === 'ordered' && (
            <>
              <Field label="Note (needed for “Could not collect”)" id="home-note">
                <input id="home-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <div className="row">
                {h.status === 'scheduled' && (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => step('on_the_way')}>
                    On the way
                  </button>
                )}
                {['scheduled', 'on_the_way'].includes(h.status) && (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => step('collected')}>
                    Collected
                  </button>
                )}
                {['scheduled', 'on_the_way'].includes(h.status) && (
                  <button type="button" className="btn btn-link btn-sm" disabled={busy} onClick={() => step('failed')}>
                    Could not collect
                  </button>
                )}
                {h.status === 'failed' && (
                  <button type="button" className="btn btn-link btn-sm" disabled={busy} onClick={() => setEditing(true)}>
                    Schedule again
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
      {(!h || editing) && order.access.canHome && (
        <>
          {!h && !editing ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
              <Plus aria-hidden="true" /> Collect at home
            </button>
          ) : (
            <>
              <HomeFields value={form} onChange={setForm} collectors={home.data?.collectors} fields={fields} idPrefix="oh" />
              <div className="row">
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={save}>
                  {busy ? 'Saving…' : 'Schedule the collection'}
                </button>
                <button type="button" className="btn btn-link" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** Her earlier results of this order's values (newest first), for trends. previous: { testKey: { fieldKey: [...] } }. */
export function PreviousResults({ order, catalogue, previous }) {
  const rows = [];
  for (const t of order.tests) {
    const def = catalogue?.tests?.find((x) => x.key === t.key);
    for (const [fieldKey, list] of Object.entries(previous?.[t.key] ?? {})) {
      const f = def?.fields?.find((x) => x.key === fieldKey);
      rows.push({ key: `${t.key}-${fieldKey}`, name: f?.name ?? fieldKey, unit: f?.unit ?? '', list });
    }
  }
  if (!rows.length) return null;
  return (
    <section className="card" aria-labelledby="lab-prev-title">
      <h2 id="lab-prev-title">Her earlier results</h2>
      <table className="lab-values">
        <thead>
          <tr>
            <th scope="col">Value</th>
            <th scope="col">Earlier results (newest first)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">
                {r.name}
                {r.unit ? ` (${r.unit})` : ''}
              </th>
              <td className="tabular">
                {r.list.map((p, i) => (
                  <span key={i} className={`lab-prev${isAbnormal(p.flag) ? ' is-flagged' : ''}`}>
                    {p.value} <span className="muted">{formatDate(p.at)}</span>
                    {i < r.list.length - 1 ? ' · ' : ''}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** The receipt of the payment taken at the lab's counter: printed for the patient, then the order opens. */
export function PaidReceipt({ done, onOpen }) {
  const lh = useFetch('/tenant/settings/letterhead');
  const { payment: p, order: o } = done;
  const record = () => Promise.resolve();
  return (
    <PrintPreview title="Receipt – print preview" hint="Give the receipt to the patient. Close this to open the order." page={{ size: 'A5', margin: '10mm' }} onPrint={record} onClose={onOpen}>
      {!lh.data && !lh.error ? (
        <p className="muted">Preparing…</p>
      ) : (
        <PrintDocument className="bill-doc">
          {lh.data?.letterhead && <Letterhead letterhead={lh.data.letterhead} />}
          <h1 className="pdoc-title">Receipt</h1>
          <PrintFacts
            items={[
              ['Receipt no.', p.receipt],
              ['Date', formatDateTime(new Date())],
              ['Patient', done.patient.fullName],
              ['Patient no.', done.patient.mrn],
              ['Sample no.', o.sampleNo ?? ''],
              ['Tests', done.tests.join(', '), true],
              ['Paid', `${rupees(p.amountPaise)} by ${p.mode === 'upi' ? 'UPI' : p.mode === 'card' ? 'card' : 'cash'}`],
              ['Bill', `${p.billNumber}${p.duePaise > 0 ? ` – ${rupees(p.duePaise)} still due` : ' – paid in full'}`],
            ]}
          />
        </PrintDocument>
      )}
    </PrintPreview>
  );
}
