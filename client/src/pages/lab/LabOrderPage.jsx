// One lab order: its tests and results (with the flag of each value against the DRAFT reference range), who did
// what and when, and the next step this person may take – take the sample, enter or change the results (a change
// after the report needs a reason), review them, or cancel the order. Sample tracking (owner, 9 Oct 2026): the sample's
// number and kind, received in the lab, test started, a sample rejected (a new one is needed), and asking the doctor.
import { ArrowLeft, FlaskConical, MessageCircleQuestion, PackageCheck, Pencil, RotateCcw, TestTube, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { labApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { formatDateTime } from '../../utils/format.js';
import { flagFor, flagLook, stageLook } from './labFormat.js';

const STEPS = [
  ['ordered', 'Ordered'],
  ['collected', 'Sample taken'],
  ['received', 'Received in the lab'],
  ['processing', 'Test started'],
  ['reported', 'Results entered – sent for verification'],
  ['reviewed', 'Verified by the doctor'],
  ['cancelled', 'Cancelled'],
];

// Reject a sample (with the reason) or ask the ordering doctor a question.
const ASK = {
  reject: { title: 'Reject the sample', label: 'Why it cannot be used', placeholder: 'e.g. Clotted, too little, wrong tube, not labelled', button: 'Reject – new sample needed', min: 3, help: 'The doctor (and the nurses, if she is in hospital) are told a new sample is needed.' },
  query: { title: 'Ask the doctor', label: 'Your question', placeholder: 'e.g. Fasting or after food? Which antibiotic was given?', button: 'Send to the doctor', min: 5, help: 'The doctor who ordered is notified. The order itself does not change.' },
};

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
  const [asking, setAsking] = useState(null); // 'reject' | 'query'
  const [askText, setAskText] = useState('');

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
      setAsking(null);
      setAskText('');
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
            <StateBadge look={stageLook({ ...order, received: Boolean(order.received), inProgress: Boolean(order.processing) })} />
            {order.urgent && <span className="badge badge-danger"><Zap size={14} aria-hidden /> Urgent</span>}
            {order.bookedByReception && <span className="badge badge-info">Booked by reception</span>}
            {can.collect && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => labApi.collect(order.id))}><TestTube size={16} aria-hidden /> {order.recollect ? 'New sample taken' : 'Sample taken'}</button>}
            {can.receive && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(() => labApi.receive(order.id))}><PackageCheck size={16} aria-hidden /> Received in the lab</button>}
            {can.process && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(() => labApi.process(order.id))}><FlaskConical size={16} aria-hidden /> Start test</button>}
            {can.reject && <button type="button" className="btn btn-link btn-danger-text" onClick={() => setAsking('reject')}><RotateCcw size={16} aria-hidden /> Reject sample</button>}
            {can.query && <button type="button" className="btn btn-link" onClick={() => setAsking('query')}><MessageCircleQuestion size={16} aria-hidden /> Ask the doctor</button>}
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
            <dt>Sample</dt><dd>{order.sample ? <><strong>{order.sample.number}</strong>{order.sample.types.length > 0 && ` · ${order.sample.types.join(', ')}`}</> : order.recollect ? 'A new sample is needed' : 'Not taken yet'}</dd>
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
            {order.rejections.map((r) => (
              <li key={`rej${r.at}`}>
                <strong>Sample {r.sampleNumber} rejected</strong> <span className="muted small">{formatDateTime(r.at)} · {r.by}</span>
                <span className="block small">{r.reason}</span>
              </li>
            ))}
            {order.queries.map((q) => (
              <li key={`q${q.at}`}>
                <strong>Asked the doctor</strong> <span className="muted small">{formatDateTime(q.at)} · {q.by}</span>
                <span className="block small">{q.text}</span>
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

      {asking && (
        <Modal title={ASK[asking].title} onClose={() => setAsking(null)} size="sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(() => (asking === 'reject' ? labApi.reject(order.id, askText) : labApi.query(order.id, askText)));
            }}
          >
            <div className="form-field">
              <label htmlFor="ask-text">{ASK[asking].label}<span className="required" aria-hidden> *</span></label>
              <textarea id="ask-text" rows={3} value={askText} maxLength={500} placeholder={ASK[asking].placeholder} onChange={(e) => setAskText(e.target.value)} />
              <span className="field-help">{ASK[asking].help}</span>
            </div>
            <div className="modal-foot inline">
              <button type="button" className="btn btn-ghost" onClick={() => setAsking(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={busy || askText.trim().length < ASK[asking].min}>{ASK[asking].button}</button>
            </div>
          </form>
        </Modal>
      )}

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
