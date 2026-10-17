import { useMemo, useState } from 'react';
import { Home, Plus, TestTube } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { Alert, Field, formatDate, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PatientFinder } from '../appointments/AppointmentDialogs.jsx';
import { AdmitRegister } from '../beds/AdmitRegister.jsx';
import { isAbnormal } from './labFormat.js';

// Lab version 2 (docs/LAB_V2_PLAN.md): a walk-in or referred patient's order entered by the lab from the prescription
// (the owner's decision), the home collection of an order, and her earlier results of the same values (trends).

function Modal({ id, title, onClose, children }) {
  const ref = useDialogFocus(onClose);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

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

export function WalkInDialog({ onClose }) {
  const navigate = useNavigate();
  const catalogue = useFetch('/lab/tests');
  const referrers = useFetch('/lab-setup/referrers');
  const home = useFetch('/lab/home');
  const [patient, setPatient] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ referrerId: '', prescription: '', urgent: false, noteToLab: '', atHome: false });
  const [homeForm, setHomeForm] = useState(EMPTY_HOME);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const tests = useMemo(() => (catalogue.data?.tests ?? []).filter((t) => t.active !== false && t.who === (patient?.careType === 'newborn' ? 'newborn' : 'adult') && t.name.toLowerCase().includes(filter.toLowerCase())), [catalogue.data, patient, filter]);
  const toggle = (key) => setChosen((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));
  const send = async () => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const body = {
        clientRequestId: requestId,
        patientId: patient.id,
        tests: chosen.map((key) => ({ key })),
        urgent: form.urgent,
        noteToLab: form.noteToLab.trim(),
        referrerId: form.referrerId || null,
        prescription: form.prescription.trim(),
        home: form.atHome ? homeBody(homeForm) : null,
      };
      const { order } = await api('/lab/walk-in', { method: 'POST', body });
      navigate(`/lab/orders/${order.id}`);
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setBusy(false);
    }
  };
  return (
    <Modal id="walkin" title="Walk-in or referred patient" onClose={onClose}>
      <Alert type="error">{error || catalogue.error}</Alert>
      {!patient ? (
        <>
          <p>Find her record, or register her (name, age, phone and address only).</p>
          <PatientFinder onPick={setPatient} />
          <AdmitRegister onRegistered={setPatient} />
        </>
      ) : (
        <>
          <p className="appt-chosen">
            <strong>{patient.fullName}</strong> <span className="muted">{patient.mrn}</span>{' '}
            <button type="button" className="btn btn-link btn-sm" onClick={() => setPatient(null)}>
              Choose someone else
            </button>
          </p>
          <div className="form-grid">
            <Field label="Referred by" id="wi-ref" error={fields.referrerId} hint="Add doctors and centres under Lab → Referrers.">
              <select id="wi-ref" value={form.referrerId} onChange={(e) => setForm({ ...form, referrerId: e.target.value })}>
                <option value="">No referrer (self)</option>
                {(referrers.data?.referrers ?? [])
                  .filter((r) => r.active)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {r.kind === 'centre' ? ' (centre)' : ''}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={form.referrerId ? 'Prescription (optional)' : 'Prescription'} id="wi-rx" error={fields.prescription} hint='e.g. "Prescription of 16 Oct" or "Self – no prescription".'>
              <input id="wi-rx" maxLength={200} value={form.prescription} onChange={(e) => setForm({ ...form, prescription: e.target.value })} />
            </Field>
            <Field label="Note for the lab (optional)" id="wi-note">
              <input id="wi-note" maxLength={500} value={form.noteToLab} onChange={(e) => setForm({ ...form, noteToLab: e.target.value })} />
            </Field>
          </div>
          <fieldset className="fieldset">
            <legend>Tests ({chosen.length} chosen)</legend>
            {fields.tests && <p className="field-error">{fields.tests}</p>}
            <label className="lab-filter" htmlFor="wi-find">
              <span>Find a test</span>
              <input id="wi-find" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </label>
            <div className="check-grid lab-choose">
              {tests.map((t) => (
                <label key={t.key} className="check">
                  <input type="checkbox" checked={chosen.includes(t.key)} onChange={() => toggle(t.key)} /> {t.name}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="check">
            <input type="checkbox" checked={form.urgent} onChange={(e) => setForm({ ...form, urgent: e.target.checked })} /> Urgent
          </label>
          <label className="check">
            <input type="checkbox" checked={form.atHome} onChange={(e) => setForm({ ...form, atHome: e.target.checked })} /> Collect the sample at home
          </label>
          {form.atHome && <HomeFields value={homeForm} onChange={setHomeForm} collectors={home.data?.collectors} fields={fields} idPrefix="wi-home" />}
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={busy || !chosen.length} onClick={send}>
              <TestTube aria-hidden="true" /> {busy ? 'Saving…' : 'Make the order'}
            </button>
            <button type="button" className="btn btn-link" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

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
