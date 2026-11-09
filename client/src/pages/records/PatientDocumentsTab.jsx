import { useRef, useState } from 'react';
import { CircleMinus, FileUp, Paperclip } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { api, newRequestId } from '../../api.js';
import { DataTable } from '../../components/DataTable.jsx';
import { FILE_TYPES, fileBody, fileProblem, fileSize, openStoredFile } from '../../components/fileUpload.js';
import { Alert, Field, StatusPill, formatDate, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { DOC_TYPES, DOC_TYPE_LABELS } from './recordLists.js';

// The Documents tab of a patient's record (the medical records module): scanned papers and outside documents – an
// old case sheet, a discharge summary or report from another hospital, a referral letter … Those who may see her
// medical details and the medical records staff see and open them; a document put on the wrong record is marked so
// with a reason and stays. Nothing from a scan is typed into the record by itself.

const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const stayWords = (s) => `${formatDate(s.admittedAt)}${s.dischargedAt ? ` to ${formatDate(s.dischargedAt)}` : ' (in hospital)'}${s.ward ? ` · ${s.ward}` : ''}`;

function UploadForm({ patient, stays, maxBytes, onSaved, onCancel }) {
  const [form, setForm] = useState({ docType: '', title: '', documentOn: '', admissionId: '', note: '' });
  const [file, setFile] = useState(null);
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const requestId = useRef(newRequestId());
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const choose = (e) => {
    const f = e.target.files?.[0] ?? null;
    setFields({ ...fields, file: f ? fileProblem(f, { maxBytes }) : undefined });
    setFile(f && !fileProblem(f, { maxBytes }) ? f : null);
  };
  const save = async (e) => {
    e.preventDefault();
    const missing = {};
    if (!form.docType) missing.docType = 'Choose what kind of document this is.';
    if (form.title.trim().length < 2) missing.title = 'Write what the document is (a few words).';
    if (!file) missing.file = 'Choose the scanned file (PDF or photo).';
    setFields(missing);
    if (Object.keys(missing).length) return undefined;
    setSaving(true);
    setError(null);
    try {
      const body = await fileBody(file, { clientRequestId: requestId.current, docType: form.docType, title: form.title.trim(), documentOn: form.documentOn, admissionId: form.admissionId, note: form.note.trim() });
      onSaved((await api(`/patients/${patient.id}/documents`, { method: 'POST', body })).document);
    } catch (err) {
      setFields(err.fields ?? {});
      setError(err.message);
      setSaving(false);
    }
    return undefined;
  };
  return (
    <form className="card" onSubmit={save} noValidate aria-labelledby="pd-form-title">
      <h2 id="pd-form-title">
        <FileUp aria-hidden="true" /> Attach a document
      </h2>
      <p className="hint">A scan or photo of a paper: PDF, JPEG, PNG or WebP, up to {Math.round(maxBytes / (1024 * 1024))} MB. Not identity documents such as Aadhaar – they are not kept in Perinexa. What is on the paper stays a picture: nothing is copied into the record by itself.</p>
      <Alert type="error">{error}</Alert>
      <div className="form-grid">
        <Field label="Kind of document" id="pd-type" error={fields.docType}>
          <select id="pd-type" value={form.docType} onChange={set('docType')}>
            <option value="">Choose…</option>
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOC_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="What it is" id="pd-title" error={fields.title} hint="For example “Discharge summary, City Hospital, March 2026”.">
          <input id="pd-title" value={form.title} maxLength={120} onChange={set('title')} />
        </Field>
        <Field label="Date on the document (optional)" id="pd-on" error={fields.documentOn}>
          <input id="pd-on" type="date" value={form.documentOn} max={today()} onChange={set('documentOn')} />
        </Field>
        {stays.length > 0 && (
          <Field label="Stay it belongs to (optional)" id="pd-stay" error={fields.admissionId}>
            <select id="pd-stay" value={form.admissionId} onChange={set('admissionId')}>
              <option value="">None</option>
              {stays.map((s) => (
                <option key={s.id} value={s.id}>
                  {stayWords(s)}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <Field label="The file" id="pd-file" error={fields.file}>
        <input id="pd-file" type="file" accept={FILE_TYPES.join(',')} onChange={choose} />
      </Field>
      <Field label="Note (optional)" id="pd-note" error={fields.note}>
        <input id="pd-note" value={form.note} maxLength={500} onChange={set('note')} />
      </Field>
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          <Paperclip aria-hidden="true" /> {saving ? 'Uploading…' : 'Attach the document'}
        </button>
        <button type="button" className="btn btn-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** "Not hers?" – the reason a document is marked as put on the wrong record. */
function WrongRecordDialog({ document, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const ref = useDialogFocus(onCancel);
  const save = async (e) => {
    e.preventDefault();
    if (reason.trim().length < 5) return setError('Write why this document does not belong here.');
    setSaving(true);
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(err.fields?.reason ?? err.message);
      setSaving(false);
    }
    return undefined;
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="pd-wrong-title" onSubmit={save} noValidate>
        <h2 id="pd-wrong-title">Mark this document as put on the wrong record?</h2>
        <p>
          “{document.title}” stays on this record, marked with your name and the reason, and is no longer opened by those who only read. It is not deleted.
        </p>
        <Field label="Why" id="pd-wrong-reason" error={error}>
          <input id="pd-wrong-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-danger" disabled={saving}>
            Mark as wrong record
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export function PatientDocumentsTab() {
  const { patient } = useOutletContext();
  const canView = Boolean(patient.access?.canViewDocuments);
  const { data, error, loading, reload } = useFetch(canView ? `/patients/${patient.id}/documents` : null);
  const [adding, setAdding] = useState(false);
  const [marking, setMarking] = useState(null);
  const [notice, setNotice] = useState(null);
  const [failed, setFailed] = useState(null);
  if (!canView) return <div className="card">The documents attached to this record are not part of your role for this patient.</div>;

  const open = async (d) => {
    setFailed(null);
    try {
      await openStoredFile(`/patients/${patient.id}/documents/${d.id}/file`);
    } catch (err) {
      setFailed(err.message);
    }
  };
  const stayOf = (id) => data?.stays.find((s) => s.id === id);
  const columns = [
    { key: 'on', header: 'Date on it', render: (d) => <span className="tabular">{d.documentOn ? formatDate(d.documentOn) : '–'}</span> },
    {
      key: 'what',
      header: 'Document',
      className: 'wrap',
      render: (d) => (
        <div>
          <strong>{d.title}</strong>
          <div className="t-caption muted">
            {DOC_TYPE_LABELS[d.docType] ?? d.docType}
            {d.admissionId && stayOf(d.admissionId) ? ` · stay ${stayWords(stayOf(d.admissionId))}` : ''}
            {d.note ? ` · ${d.note}` : ''}
          </div>
          <div className="t-caption muted">Attached by {d.uploaded?.byName}, {formatDateTime(d.uploaded?.at)}</div>
          {d.cancelled && (
            <div className="t-caption">
              <StatusPill tone="inactive" icon={CircleMinus}>
                Wrong record
              </StatusPill>{' '}
              <span className="muted">
                {d.cancelled.reason} ({d.cancelled.byName}, {formatDate(d.cancelled.at)})
              </span>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'file',
      header: 'File',
      render: (d) =>
        d.access.canOpen ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => open(d)}>
            <Paperclip aria-hidden="true" /> Open ({fileSize(d.file.size)})
          </button>
        ) : (
          <span className="muted">{fileSize(d.file.size)}</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      render: (d) =>
        d.access.canCancel ? (
          <button type="button" className="btn btn-link btn-sm" onClick={() => setMarking(d)}>
            Wrong record
          </button>
        ) : null,
    },
  ];

  return (
    <div className="vs-tab">
      <Alert type="error">{error ?? failed}</Alert>
      <Alert type="success" onClose={() => setNotice(null)}>
        {notice}
      </Alert>
      {adding ? (
        <UploadForm
          patient={patient}
          stays={data?.stays ?? []}
          maxBytes={data?.maxBytes ?? 15 * 1024 * 1024}
          onCancel={() => setAdding(false)}
          onSaved={(d) => {
            setAdding(false);
            setNotice(`“${d.title}” is attached.`);
            reload();
          }}
        />
      ) : (
        data?.canUpload && (
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              <FileUp aria-hidden="true" /> Attach a document
            </button>
          </div>
        )
      )}
      <DataTable caption="Documents attached to this record" columns={columns} rows={data?.documents} loading={loading} emptyText="No document is attached to this record. Scans of old case papers, outside reports and letters go here." />
      {marking && (
        <WrongRecordDialog
          document={marking}
          onCancel={() => setMarking(null)}
          onConfirm={async (reason) => {
            await api(`/patients/${patient.id}/documents/${marking.id}/cancel`, { method: 'POST', body: { reason } });
            setMarking(null);
            setNotice('Marked as put on the wrong record.');
            reload();
          }}
        />
      )}
    </div>
  );
}
