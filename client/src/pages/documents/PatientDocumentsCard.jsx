// Scanned and uploaded papers on her record (discharge card, earlier records, reports …): upload a PDF, JPG or PNG,
// open one, or mark one uploaded by mistake as entered in error (it is kept, never deleted).
import { FileText, Upload } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { documentsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { toast } from '../../components/Toast.jsx';
import { Modal } from '../../components/Modal.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { formatDate, formatDateTime, labelOf } from '../../utils/format.js';

const ACCEPT = 'application/pdf,image/jpeg,image/png';
const sizeText = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Opens a document in a new tab (fetched with the session, so the hospital check applies). */
export async function openDocument(id) {
  const tab = window.open('', '_blank'); // opened now, while the click still counts, so the browser allows it
  try {
    const blob = await documentsApi.file(id);
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}

/** The upload dialog. defaultKind: e.g. 'discharge_card' from the Discharges screen. */
export function UploadDocumentModal({ patient, admissionId, defaultKind = '', onClose, onUploaded }) {
  const { documents } = useAppConfig();
  const [kind, setKind] = useState(defaultKind);
  const [title, setTitle] = useState('');
  const [documentDate, setDocumentDate] = useState('');
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tooBig = file && file.size > documents.maxMegabytes * 1024 * 1024;

  const save = async (e) => {
    e.preventDefault();
    setError('');
    if (!kind) return setError('Choose what the document is.');
    if (!file) return setError('Choose the scanned file.');
    if (tooBig) return setError(`The file is larger than ${documents.maxMegabytes} MB. Scan it at a lower resolution.`);
    setSaving(true);
    try {
      const { document } = await documentsApi.upload(patient.id, file, { kind, title: title.trim(), documentDate, admissionId });
      toast('Document uploaded');
      onUploaded(document);
    } catch (err) {
      setError(Object.values(err.fields ?? {})[0] ?? err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Upload a document – ${patient.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="upload-document" className="btn btn-primary" disabled={saving}>{saving ? 'Uploading…' : 'Upload'}</button>
        </>
      }
    >
      <form id="upload-document" onSubmit={save} noValidate>
        <Alert type="error">{error}</Alert>
        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="doc-kind">Document</label>
            <select id="doc-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Choose…</option>
              {documents.kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="doc-date">Date on the paper</label>
            <input id="doc-date" type="date" value={documentDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDocumentDate(e.target.value)} />
          </div>
        </div>
        <div className="form-field">
          <label htmlFor="doc-title">Description (optional)</label>
          <input id="doc-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="For example: discharge card from City Hospital" />
        </div>
        <div className="form-field">
          <label htmlFor="doc-file">Scanned file</label>
          <input id="doc-file" type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <span className="field-help">
            PDF, JPG or PNG, up to {documents.maxMegabytes} MB. Scan the paper with the scanner (or take a photo with a phone) and choose the file here.
          </span>
          {tooBig && <span className="field-error">This file is {sizeText(file.size)} – too large.</span>}
        </div>
      </form>
    </Modal>
  );
}

export function PatientDocumentsCard({ patient }) {
  const { documents } = useAppConfig();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    documentsApi.list(patient.id).then((r) => setItems(r.items)).catch((err) => setError(err.message));
  }, [patient.id]);
  useEffect(load, [load]);

  const open = (id) => openDocument(id).catch((err) => setError(err.message));
  const cancel = async (e) => {
    e.preventDefault();
    try {
      await documentsApi.cancel(cancelling.id, reason);
      setCancelling(null);
      setReason('');
      load();
    } catch (err) {
      setError(Object.values(err.fields ?? {})[0] ?? err.message);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Documents</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUploading(true)}><Upload size={14} aria-hidden /> Upload</button>
      </div>
      <Alert type="error">{error}</Alert>
      <Alert type="success">{notice}</Alert>
      {items && items.length === 0 && <p className="muted">No documents yet. Upload scanned discharge cards, earlier records or reports.</p>}
      <ul className="plain-list rows">
        {(items ?? []).map((d) => (
          <li key={d.id} className="appt-line">
            <span className={d.cancelled ? 'muted' : undefined}>
              {d.cancelled ? (
                <s>{labelOf(documents.kinds, d.kind)}</s>
              ) : (
                <button type="button" className="btn btn-link" onClick={() => open(d.id)}><FileText size={14} aria-hidden /> {labelOf(documents.kinds, d.kind)}</button>
              )}
              {d.title && ` – ${d.title}`}
              <span className="muted block small">
                {d.documentDate && `Dated ${formatDate(d.documentDate)} · `}
                {d.fileType.toUpperCase()}, {sizeText(d.size)} · uploaded by {d.uploadedByName}, {formatDateTime(d.uploadedAt)}
                {d.cancelled && ` · Entered in error: ${d.cancelled.reason} (${d.cancelled.byName})`}
              </span>
            </span>
            {!d.cancelled && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCancelling(d)}>Entered in error</button>
            )}
          </li>
        ))}
      </ul>
      {uploading && (
        <UploadDocumentModal
          patient={patient}
          onClose={() => setUploading(false)}
          onUploaded={() => {
            setUploading(false);
            setNotice('Document uploaded.');
            load();
          }}
        />
      )}
      {cancelling && (
        <Modal
          title="Mark as entered in error"
          onClose={() => setCancelling(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setCancelling(null)}>Cancel</button>
              <button type="submit" form="cancel-document" className="btn btn-primary">Mark as entered in error</button>
            </>
          }
        >
          <form id="cancel-document" onSubmit={cancel}>
            <p>The document is kept in the record, crossed out, and can no longer be opened.</p>
            <div className="form-field">
              <label htmlFor="cancel-reason">Reason</label>
              <input id="cancel-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="For example: wrong patient" />
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
