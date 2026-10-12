import { useRef, useState } from 'react';
import { Check, ScanLine, X } from 'lucide-react';
import { api, newRequestId } from '../../api.js';
import { DataTable } from '../../components/DataTable.jsx';
import { Alert, Field, StatusPill, formatDate, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';

// Scans and procedures done (on the patient's Lab tab): the doctor, RMO or nurse records what was done from the
// hospital's price list, and the charge goes on her bill by itself – reception no longer adds it by hand. Only what
// was done and when: the findings are written in the visit. One entered in error is cancelled with a reason.

const GROUP_WORDS = { scan: 'Scans', procedure: 'Procedures' };

function RecordDialog({ patient, items, onDone, onCancel }) {
  const [itemId, setItemId] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const requestId = useRef(newRequestId());
  const ref = useDialogFocus(onCancel);
  const save = async (e) => {
    e.preventDefault();
    if (!itemId) return setError('Choose what was done.');
    setSaving(true);
    setError(null);
    try {
      const res = await api(`/patients/${patient.id}/work-done`, { method: 'POST', body: { clientRequestId: requestId.current, priceItemId: itemId } });
      onDone(res.work);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
    return undefined;
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="work-done-title" onSubmit={save} noValidate>
        <h2 id="work-done-title">Scan or procedure done for {patient.fullName}</h2>
        <Alert type="error">{error}</Alert>
        <Field label="What was done today" id="work-done-item" hint="From the hospital's price list. The charge goes on her bill by itself." keepHint>
          <select id="work-done-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">Choose…</option>
            {Object.entries(GROUP_WORDS).map(([group, label]) => {
              const inGroup = items.filter((i) => i.group === group);
              return inGroup.length ? (
                <optgroup key={group} label={label}>
                  {inGroup.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <Check aria-hidden="true" /> {saving ? 'Saving…' : 'Record as done'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function CancelDialog({ patient, work, onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const ref = useDialogFocus(onCancel);
  const save = async (e) => {
    e.preventDefault();
    if (reason.trim().length < 3) return setError('Write why it is cancelled.');
    setSaving(true);
    setError(null);
    try {
      await api(`/patients/${patient.id}/work-done/${work.id}/cancel`, { method: 'POST', body: { reason: reason.trim() } });
      onDone();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
    return undefined;
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="work-cancel-title" onSubmit={save} noValidate>
        <h2 id="work-cancel-title">Cancel {work.name}</h2>
        <p>
          Recorded on {formatDate(work.on)} by {work.doneByName}. Cancelling takes its charge off the bill. It stays in the list, marked cancelled.
        </p>
        <Alert type="error">{error}</Alert>
        <Field label="Why" id="work-cancel-reason" hint="e.g. entered for the wrong patient" keepHint>
          <input id="work-cancel-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-danger" disabled={saving}>
            <X aria-hidden="true" /> {saving ? 'Cancelling…' : 'Cancel it'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Keep it
          </button>
        </div>
      </form>
    </div>
  );
}

export function WorkDoneSection({ patient }) {
  const { data, error, loading, reload } = useFetch(`/patients/${patient.id}/work-done`);
  const [recording, setRecording] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const columns = [
    { key: 'on', header: 'Date', render: (w) => <span className="tabular">{formatDate(w.on)}</span> },
    { key: 'name', header: 'Scan or procedure', className: 'wrap', render: (w) => <strong>{w.name}</strong> },
    { key: 'by', header: 'Recorded by', render: (w) => w.doneByName },
    {
      key: 'status',
      header: 'Status',
      className: 'wrap',
      render: (w) =>
        w.cancelled ? (
          <span>
            <StatusPill tone="inactive" icon={X}>
              Cancelled
            </StatusPill>{' '}
            <span className="t-caption muted">
              {w.cancelled.reason} ({w.cancelled.byName})
            </span>
          </span>
        ) : (
          <StatusPill tone="stable" icon={Check}>
            Done
          </StatusPill>
        ),
    },
    ...(data?.canRecord
      ? [
          {
            key: 'actions',
            header: '',
            render: (w) =>
              w.cancelled ? null : (
                <button type="button" className="btn btn-link btn-sm" onClick={() => setCancelling(w)}>
                  Cancel
                </button>
              ),
          },
        ]
      : []),
  ];
  return (
    <>
      <Alert type="error">{error}</Alert>
      <section className="card vs-intro">
        <span className="vs-intro-icon" aria-hidden="true">
          <ScanLine />
        </span>
        <div className="vs-intro-text">
          <h2>Scans and procedures</h2>
          <p className="hint help">What was done for this patient, so that its charge goes on her bill by itself. Write the findings in the visit.</p>
        </div>
        {data?.canRecord && data.items.length > 0 && (
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={() => setRecording(true)}>
              <ScanLine aria-hidden="true" /> Record a scan or procedure
            </button>
          </div>
        )}
      </section>
      <DataTable caption="Scans and procedures done" columns={columns} rows={data?.done} loading={loading} emptyText="No scan or procedure recorded yet." />
      {recording && (
        <RecordDialog
          patient={patient}
          items={data.items}
          onCancel={() => setRecording(false)}
          onDone={() => {
            setRecording(false);
            reload();
          }}
        />
      )}
      {cancelling && (
        <CancelDialog
          patient={patient}
          work={cancelling}
          onCancel={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            reload();
          }}
        />
      )}
    </>
  );
}
