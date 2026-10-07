// One lab order: its tests and results (with the flag of each value against the DRAFT reference range), who did
// what and when, and the next step this person may take – take the sample, enter or change the results (a change
// after the report needs a reason), review them, or cancel the order.
import { ArrowLeft, Pencil, TestTube, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { labApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { formatDateTime } from '../../utils/format.js';
import { flagFor, flagLook, orderLook } from './labFormat.js';

const STEPS = [
  ['ordered', 'Ordered'],
  ['collected', 'Sample taken'],
  ['reported', 'Results entered'],
  ['reviewed', 'Reviewed'],
  ['cancelled', 'Cancelled'],
];

// The results form's values, from the order: { "<key>:<name>": { values: { field: value }, text } }.
const idOf = (t) => `${t.key}:${t.key === 'other' ? t.name : ''}`;
const formOf = (order) => Object.fromEntries(order.tests.map((t) => [idOf(t), { values: Object.fromEntries(t.values.map((v) => [v.key, v.value])), text: t.text }]));

function ResultsTable({ order, defs }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Test</th><th>Result</th><th>Flag</th><th>Reference (DRAFT)</th></tr>
        </thead>
        <tbody>
          {order.tests.map((t) => {
            const def = defs.get(t.key);
            const fields = (def?.fields ?? []).filter((f) => f.type !== 'text');
            const rows = fields.length ? fields : [null];
            return rows.map((f, i) => {
              const v = f && t.values.find((x) => x.key === f.key);
              return (
                <tr key={`${idOf(t)}-${f?.key ?? 'text'}`}>
                  {i === 0 && <td rowSpan={rows.length + (t.text && fields.length ? 1 : 0)}><strong>{t.name}</strong></td>}
                  <td>{f ? (<>{f.name !== t.name && <span className="muted">{f.name}: </span>}{v?.value ? `${v.value}${f.unit ? ` ${f.unit}` : ''}` : '—'}</>) : t.text || '—'}</td>
                  <td>{v?.flag && flagLook(v.flag) ? <StateBadge look={flagLook(v.flag)} small /> : ''}</td>
                  <td className="muted small">{f?.range || (f?.type === 'choice' && f.abnormal?.length ? `Flagged: ${f.abnormal.join(', ')}` : '')}</td>
                </tr>
              );
            }).concat(t.text && fields.length ? [<tr key={`${idOf(t)}-note`}><td colSpan={3} className="small"><span className="muted">Comment: </span>{t.text}</td></tr>] : []);
          })}
        </tbody>
      </table>
    </div>
  );
}

function ResultsForm({ order, defs, amending, onCancel, onSaved }) {
  const [form, setForm] = useState(() => formOf(order));
  const [labNote, setLabNote] = useState(order.labNote ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);
  const setValue = (id, key, value) => setForm((f) => ({ ...f, [id]: { ...f[id], values: { ...f[id].values, [key]: value } } }));
  const setText = (id, value) => setForm((f) => ({ ...f, [id]: { ...f[id], text: value } }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const tests = order.tests.map((t) => ({ key: t.key, name: t.name, values: form[idOf(t)].values, text: form[idOf(t)].text }));
      onSaved(await labApi.results(order.id, { tests, labNote, reason }));
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card" onSubmit={save} noValidate>
      <h2>{amending ? 'Change the results' : 'Enter the results'}</h2>
      <Alert type="error">{error}</Alert>
      <div className="results-form">
        {order.tests.map((t) => {
          const id = idOf(t);
          const def = defs.get(t.key);
          return (
            <fieldset key={id} className="result-test">
              <legend>{t.name}</legend>
              {(def?.fields ?? []).filter((f) => f.type !== 'text').map((f) => {
                const value = form[id].values[f.key] ?? '';
                const look = flagLook(flagFor(f, value));
                const inputId = `r-${id}-${f.key}`;
                return (
                  <div key={f.key} className={`form-field result-field${fields[`${t.key}.${f.key}`] ? ' has-error' : ''}`}>
                    <label htmlFor={inputId}>{f.name}{f.unit ? ` (${f.unit})` : ''}</label>
                    <div className="result-input">
                      {f.type === 'choice' ? (
                        <select id={inputId} value={value} onChange={(e) => setValue(id, f.key, e.target.value)}>
                          <option value="">Not done</option>
                          {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input id={inputId} inputMode="decimal" value={value} onChange={(e) => setValue(id, f.key, e.target.value)} />
                      )}
                      {look && value !== '' && <StateBadge look={look} small />}
                    </div>
                    {f.range && <span className="field-help">{f.range}</span>}
                  </div>
                );
              })}
              <div className="form-field">
                <label htmlFor={`r-${id}-text`}>{t.key === 'other' || !def?.fields?.some((f) => f.type !== 'text') ? 'Result' : 'Comment (optional)'}</label>
                <textarea id={`r-${id}-text`} rows={2} value={form[id].text} maxLength={2000} onChange={(e) => setText(id, e.target.value)} />
              </div>
            </fieldset>
          );
        })}
      </div>
      <div className="form-grid top-gap-sm">
        <div className="form-field">
          <label htmlFor="lab-note">Remark on the report (optional)</label>
          <textarea id="lab-note" rows={2} value={labNote} maxLength={1000} onChange={(e) => setLabNote(e.target.value)} />
        </div>
        {amending && (
          <div className={`form-field${fields.reason ? ' has-error' : ''}`}>
            <label htmlFor="amend-reason">Why the results are changed<span className="required" aria-hidden> *</span></label>
            <input id="amend-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
            <span className="field-help">The earlier results are kept, and the doctor reviews the change.</span>
          </div>
        )}
      </div>
      <div className="modal-foot inline">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save results'}</button>
      </div>
    </form>
  );
}

export function LabOrderPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [catalogue, setCatalogue] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    labApi.get(id).then(setData).catch((err) => setError(err.message));
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    labApi.catalogue().then(setCatalogue).catch((err) => setError(err.message));
  }, []);
  const defs = useMemo(() => new Map((catalogue?.tests ?? []).map((t) => [t.key, t])), [catalogue]);

  if (error && !data) return <Alert type="error">{error}</Alert>;
  if (!data || !catalogue) return <Loader />;
  const { order, patient, can } = data;

  const act = async (action) => {
    setBusy(true);
    setError('');
    try {
      setData(await action());
      setCancelling(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const amending = ['reported', 'reviewed'].includes(order.status);
  return (
    <>
      <PageHeader
        back={<Link to="/hospital/lab" className="back-link"><ArrowLeft size={16} aria-hidden /> Lab</Link>}
        title={`${order.orderNumber} · ${patient.name}`}
        subtitle={
          <>
            {patient.patientNumber}
            {can.openRecord && (<> · <Link to={`/hospital/patients/${patient.id}`}>Open her record</Link></>)}
          </>
        }
        actions={
          <>
            <StateBadge look={orderLook(order.status)} />
            {order.urgent && <span className="badge badge-danger"><Zap size={14} aria-hidden /> Urgent</span>}
            {can.collect && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(() => labApi.collect(order.id))}><TestTube size={16} aria-hidden /> Sample taken</button>}
            {can.report && !editing && (
              <button type="button" className={amending ? 'btn btn-ghost' : 'btn btn-primary'} onClick={() => setEditing(true)}>
                <Pencil size={16} aria-hidden /> {amending ? 'Change results' : 'Enter results'}
              </button>
            )}
            {can.review && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => labApi.review(order.id))}>Mark as reviewed</button>}
            {can.cancel && <button type="button" className="btn btn-link btn-danger-text" onClick={() => setCancelling(true)}>Cancel order</button>}
          </>
        }
      />
      <Alert type="error">{error}</Alert>
      {catalogue.note && <p className="muted small">{catalogue.note}</p>}

      <div className="grid-2">
        <section className="card">
          <h2>Order</h2>
          <dl className="details wide">
            <dt>Tests</dt><dd>{order.tests.map((t) => t.name).join(', ')}</dd>
            {order.packages.length > 0 && (<><dt>Packages</dt><dd>{order.packages.map((p) => `${p.name}${p.approved ? '' : ' (DRAFT)'}`).join(', ')}</dd></>)}
            <dt>Note to the lab</dt><dd className="pre">{order.noteToLab || '—'}</dd>
            <dt>Lab remark</dt><dd className="pre">{order.labNote || '—'}</dd>
          </dl>
        </section>
        <section className="card">
          <h2>Steps</h2>
          <ul className="steps">
            {STEPS.filter(([k]) => order[k]).map(([k, word]) => (
              <li key={k}>
                <strong>{word}</strong> <span className="muted small">{formatDateTime(order[k].at)} · {order[k].by}</span>
                {k === 'cancelled' && <span className="block small">{order.cancelled.reason}</span>}
              </li>
            ))}
            {order.amendments.map((a) => (
              <li key={a.at}>
                <strong>Results changed</strong> <span className="muted small">{formatDateTime(a.at)} · {a.by}</span>
                <span className="block small">{a.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="top-gap">
        {editing ? (
          <ResultsForm
            order={order}
            defs={defs}
            amending={amending}
            onCancel={() => setEditing(false)}
            onSaved={(d) => {
              setData(d);
              setEditing(false);
            }}
          />
        ) : (
          <section className="card list-panel">
            <ResultsTable order={order} defs={defs} />
          </section>
        )}
      </div>

      {cancelling && (
        <Modal title="Cancel the lab order" onClose={() => setCancelling(false)} size="sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(() => labApi.cancel(order.id, reason));
            }}
          >
            <div className="form-field">
              <label htmlFor="cancel-reason">Why<span className="required" aria-hidden> *</span></label>
              <input id="cancel-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="modal-foot inline">
              <button type="button" className="btn btn-ghost" onClick={() => setCancelling(false)}>Keep the order</button>
              <button type="submit" className="btn btn-primary" disabled={busy || reason.trim().length < 3}>Cancel order</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
