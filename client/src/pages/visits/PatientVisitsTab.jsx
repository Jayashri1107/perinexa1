import { useRef, useState } from 'react';
import { CircleMinus, Plus, Stethoscope } from 'lucide-react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { api, newRequestId } from '../../api.js';
import { DataTable } from '../../components/DataTable.jsx';
import { Alert, ConfirmDialog, StatusPill, formatDate } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { gaOn, gaText } from '../patients/carePlanFormat.js';
import { SignedPill } from './VisitSignature.jsx';

// The Visits tab on the patient record (Feature 8): every visit, newest first. A nurse, the patient's doctor
// or an RMO starts a visit; each visit opens on its own page with two tabs – Visit details and Prescription.

const sameDay = (a, b) => Boolean(a && b) && String(a).slice(0, 10) === String(b).slice(0, 10);

export function PatientVisitsTab() {
  const { patient } = useOutletContext();
  const navigate = useNavigate();
  const canView = Boolean(patient.access?.canViewVisits);
  const { data, error, loading } = useFetch(canView ? `/patients/${patient.id}/visits` : null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [confirmNew, setConfirmNew] = useState(false); // a second visit today: asked first
  // One id per "New visit" press, kept for a retry, so a double click or a retry starts one visit.
  const requestId = useRef(null);

  if (!canView) return <div className="card">Visits are not part of your role for this patient.</div>;
  if (error && !data) return <Alert type="error">{error}</Alert>;

  const edd = patient.pregnancy?.effectiveEdd ?? null;
  const today = data?.today;
  const todays = data?.visits.find((v) => v.status === 'active' && sameDay(v.visitOn, today));
  const open = (v) => navigate(`/patients/${patient.id}/visits/${v.id}`);

  const start = async () => {
    setBusy(true);
    setActionError(null);
    requestId.current ??= newRequestId();
    try {
      const { visit } = await api(`/patients/${patient.id}/visits`, { method: 'POST', body: { clientRequestId: requestId.current } });
      requestId.current = null;
      navigate(`/patients/${patient.id}/visits/${visit.id}`);
    } catch (err) {
      setActionError(err.message);
      setBusy(false);
    }
  };

  const columns = [
    {
      key: 'date',
      header: 'Date',
      width: 170,
      render: (v) => (
        <span className="name-cell-text">
          <strong className="tabular">{formatDate(v.visitOn)}</strong>
          {edd && patient.careType === 'antenatal' && <span className="muted tabular">{gaText(gaOn(edd, v.visitOn))}</span>}
        </span>
      ),
    },
    {
      key: 'vitals',
      header: 'Vitals',
      width: 170,
      render: (v) => (
        <span className="tabular">{[v.bp && `BP ${v.bp}`, v.weightKg != null && `${v.weightKg} kg`].filter(Boolean).join(' · ') || <span className="muted">—</span>}</span>
      ),
    },
    {
      key: 'diagnosis',
      header: 'Diagnosis',
      className: 'vs-col-wrap',
      render: (v) =>
        v.status === 'cancelled' ? (
          <StatusPill tone="inactive" icon={CircleMinus} title={v.cancelledReason ?? undefined}>
            Entered in error
          </StatusPill>
        ) : (
          v.diagnosis || <span className="muted">—</span>
        ),
    },
    {
      key: 'rx',
      header: 'Prescription',
      className: 'vs-col-wrap',
      render: (v) =>
        v.medicineCount ? (
          <span className="name-cell-text">
            <span>
              {v.medicineCount} {v.medicineCount === 1 ? 'medicine' : 'medicines'}
            </span>
            <span className="muted">{v.medicines.join(', ')}</span>
          </span>
        ) : (
          <span className="muted">—</span>
        ),
    },
    { key: 'next', header: 'Next visit', width: 140, render: (v) => (v.nextVisitOn ? <span className="tabular">{formatDate(v.nextVisitOn)}</span> : <span className="muted">—</span>) },
    { key: 'by', header: 'Started by', width: 170, render: (v) => v.createdByName },
    { key: 'signed', header: 'Signed', width: 130, render: (v) => (v.status === 'cancelled' ? <span className="muted">—</span> : <SignedPill signed={v.signed} />) },
  ];

  return (
    <div className="vs-tab">
      <Alert type="error" onClose={() => setActionError(null)}>
        {actionError && `Couldn't start the visit. ${actionError}`}
      </Alert>
      <section className="card vs-intro">
        <span className="vs-intro-icon" aria-hidden="true">
          <Stethoscope />
        </span>
        <div className="vs-intro-text">
          <h2>Visits</h2>
          <p className="hint help">
            Each visit has two tabs: <strong>Visit details</strong> (vital signs, findings, advice, next visit and the care-plan items done) and{' '}
            <strong>Prescription</strong> (the medicines, printed in the doctor's design).
          </p>
        </div>
        <div className="row">
          {data?.canCreate && (
            <button type="button" className={todays ? 'btn btn-secondary' : 'btn btn-primary'} onClick={() => (todays ? setConfirmNew(true) : start())} disabled={busy}>
              <Plus aria-hidden="true" /> {busy ? 'Starting…' : 'New visit'}
            </button>
          )}
          {todays && (
            <Link to={`/patients/${patient.id}/visits/${todays.id}`} className="btn btn-primary">
              Open today's visit
            </Link>
          )}
        </div>
      </section>
      {confirmNew && (
        <ConfirmDialog
          id="second-visit"
          title="Start a second visit today?"
          confirmLabel="Start a second visit"
          onConfirm={() => {
            setConfirmNew(false);
            start();
          }}
          onCancel={() => setConfirmNew(false)}
        >
          A visit for her was already started today. Usually today's findings and medicines belong in that visit – open it
          instead. Start a second one only for a separate visit (for example, she came back later in the day).
        </ConfirmDialog>
      )}
      <DataTable
        caption="Visits"
        columns={columns}
        rows={data?.visits}
        loading={loading}
        onRowClick={open}
        rowClassName={(v) => (v.status === 'cancelled' ? 'row-inactive' : '')}
        emptyText={data?.canCreate ? 'No visits yet. Press New visit when the patient arrives.' : 'No visits yet.'}
      />
    </div>
  );
}
