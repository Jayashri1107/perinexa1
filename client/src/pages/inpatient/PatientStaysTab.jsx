import { useRef, useState } from 'react';
import { BedDouble, CircleCheck, LogIn } from 'lucide-react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { api, newRequestId } from '../../api.js';
import { DataTable } from '../../components/DataTable.jsx';
import { Alert, Field, StatusPill, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';
import { fromLocalInput, toLocalInput } from './inpatientFormat.js';

// The Stays tab on the patient record (Version 2, inpatients): every stay in hospital, newest first, and "Admit"
// (the patient's doctor or an RMO). A stay opens on its own page: its documents and the nursing chart.

function AdmitDialog({ patient, onDone, onCancel }) {
  const [form, setForm] = useState({ admittedAt: toLocalInput(new Date().toISOString()), ward: '', bed: '', reason: '' });
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);
  const requestId = useRef(newRequestId());
  const ref = useDialogFocus(onCancel);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    if (form.reason.trim().length < 3) return setFields({ reason: 'Write the reason for admission' });
    if (patient.careType !== 'newborn' && ['reason', 'ward', 'bed'].some((k) => mentionsFetalSex(form[k]))) return setFields({ reason: PCPNDT_MESSAGE });
    setSaving(true);
    setError(null);
    try {
      const res = await api(`/patients/${patient.id}/admissions`, {
        method: 'POST',
        body: { clientRequestId: requestId.current, admittedAt: fromLocalInput(form.admittedAt) ?? '', ward: form.ward.trim(), bed: form.bed.trim(), reason: form.reason.trim() },
      });
      onDone(res.admission);
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setSaving(false);
    }
    return undefined;
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="admit-title" onSubmit={save} noValidate>
        <h2 id="admit-title">Admit {patient.fullName}</h2>
        <Alert type="error">{error}</Alert>
        <Field label="Reason for admission" id="admit-reason" error={fields.reason}>
          <input id="admit-reason" value={form.reason} maxLength={300} onChange={set('reason')} autoFocus />
        </Field>
        <div className="form-grid">
          <Field label="Ward (optional)" id="admit-ward" error={fields.ward}>
            <input id="admit-ward" value={form.ward} maxLength={60} onChange={set('ward')} />
          </Field>
          <Field label="Bed (optional)" id="admit-bed" error={fields.bed}>
            <input id="admit-bed" value={form.bed} maxLength={30} onChange={set('bed')} />
          </Field>
          <Field label="Admitted at" id="admit-at" error={fields.admittedAt}>
            <input id="admit-at" type="datetime-local" value={form.admittedAt} onChange={set('admittedAt')} />
          </Field>
        </div>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <LogIn aria-hidden="true" /> {saving ? 'Admitting…' : 'Admit'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export function PatientStaysTab() {
  const { patient, reload: reloadPatient } = useOutletContext();
  const navigate = useNavigate();
  const canView = Boolean(patient.access?.canViewVisits);
  const { data, error, loading } = useFetch(canView ? `/patients/${patient.id}/admissions` : null);
  const [admitting, setAdmitting] = useState(false);
  if (!canView) return <div className="card">Inpatient records are not part of your role for this patient.</div>;

  const columns = [
    { key: 'admitted', header: 'Admitted', render: (s) => <span className="tabular">{formatDateTime(s.admittedAt)}</span> },
    { key: 'reason', header: 'Reason', className: 'wrap', render: (s) => s.reason || <span className="muted">—</span> },
    { key: 'where', header: 'Ward / bed', render: (s) => [s.ward, s.bed && `Bed ${s.bed}`].filter(Boolean).join(' · ') || <span className="muted">—</span> },
    {
      key: 'status',
      header: 'Status',
      render: (s) =>
        s.status === 'admitted' ? (
          <StatusPill tone="admitted" icon={BedDouble}>
            In hospital
          </StatusPill>
        ) : (
          <StatusPill tone="stable" icon={CircleCheck}>
            Discharged {formatDateTime(s.dischargedAt)}
          </StatusPill>
        ),
    },
    { key: 'docs', header: 'Documents', render: (s) => `${s.signed} signed${s.drafts ? ` · ${s.drafts} draft${s.drafts > 1 ? 's' : ''}` : ''}` },
  ];

  return (
    <div className="vs-tab">
      <Alert type="error">{error}</Alert>
      <section className="card vs-intro">
        <span className="vs-intro-icon" aria-hidden="true">
          <BedDouble />
        </span>
        <div className="vs-intro-text">
          <h2>Stays in hospital</h2>
          <p className="hint help">
            Each stay has its documents – admission, rounds, {patient.careType === 'abortion' ? '' : 'delivery, '}operation, discharge – and the nursing chart.
          </p>
        </div>
        {data?.canAdmit && (
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => setAdmitting(true)}>
              <LogIn aria-hidden="true" /> Admit
            </button>
          </div>
        )}
      </section>
      <DataTable
        caption="Stays in hospital"
        columns={columns}
        rows={data?.admissions}
        loading={loading}
        onRowClick={(s) => navigate(`/patients/${patient.id}/stays/${s.id}`)}
        emptyText="No stays in hospital yet."
      />
      {admitting && (
        <AdmitDialog
          patient={patient}
          onCancel={() => setAdmitting(false)}
          onDone={(admission) => {
            setAdmitting(false);
            reloadPatient();
            navigate(`/patients/${patient.id}/stays/${admission.id}`);
          }}
        />
      )}
    </div>
  );
}
