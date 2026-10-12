import { useState } from 'react';
import { CircleCheck, CircleMinus, Copy, Pencil, RotateCcw } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, formatDateTime, useConfirm, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { KNOWLEDGE_CRUMB, knowledgeTabs } from '../../platform/modules.js';
import { careTypesText } from '../consents/consentFormat.js';
import { CARE_TYPE_SHORT } from '../patients/patientFormat.js';
import { SetContents, SetStatus } from './PrescriptionSetParts.jsx';

// One ready-made prescription set (Feature 8b): what it adds to a prescription, and for doctors: edit, copy,
// approve, and stop or start using it.

function ApproveDialog({ set, onDone, onOutdated, onCancel }) {
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const ref = useDialogFocus(onCancel);
  const approve = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await api(`/prescription-sets/${set.id}/approve`, { method: 'POST', body: { confirm: confirmed, version: set.version } });
      onDone(res.set);
    } catch (err) {
      setError(err.message);
      setSaving(false);
      if (err.status === 409) onOutdated(err.message);
    }
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="rxs-approve-title" onSubmit={approve}>
        <h2 id="rxs-approve-title">Approve for use in the hospital</h2>
        <p>
          You are approving <strong>{set.name}</strong> (version {set.version}). Once approved, it is no longer marked as a draft when a doctor or RMO adds it to
          a prescription.
        </p>
        <Alert type="error">{error}</Alert>
        <label className="checkbox">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>
            I am a doctor. I have checked every medicine, strength, dose, duration and instruction in this set, and its tests and advice, and I approve it for
            use in our hospital. Every prescription made from it is still checked by the doctor who writes it.
          </span>
        </label>
        <div className="row cp-dialog-actions">
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-positive" disabled={!confirmed || saving}>
            <CircleCheck aria-hidden="true" /> {saving ? 'Approving…' : 'Approve set'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function PrescriptionSetPage() {
  const { activeMembership } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { data, error, reload } = useFetch(`/prescription-sets/${id}`);
  const [flash, setFlash] = useState(location.state?.flash ?? null);
  const [actionError, setActionError] = useState(null);
  const [approving, setApproving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const s = data?.set;

  if (error && !s) {
    return (
      <>
        <PageHeader breadcrumbs={[KNOWLEDGE_CRUMB, { label: 'Prescription sets', to: '/prescription-sets' }, { label: 'Not found' }]} title="Set not found" />
        <div className="pf-content">
          <div className="card narrow">
            <Alert type="error">{error}</Alert>
            <p>
              <Link to="/prescription-sets">Back to prescription sets</Link>
            </p>
          </div>
        </div>
      </>
    );
  }
  if (!s) return <FullPageSpinner />;

  const copy = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await api('/prescription-sets', { method: 'POST', body: { copyFrom: s.id } });
      navigate(`/prescription-sets/${res.set.id}`, { state: { flash: 'A copy was made as a new draft set. Change it as needed, then approve it.' } });
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (active) => {
    if (!active) {
      const ok = await confirm({
        title: `Stop using ${s.name}?`,
        text: 'It will no longer be offered on the Prescription tab. It is kept and can be used again later. Prescriptions made from it do not change.',
        confirmLabel: 'Stop using',
      });
      if (!ok) return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await api(`/prescription-sets/${s.id}/active`, { method: 'PATCH', body: { active } });
      setFlash(active ? 'The set is in use again.' : 'The set is no longer offered on the Prescription tab.');
      reload();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[KNOWLEDGE_CRUMB, { label: 'Prescription sets', to: '/prescription-sets' }, { label: s.name }]}
        title={s.name}
        badges={<SetStatus set={s} />}
        tabs={knowledgeTabs(activeMembership.roles)}
        actions={
          s.canEdit && (
            <>
              {s.canApprove && s.status === 'draft' && s.isActive && (
                <button type="button" className="btn btn-positive" onClick={() => setApproving(true)}>
                  <CircleCheck aria-hidden="true" /> Approve
                </button>
              )}
              <Link to={`/prescription-sets/${s.id}/edit`} className="btn btn-secondary">
                <Pencil aria-hidden="true" /> Edit
              </Link>
              <button type="button" className="btn btn-secondary" onClick={copy} disabled={busy}>
                <Copy aria-hidden="true" /> Copy
              </button>
              {s.isActive ? (
                <button type="button" className="btn btn-link" onClick={() => setActive(false)} disabled={busy}>
                  <CircleMinus aria-hidden="true" /> Stop using
                </button>
              ) : (
                <button type="button" className="btn btn-link" onClick={() => setActive(true)} disabled={busy}>
                  <RotateCcw aria-hidden="true" /> Use again
                </button>
              )}
            </>
          )
        }
      />
      <div className="pf-content">
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        <Alert type="error" onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
        {s.status === 'draft' && (
          <Alert type="warning">
            <strong>Draft – not approved yet.</strong>{' '}
            {s.origin === 'built_in' && s.version === 1
              ? 'The software developer prepared this set from published guidance; no doctor has checked it. '
              : 'This version has not been approved yet. '}
            Check every medicine, dose and instruction, then a doctor approves it.
          </Alert>
        )}

        <section className="card rxs-meta">
          <dl className="details">
            <div>
              <dt>For</dt>
              <dd>{careTypesText(s.careTypes, CARE_TYPE_SHORT)}</dd>
            </div>
            <div>
              <dt>Approved</dt>
              <dd>
                {s.approvedByName ? `${s.approvedByName}, ${formatDateTime(s.approvedAt)} (version ${s.approvedVersion})${s.status === 'draft' ? ' – changed since' : ''}` : 'Not yet'}
              </dd>
            </div>
            <div>
              <dt>Last changed</dt>
              <dd>
                {formatDateTime(s.updatedAt)}
                {s.updatedByName ? ` by ${s.updatedByName}` : ''}
              </dd>
            </div>
            {s.about && (
              <div>
                <dt>Notes for doctors</dt>
                <dd className="pre-line">{s.about}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className="card rxs-what" aria-labelledby="rxs-what-title">
          <h2 id="rxs-what-title">What it adds to a prescription</h2>
          <p className="hint help">
            The medicines and general instructions go on the Prescription tab (medicines already there are replaced by the set's version); the tests and advice
            go on Visit details. The doctor changes anything before saving.
          </p>
          <SetContents set={s} headingId="rxs-page" />
        </section>
      </div>
      {approving && (
        <ApproveDialog
          set={s}
          onCancel={() => setApproving(false)}
          onDone={() => {
            setApproving(false);
            setFlash('Set approved. It is no longer marked as a draft on the Prescription tab.');
            reload();
          }}
          onOutdated={(message) => {
            setApproving(false);
            setActionError(message);
            reload();
          }}
        />
      )}
      {confirmDialog}
    </>
  );
}
