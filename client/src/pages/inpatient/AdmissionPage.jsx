// A stay in hospital (as in Perinexa's AdmissionPage): ward and bed, red flags from the nursing chart and recent lab
// results, the ward documents (admission, rounds, delivery, operation, discharge card – draft, then signed), and the
// nursing chart. Signing the discharge card discharges her.
import { ArrowLeft, Plus, Printer, Siren } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { admissionsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { formatDateTime } from '../../utils/format.js';
import { FLAG_LOOKS, requestId } from '../visits/visitFormat.js';
import { DocumentForm, DocumentView } from './DocumentEditor.jsx';
import { KIND_LABELS, SIGNED_BY, VITAL_FIELDS, docLook, stayLook, toLocalInput } from './inpatientFormat.js';

function Doc({ stayId, doc, can, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(doc.content);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [addition, setAddition] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (action, after) => {
    setBusy(true);
    setError('');
    setErrors({});
    try {
      onChanged(await action());
      after?.();
    } catch (err) {
      setError(err.message);
      setErrors(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  };
  const draft = doc.status === 'draft';
  return (
    <section className="card">
      <div className="card-head">
        <h2>{KIND_LABELS[doc.kind]} <StateBadge look={docLook(doc)} small /></h2>
        <div className="row-actions">
          {draft && can.write && !editing && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setContent(doc.content); setEditing(true); }}>Write</button>}
          {draft && !editing && can.sign[doc.kind] && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => window.confirm('Sign this document? It can no longer change after signing.') && run(() => admissionsApi.signDocument(stayId, doc.id))}>Sign</button>}
          {draft && can.write && !editing && <button type="button" className="btn btn-link btn-sm btn-danger-text" onClick={() => { const r = window.prompt('Why is it entered in error?'); if (r) run(() => admissionsApi.cancelDocument(stayId, doc.id, r)); }}>Entered in error</button>}
          {doc.status === 'signed' && <a className="btn btn-ghost btn-sm" href={doc.kind === 'discharge' ? `/hospital/print/discharge-card/${doc.id}` : `/hospital/print/ward-document/${stayId}/${doc.id}`} target="_blank" rel="noreferrer"><Printer size={14} aria-hidden /> Print</a>}
        </div>
      </div>
      <p className="muted small">
        Started by {doc.createdByName}{doc.savedAt && ` · saved by ${doc.savedByName}, ${formatDateTime(doc.savedAt)}`}
        {doc.signed && ` · signed by ${doc.signed.byName}, ${formatDateTime(doc.signed.at)}`}
        {draft && ` · signed by ${SIGNED_BY[doc.kind]}`}
        {doc.cancelled && ` · entered in error: ${doc.cancelled.reason}`}
      </p>
      <Alert type="error">{error}</Alert>
      {editing ? (
        <form onSubmit={(e) => { e.preventDefault(); run(() => admissionsApi.saveDocument(stayId, doc.id, { rev: doc.rev, content }), () => setEditing(false)); }} noValidate>
          <DocumentForm kind={doc.kind} content={content} onChange={setContent} errors={errors} />
          <div className="modal-foot inline">
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button>
          </div>
        </form>
      ) : (
        <DocumentView kind={doc.kind} content={doc.content} />
      )}
      {doc.additions.length > 0 && (
        <ul className="plain-list rows top-gap-sm">
          {doc.additions.map((a, i) => <li key={i}><span className="pre">{a.text}</span><span className="muted small">{a.byName}, {formatDateTime(a.at)}</span></li>)}
        </ul>
      )}
      {doc.status === 'signed' && (can.write || can.nursing) && (
        <form className="leave-row top-gap-sm" onSubmit={(e) => { e.preventDefault(); run(() => admissionsApi.addToDocument(stayId, doc.id, addition), () => setAddition('')); }}>
          <input aria-label="Correction or addition" placeholder="Add a correction below the signed document" value={addition} maxLength={2000} onChange={(e) => setAddition(e.target.value)} />
          <button type="submit" className="btn btn-ghost btn-sm" disabled={addition.trim().length < 2}>Add</button>
        </form>
      )}
    </section>
  );
}

function NursingForm({ stayId, onChanged }) {
  const [kind, setKind] = useState('vitals');
  const [at, setAt] = useState(toLocalInput(new Date()));
  const [vitals, setVitals] = useState({});
  const [medicine, setMedicine] = useState({ drug: '', dose: '', route: '' });
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      onChanged(await admissionsApi.nursing(stayId, { kind, at: new Date(at).toISOString(), ...(kind === 'vitals' && { vitals }), ...(kind === 'medicine' && { medicine }), note, clientRequestId: requestId() }));
      setVitals({});
      setMedicine({ drug: '', dose: '', route: '' });
      setNote('');
      setAt(toLocalInput(new Date()));
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <form onSubmit={submit} className="nursing-form">
      <Alert type="error">{error}</Alert>
      <div className="leave-row">
        <div className="segmented" role="group" aria-label="Kind of entry">
          {[['vitals', 'Vital signs'], ['medicine', 'Medicine given'], ['note', 'Note']].map(([k, l]) => (
            <button key={k} type="button" className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>
          ))}
        </div>
        <input type="datetime-local" aria-label="When" value={at} onChange={(e) => setAt(e.target.value)} />
      </div>
      {kind === 'vitals' && (
        <div className="leave-row">
          {VITAL_FIELDS.map(([k, l]) => <input key={k} aria-label={l} placeholder={l} inputMode="decimal" value={vitals[k] ?? ''} onChange={(e) => setVitals((v) => ({ ...v, [k]: e.target.value }))} />)}
        </div>
      )}
      {kind === 'medicine' && (
        <div className="leave-row">
          <input aria-label="Medicine" placeholder="Medicine" value={medicine.drug} onChange={(e) => setMedicine((m) => ({ ...m, drug: e.target.value }))} />
          <input aria-label="Dose" placeholder="Dose" value={medicine.dose} onChange={(e) => setMedicine((m) => ({ ...m, dose: e.target.value }))} />
          <input aria-label="Route" placeholder="Route (IV, IM, oral …)" value={medicine.route} onChange={(e) => setMedicine((m) => ({ ...m, route: e.target.value }))} />
        </div>
      )}
      <div className="leave-row">
        <input aria-label="Note" placeholder={kind === 'note' ? 'Note' : 'Note (optional)'} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        <button type="submit" className="btn btn-ghost btn-sm">Add to the chart</button>
      </div>
    </form>
  );
}

export function AdmissionPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [moving, setMoving] = useState(null);

  const load = useCallback(() => {
    admissionsApi.get(id).then(setData).catch((err) => setError(err.message));
  }, [id]);
  useEffect(load, [load]);

  if (error && !data) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  const { stay, patient, documents, nursing, redFlags, can } = data;

  const newDoc = async (kind) => {
    try {
      setData(await admissionsApi.newDocument(stay.id, kind, requestId()));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHeader
        back={<Link to={`/hospital/patients/${patient.id}`} className="back-link"><ArrowLeft size={16} aria-hidden /> {patient.name}</Link>}
        title={`${patient.name} · ${stay.ward}${stay.bed ? `, bed ${stay.bed}` : ''}`}
        subtitle={`${patient.patientNumber} · admitted ${formatDateTime(stay.admittedAt)} by ${stay.admittedByName}${stay.reason ? ` · ${stay.reason}` : ''}${patient.allergies ? ` · Allergies: ${patient.allergies}` : ''}${stay.dischargedAt ? ` · discharged ${formatDateTime(stay.dischargedAt)} by ${stay.dischargedByName}` : ''}`}
        actions={
          <>
            <StateBadge look={stayLook(stay)} />
            {can.bed && <button type="button" className="btn btn-ghost" onClick={() => setMoving({ ward: stay.ward, bed: stay.bed })}>Change ward or bed</button>}
          </>
        }
      />
      <Alert type="error">{error}</Alert>

      {stay.status === 'admitted' && (
        <section className={`card${redFlags.length ? ' warn-card' : ''}`}>
          <h2><Siren size={18} aria-hidden /> Red flags</h2>
          {!data.rulesApproved && <p className="muted">The red-flag rules are still a draft in the Clinic library: no checks until a doctor approves them.</p>}
          {data.rulesApproved && redFlags.length === 0 && <p className="muted">None from the nursing chart and her recent lab results.</p>}
          <ul className="plain-list flag-list">
            {redFlags.map((f) => (
              <li key={f.key}><StateBadge look={FLAG_LOOKS[f.level]} small /> <strong>{f.label}</strong><span className="block small">{f.message}</span></li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid-2 top-gap stay-layout">
        <div className="stack">
          <div className="card-head">
            <h2>Ward documents</h2>
            {can.write && (
              <label className="filter">
                <span><Plus size={14} aria-hidden /> New</span>
                <select value="" onChange={(e) => e.target.value && newDoc(e.target.value)}>
                  <option value="">Choose…</option>
                  {Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
            )}
          </div>
          {documents.length === 0 && <p className="muted">No documents yet.</p>}
          {documents.map((d) => <Doc key={d.id} stayId={stay.id} doc={d} can={can} onChanged={(r) => setData(r)} />)}
        </div>
        <section className="card">
          <h2>Nursing chart</h2>
          {can.nursing && <NursingForm stayId={stay.id} onChanged={setData} />}
          <ul className="plain-list rows top-gap-sm">
            {nursing.length === 0 && <li className="muted">Nothing charted yet.</li>}
            {nursing.map((n) => (
              <li key={n.id} className={n.cancelled ? 'struck' : ''}>
                <span>
                  <strong>{formatDateTime(n.at)}</strong>{' '}
                  {n.kind === 'vitals' && VITAL_FIELDS.filter(([k]) => n.vitals?.[k] != null).map(([k, l]) => `${l} ${n.vitals[k]}`).join(' · ')}
                  {n.kind === 'medicine' && `Given: ${n.medicine.drug}${n.medicine.dose ? ` ${n.medicine.dose}` : ''}${n.medicine.route ? ` (${n.medicine.route})` : ''}`}
                  {n.note && <span className="block small">{n.note}</span>}
                  {n.cancelled && <span className="block small">Entered in error: {n.cancelled.reason}</span>}
                </span>
                <span className="muted small">{n.byName}</span>
                {!n.cancelled && (n.mine || can.write) && stay.status === 'admitted' && (
                  <button type="button" className="btn btn-link btn-sm" onClick={async () => { const r = window.prompt('Why is it entered in error?'); if (r) setData(await admissionsApi.cancelNursing(stay.id, n.id, r)); }}>Entered in error</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {moving && (
        <Modal title="Change ward or bed" onClose={() => setMoving(null)} size="sm">
          <form onSubmit={async (e) => { e.preventDefault(); try { setData(await admissionsApi.bed(stay.id, moving)); setMoving(null); } catch (err) { setError(err.message); } }}>
            <div className="form-field"><label htmlFor="mv-ward">Ward</label><input id="mv-ward" value={moving.ward} maxLength={60} onChange={(e) => setMoving((m) => ({ ...m, ward: e.target.value }))} /></div>
            <div className="form-field top-gap-sm"><label htmlFor="mv-bed">Bed</label><input id="mv-bed" value={moving.bed} maxLength={30} onChange={(e) => setMoving((m) => ({ ...m, bed: e.target.value }))} /></div>
            <div className="modal-foot inline">
              <button type="button" className="btn btn-ghost" onClick={() => setMoving(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
