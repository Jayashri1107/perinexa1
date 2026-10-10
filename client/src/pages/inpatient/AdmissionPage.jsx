// A stay in hospital (as in Perinexa's AdmissionPage): ward and bed, red flags from the nursing chart and recent lab
// results, the ward documents (admission, rounds, delivery, operation, discharge card – draft, then signed), and the
// nursing chart. Signing the discharge card discharges her. Since 9 Oct 2026 the stay opens on its medicine and care
// charts (orders, doses, IV fluids, vital signs, tests, tasks, intake and output, handover – nursing/StayCare.jsx).
import { ArrowLeft, ClipboardList, DoorOpen, FileText, Plus, Printer, Siren } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { admissionsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { formatDateTime } from '../../utils/format.js';
import { FLAG_LOOKS, requestId } from '../visits/visitFormat.js';
import { DocumentForm, DocumentView, fieldName } from './DocumentEditor.jsx';
import { DischargeSummary, summaryStatus } from './DischargeSummary.jsx';
import { PrintPreviewModal } from '../../components/PrintPreviewModal.jsx';
import { BedPicker } from './BedPicker.jsx';
import { StayCare } from '../nursing/StayCare.jsx';
import { KIND_LABELS, SIGNED_BY, VITAL_FIELDS, docLook, stayLook, toLocalInput, vitalsText } from './inpatientFormat.js';

function Doc({ stayId, doc, can, onChanged, startEditing = false }) {
  const [editing, setEditing] = useState(startEditing && doc.status === 'draft' && can.write);
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
          {draft && !editing && can.sign[doc.kind] && (
            <button
              type="button"
              className={doc.kind === 'discharge' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
              disabled={busy}
              onClick={() =>
                window.confirm(doc.kind === 'discharge' ? 'Sign the discharge card and discharge her? The card can no longer change after signing.' : 'Sign this document? It can no longer change after signing.') &&
                run(() => admissionsApi.signDocument(stayId, doc.id))
              }
            >
              {doc.kind === 'discharge' ? 'Sign and discharge' : 'Sign'}
            </button>
          )}
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
      {(error || Object.keys(errors).length > 0) && (
      <Alert type="error">
        {error}
        {Object.keys(errors).length > 0 && (
          <ul className="fix-list">
            {Object.entries(errors).map(([k, m]) => <li key={k}><strong>{fieldName(doc.kind, k)}:</strong> {m}</li>)}
          </ul>
        )}
      </Alert>
      )}
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
  const [fields, setFields] = useState({});
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setFields({});
    try {
      onChanged(await admissionsApi.nursing(stayId, { kind, at: new Date(at).toISOString(), ...(kind === 'vitals' && { vitals }), ...(kind === 'medicine' && { medicine }), note, clientRequestId: requestId() }));
      setVitals({});
      setMedicine({ drug: '', dose: '', route: '' });
      setNote('');
      setAt(toLocalInput(new Date()));
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    }
  };
  const NAMES = { at: 'Time', vitals: 'Vital signs', 'medicine.drug': 'Medicine', note: 'Note', ...Object.fromEntries(VITAL_FIELDS.map(([k, l]) => [`vitals.${k}`, l])) };
  return (
    <form onSubmit={submit} className="nursing-form">
      {error && (
        <Alert type="error">
          {error}
          {Object.keys(fields).length > 0 && <ul className="fix-list">{Object.entries(fields).map(([k, m]) => <li key={k}><strong>{NAMES[k] ?? k}:</strong> {m}</li>)}</ul>}
        </Alert>
      )}
      <div className="leave-row">
        <div className="segmented" role="group" aria-label="Kind of entry">
          {[['vitals', 'Vital signs'], ['medicine', 'Medicine given'], ['note', 'Note']].map(([k, l]) => (
            <button key={k} type="button" className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>
          ))}
        </div>
        <input type="datetime-local" aria-label="When" value={at} onChange={(e) => setAt(e.target.value)} />
      </div>
      {kind === 'vitals' && (
        <div className="vitals-grid">
          {VITAL_FIELDS.map(([k, l, unit]) => (
            <label key={k} className={`vital-box${fields[`vitals.${k}`] ? ' has-error' : ''}`}>
              <span className="small muted">{l}</span>
              <span className="vital-input"><input inputMode="decimal" value={vitals[k] ?? ''} onChange={(e) => setVitals((v) => ({ ...v, [k]: e.target.value.replace(/[^\d.]/g, '') }))} /><span className="small muted">{unit}</span></span>
            </label>
          ))}
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

// Beside the discharge summary: what the nursing chart says lately – for reference while writing it.
function NursingReference({ nursing, redFlags }) {
  const live = nursing.filter((n) => !n.cancelled);
  const vitals = live.find((n) => n.kind === 'vitals');
  const notes = live.filter((n) => n.note).slice(0, 3);
  const meds = live.filter((n) => n.kind === 'medicine').slice(0, 5);
  return (
    <aside className="card nursing-ref">
      <h2>Nursing chart</h2>
      <h3 className="summary-h">Latest vital signs</h3>
      <p className="small">{vitals ? <>{vitalsText(vitals.vitals)}<span className="muted block">{formatDateTime(vitals.at)} · {vitals.byName}</span></> : <span className="muted">None recorded.</span>}</p>
      <h3 className="summary-h">Medicines given</h3>
      {meds.length === 0 ? <p className="muted small">None recorded.</p> : (
        <ul className="plain-list small">{meds.map((m) => <li key={m.id}>{[m.medicine?.drug, m.medicine?.dose, m.medicine?.route].filter(Boolean).join(' · ')} <span className="muted">– {formatDateTime(m.at)}</span></li>)}</ul>
      )}
      <h3 className="summary-h">Latest notes</h3>
      {notes.length === 0 ? <p className="muted small">None.</p> : (
        <ul className="plain-list small">{notes.map((n) => <li key={n.id}>{n.note} <span className="muted">– {n.byName}, {formatDateTime(n.at)}</span></li>)}</ul>
      )}
      {redFlags.length > 0 && (
        <>
          <h3 className="summary-h">Alerts</h3>
          <ul className="plain-list small">{redFlags.map((f) => <li key={f.key}><strong>{f.label}</strong></li>)}</ul>
        </>
      )}
    </aside>
  );
}

export function AdmissionPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [moving, setMoving] = useState(null);
  const [openDocId, setOpenDocId] = useState(null); // a ward document to open for writing
  const [dischargeOpen, setDischargeOpen] = useState(false); // the discharge summary in a pop-up (owner, 10 Oct 2026)
  const [cardPreview, setCardPreview] = useState(false); // the finalized discharge card, printable, in a pop-up
  const [params, setParams] = useSearchParams();

  const load = useCallback(() => {
    admissionsApi.get(id).then(setData).catch((err) => setError(err.message));
  }, [id]);
  useEffect(load, [load]);

  if (error && !data) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  const { stay, patient, documents, nursing, redFlags, can } = data;
  // the medicine and care charts while she is in hospital; the documents after discharge (or when asked for)
  const view = params.get('tab') ?? (stay.status === 'admitted' ? 'care' : 'documents');
  const showView = (v) => setParams((p) => { p.set('tab', v); return p; }, { replace: true });

  const newDoc = async (kind) => {
    try {
      const next = await admissionsApi.newDocument(stay.id, kind, requestId());
      setData(next);
      return next;
    } catch (err) {
      setError(err.message);
      return null;
    }
  };
  // Discharge patient: opens her discharge summary for writing in a pop-up (a new one, or the draft already started).
  // Signing it discharges her; reception then prints it from Discharges.
  const dischargeCard = documents.find((d) => d.kind === 'discharge' && d.status !== 'cancelled');
  const discharge = async () => {
    const draft = dischargeCard ?? (await newDoc('discharge'))?.documents.find((d) => d.kind === 'discharge' && d.status === 'draft');
    if (draft) setDischargeOpen(true);
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
            {can.bed && <button type="button" className="btn btn-ghost" onClick={() => setMoving({ wardId: stay.wardId ?? '', bed: stay.wardId ? stay.bed : '' })}>Change ward or bed</button>}
            {stay.status === 'admitted' && can.write && (!dischargeCard || dischargeCard.status === 'draft') && (
              <button type="button" className="btn btn-primary" onClick={discharge}><DoorOpen size={16} aria-hidden /> Discharge patient</button>
            )}
            {dischargeCard?.status === 'signed' && (
              <button type="button" className="btn btn-primary" onClick={() => setCardPreview(true)}><Printer size={16} aria-hidden /> Discharge summary</button>
            )}
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

      <div className="segmented top-gap" role="tablist" aria-label="Stay">
        <button type="button" role="tab" aria-selected={view === 'care'} className={view === 'care' ? 'on' : ''} onClick={() => showView('care')}><ClipboardList size={14} aria-hidden /> Medicine and care charts</button>
        <button type="button" role="tab" aria-selected={view === 'documents'} className={view === 'documents' ? 'on' : ''} onClick={() => showView('documents')}><FileText size={14} aria-hidden /> Ward documents and nursing chart</button>
      </div>

      {view === 'care' && <div className="top-gap"><StayCare stayId={stay.id} /></div>}

      {/* The discharge summary: one line here; written, reviewed and finalized in a pop-up */}
      {view === 'documents' && dischargeCard && (
        <section id="discharge-summary" className="card top-gap appt-line">
          <span><strong>Discharge summary</strong> <span className="muted small">{dischargeCard.createdByName ?? ''}</span></span>
          <StateBadge look={summaryStatus(dischargeCard)} small />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDischargeOpen(true)}>Open</button>
        </section>
      )}

      {dischargeOpen && dischargeCard && (
        <Modal title={`Discharge summary – ${patient.name} (${patient.patientNumber})`} onClose={() => setDischargeOpen(false)} size="full">
          <div className="discharge-layout">
            <DischargeSummary key={`${dischargeCard.id}-${dischargeCard.status}`} stayId={stay.id} stay={stay} patient={patient} doc={dischargeCard} can={can} onChanged={(r) => setData(r)} />
            <NursingReference nursing={nursing} redFlags={redFlags} />
          </div>
        </Modal>
      )}

      {cardPreview && dischargeCard?.status === 'signed' && (
        <PrintPreviewModal title={`Discharge card – ${patient.name} (${patient.patientNumber})`} src={`/hospital/print/discharge-card/${dischargeCard.id}`} onClose={() => setCardPreview(false)} />
      )}

      {view === 'documents' && (
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
          {documents.filter((d) => d.kind !== 'discharge' || d.status === 'cancelled').map((d) => (
            <div key={d.id === openDocId ? `${d.id}-open` : d.id} id={`doc-${d.id}`}>
              <Doc stayId={stay.id} doc={d} can={can} startEditing={d.id === openDocId || d.id === params.get('open')} onChanged={(r) => setData(r)} />
            </div>
          ))}
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
                  {n.kind === 'vitals' && vitalsText(n.vitals)}
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
      )}

      {moving && (
        <Modal title="Change ward or bed" onClose={() => setMoving(null)} size="lg">
          <form onSubmit={async (e) => { e.preventDefault(); try { setData(await admissionsApi.bed(stay.id, moving)); setMoving(null); } catch (err) { setError(err.message); } }}>
            <BedPicker value={moving} exceptStayId={stay.id} onChange={(v) => setMoving(v)} />
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
