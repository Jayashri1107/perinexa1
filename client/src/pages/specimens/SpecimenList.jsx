import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiFile } from '../../api.js';
import { SimpleTable } from '../quality/SimpleTable.jsx';
import { fileBody, fileProblem } from '../../components/fileUpload.js';
import { DateTimeInput } from '../../components/DateTimeInput.jsx';
import { Alert, Field, StatusPill, formatDateTime, hasRole } from '../../components/ui.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { FormDialog, nowLocal, toIso } from '../quality/FormDialog.jsx';
import { SPECIMEN_KIND_LABELS, specimenLook } from './specimenFormat.js';

// The specimens of a list (Specimens page) or of one patient (her Specimens tab), with what can be done next: enter
// the report (and its file), open the report's file, review it (doctors and RMOs), or cancel one logged by mistake.

function ReportDialog({ s, onDone, onCancel }) {
  const [receivedAt, setReceivedAt] = useState(nowLocal());
  const [summary, setSummary] = useState('');
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (file && fileProblem(file)) return setError({ message: fileProblem(file) });
    setBusy(true);
    try {
      onDone(await api(`/specimens/${s.id}/report`, { method: 'POST', body: { receivedAt: toIso(receivedAt), summary, file: file ? await fileBody(file) : null } }), 'Report entered.');
    } catch (err) {
      setError(err);
      setBusy(false);
    }
    return undefined;
  };
  return (
    <FormDialog id="sp-report" title={`Report for specimen ${s.serial}`} submitLabel="Save the report" busy={busy} onSubmit={submit} onCancel={onCancel}>
      <Alert type="error">{error?.message}</Alert>
      <Field label="Report received" id="sp-received" error={error?.fields?.receivedAt}>
        <DateTimeInput id="sp-received" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
      </Field>
      <Field label="What the report says" id="sp-summary" error={error?.fields?.summary}>
        <textarea id="sp-summary" rows={4} maxLength={4000} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <Field label="Report file (optional) – PDF or photo, at most 5 MB" id="sp-file" error={error?.fields?.file}>
        <input id="sp-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
    </FormDialog>
  );
}

function ReviewDialog({ s, onDone, onCancel }) {
  const [note, setNote] = useState('');
  const [told, setTold] = useState(true);
  const [informedAt, setInformedAt] = useState(nowLocal());
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      onDone(await api(`/specimens/${s.id}/review`, { method: 'POST', body: { note, informedAt: told ? toIso(informedAt) : null } }), 'Report reviewed.');
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <FormDialog id="sp-review" title={`Review the report of specimen ${s.serial}`} submitLabel="Mark as reviewed" busy={busy} onSubmit={submit} onCancel={onCancel}>
      <Alert type="error">{error?.message}</Alert>
      <p className="pre-line">{s.report?.summary}</p>
      <Field label="Note (optional)" id="sp-note" error={error?.fields?.note}>
        <textarea id="sp-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={told} onChange={(e) => setTold(e.target.checked)} /> She has been told the result
      </label>
      {told && (
        <Field label="Told her on" id="sp-told" error={error?.fields?.informedAt}>
          <DateTimeInput id="sp-told" value={informedAt} onChange={(e) => setInformedAt(e.target.value)} />
        </Field>
      )}
    </FormDialog>
  );
}

function CancelDialog({ s, onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const submit = async () => {
    try {
      onDone(await api(`/specimens/${s.id}/cancel`, { method: 'POST', body: { reason } }), 'Specimen cancelled.');
    } catch (err) {
      setError(err);
    }
  };
  return (
    <FormDialog id="sp-cancel" title={`Cancel specimen ${s.serial}`} submitLabel="Cancel the specimen" onSubmit={submit} onCancel={onCancel}>
      <p>Only for a specimen logged by mistake. It stays in the register, marked cancelled.</p>
      <Alert type="error">{error?.message}</Alert>
      <Field label="Why" id="sp-reason" error={error?.fields?.reason}>
        <input id="sp-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

export function SpecimenList({ specimens, loading, showPatient = true, onChanged }) {
  const { activeMembership } = useAuth();
  const reviewer = hasRole(activeMembership, 'doctor', 'rmo');
  const [open, setOpen] = useState(null); // { kind, s }
  const [notice, setNotice] = useState(null);
  const done = (_res, text) => {
    setOpen(null);
    setNotice({ type: 'success', text });
    onChanged?.();
  };
  const openFile = async (s) => {
    try {
      const { blob } = await apiFile(`/specimens/${s.id}/file`);
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    }
  };
  return (
    <>
      {notice && (
        <Alert type={notice.type} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}
      <SimpleTable
        loading={loading}
        rows={specimens}
        emptyText="No specimens here."
        columns={[
          { key: 'serial', header: 'No.', render: (s) => s.serial },
          ...(showPatient ? [{ key: 'patient', header: 'Patient', render: (s) => <Link to={`/patients/${s.patientId}/specimens`}>{`${s.patient?.fullName} · ${s.patient?.mrn}`}</Link> }] : []),
          { key: 'specimen', header: 'Specimen', render: (s) => `${SPECIMEN_KIND_LABELS[s.kind]}: ${s.specimen}${s.procedure ? ` (${s.procedure})` : ''}` },
          { key: 'sentAt', header: 'Sent', render: (s) => `${formatDateTime(s.sentAt)}${s.lab ? ` · ${s.lab}` : ''}` },
          {
            key: 'status',
            header: 'Status',
            render: (s) => {
              const look = specimenLook(s);
              return (
                <StatusPill tone={look.tone} icon={look.icon}>
                  {look.word}
                </StatusPill>
              );
            },
          },
          {
            key: 'actions',
            header: 'Next',
            render: (s) => (
              <span className="row">
                {s.status === 'sent' && (
                  <>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen({ kind: 'report', s })}>
                      Enter report
                    </button>
                    <button type="button" className="btn btn-link btn-sm" onClick={() => setOpen({ kind: 'cancel', s })}>
                      Cancel
                    </button>
                  </>
                )}
                {s.status === 'reported' && reviewer && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen({ kind: 'review', s })}>
                    Review
                  </button>
                )}
                {s.report?.file && (
                  <button type="button" className="btn btn-link btn-sm" onClick={() => openFile(s)}>
                    Open report file
                  </button>
                )}
                {s.review && <span className="hint">{`Reviewed by ${s.review.byName}${s.review.informedAt ? `, told her ${formatDateTime(s.review.informedAt)}` : ''}`}</span>}
              </span>
            ),
          },
        ]}
      />
      {open?.kind === 'report' && <ReportDialog s={open.s} onDone={done} onCancel={() => setOpen(null)} />}
      {open?.kind === 'review' && <ReviewDialog s={open.s} onDone={done} onCancel={() => setOpen(null)} />}
      {open?.kind === 'cancel' && <CancelDialog s={open.s} onDone={done} onCancel={() => setOpen(null)} />}
    </>
  );
}
