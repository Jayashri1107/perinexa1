import { useState } from 'react';
import { BadgeCheck, Globe, UserPlus, UserX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { canRegisterPatients, patientTabs } from '../../platform/modules.js';
import { PatientFinder } from '../appointments/AppointmentDialogs.jsx';
import { Modal } from '../pharmacy/pharmacyUi.jsx';
import { Section } from '../worklist/WorklistSections.jsx';

// Patients → Online sign-ups (owner, 16 Oct 2026 – docs/PATIENT_ACCOUNTS_PLAN.md): patients who signed up for their own
// portal account wait here. Reception checks who she is (at the desk or by phone), then approves – linking her patient
// record: one that may be hers ("same mobile" / "same name"), one found, or a new registration with her details filled
// in – or rejects with a reason. Only an approved account can sign in. Reception, doctors and RMOs.

/** Approve against an existing record: the records that may be hers, or any found. */
function ApproveDialog({ account, onClose, onDone }) {
  const matches = useFetch(`/patient-accounts/${account.id}/matches`);
  const [chosen, setChosen] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/patient-accounts/${account.id}/approve`, { method: 'POST', body: { patientId: chosen.id } });
      onDone(`${account.fullName}: approved, linked to ${chosen.fullName} (${chosen.mrn}). She can sign in now.`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal id="signup-approve" title={`Approve ${account.fullName}`} onClose={onClose} wide>
      <p className="hint">Check who she is first (at the desk, or by calling {account.mobile}). Then choose her record.</p>
      <Alert type="error">{error ?? matches.error}</Alert>
      {matches.data?.matches?.length > 0 && (
        <ul className="appt-pick-list" aria-label="Records that may be hers">
          {matches.data.matches.map((m) => (
            <li key={m.id}>
              <button type="button" className="appt-pick" aria-pressed={chosen?.id === m.id} onClick={() => setChosen(m)}>
                <strong>{m.fullName}</strong>
                <span className="muted">
                  {m.mrn}
                  {m.age != null ? ` · ${m.age} yrs` : ''}
                  {m.phoneEnd ? ` · phone …${m.phoneEnd}` : ''} · same {m.matchedOn.join(' and ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {matches.data && !matches.data.matches.length && <p className="muted">No record with the same mobile number or name. Find another, or register her.</p>}
      <PatientFinder onPick={(p) => setChosen({ id: p.id, fullName: p.fullName, mrn: p.mrn })} />
      {chosen && (
        <p className="appt-chosen">
          <strong>{chosen.fullName}</strong> <span className="muted">{chosen.mrn}</span>
        </p>
      )}
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={!chosen || busy} onClick={approve}>
          <BadgeCheck aria-hidden="true" /> {busy ? 'Approving…' : chosen ? `Approve as ${chosen.fullName}` : 'Approve'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function RejectDialog({ account, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const reject = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/patient-accounts/${account.id}/reject`, { method: 'POST', body: { reason } });
      onDone(`${account.fullName}: rejected. She is told to call the hospital.`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal id="signup-reject" title={`Reject ${account.fullName}`} onClose={onClose}>
      <form onSubmit={reject} noValidate>
        <Alert type="error">{error}</Alert>
        <Field label="Why" id="signup-reject-reason" hint="Kept by the hospital; she is only told to call the hospital.">
          <input id="signup-reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus />
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-danger" disabled={busy || reason.trim().length < 3}>
            <UserX aria-hidden="true" /> {busy ? 'Rejecting…' : 'Reject'}
          </button>
          <button type="button" className="btn btn-link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** One waiting sign-up with its three choices. */
function SignupRow({ a, onApprove, onReject }) {
  return (
    <li className="wl-row appt-guest-row">
      <div>
        <strong>{a.fullName}</strong>{' '}
        <StatusPill tone="due" icon={Globe}>
          Waiting for approval
        </StatusPill>
        <p className="hint">
          {a.ageYears != null ? `${a.ageYears} yrs · ` : ''}mobile {a.mobile} · {a.email ?? 'no email (signs in with mobile and OTP)'} · signed up {formatDateTime(a.signedUpAt)}
        </p>
      </div>
      <span className="row">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onApprove(a)}>
          <BadgeCheck aria-hidden="true" /> Find her record and approve
        </button>
        <Link className="btn btn-link btn-sm" to="/patients/new" state={{ fromSignup: { id: a.id, name: a.fullName, phone: a.mobile, age: a.ageYears } }}>
          <UserPlus aria-hidden="true" /> Register and approve
        </Link>
        <button type="button" className="btn btn-link btn-sm" onClick={() => onReject(a)}>
          Reject
        </button>
      </span>
    </li>
  );
}

/** The waiting sign-ups with their dialogs (the page, and the section on reception's Today page). */
function useSignups(onChanged) {
  const res = useFetch('/patient-accounts');
  const [dialog, setDialog] = useState(null); // { kind, account }
  const [flash, setFlash] = useState(null);
  const done = (message) => {
    setDialog(null);
    setFlash(message);
    res.reload();
    onChanged?.();
  };
  const dialogs = dialog?.kind === 'approve' ? (
    <ApproveDialog account={dialog.account} onClose={() => setDialog(null)} onDone={done} />
  ) : dialog?.kind === 'reject' ? (
    <RejectDialog account={dialog.account} onClose={() => setDialog(null)} onDone={done} />
  ) : null;
  return { res, flash, setFlash, dialogs, approve: (account) => setDialog({ kind: 'approve', account }), reject: (account) => setDialog({ kind: 'reject', account }) };
}

/** On reception's Today page: who is waiting for approval. */
export function SignupsSection() {
  const s = useSignups();
  const list = s.res.data?.accounts ?? [];
  if (!s.res.data) return null;
  return (
    <Section id="td-signups" icon={Globe} title="Online sign-ups to approve" count={list.length} empty={s.flash ?? 'Nobody is waiting for approval.'}>
      <Alert type="success" onClose={() => s.setFlash(null)}>
        {s.flash}
      </Alert>
      <ul className="wl-list">
        {list.map((a) => (
          <SignupRow key={a.id} a={a} onApprove={s.approve} onReject={s.reject} />
        ))}
      </ul>
      {s.dialogs}
    </Section>
  );
}

export function SignupsPage() {
  const { activeMembership } = useAuth();
  const roles = activeMembership.roles;
  const handled = useFetch(canRegisterPatients(roles) ? '/patient-accounts' : null, { status: 'handled' });
  const s = useSignups(handled.reload);
  const list = s.res.data?.accounts ?? [];
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Patients', to: '/patients' }, { label: 'Online sign-ups' }]} title="Online sign-ups" tabs={patientTabs(roles)} />
      <div className="pf-content">
        {!canRegisterPatients(roles) && <div className="card narrow">Online sign-ups are handled by reception, doctors and RMOs.</div>}
        <Alert type="success" onClose={() => s.setFlash(null)}>
          {s.flash}
        </Alert>
        <Alert type="error">{s.res.error}</Alert>
        {s.res.data && (
          <section className="card" aria-labelledby="signups-waiting">
            <h2 id="signups-waiting">Waiting for approval ({list.length})</h2>
            <p className="hint">
              A patient signed up on the sign-in page or the hospital's portal address. Check who she is, then approve – choosing her record, or registering her – or reject. She can sign in
              only after approval, and sees only signed visits, reviewed lab reports and her bills.
            </p>
            {!list.length && <p className="muted">Nobody is waiting.</p>}
            <ul className="wl-list">
              {list.map((a) => (
                <SignupRow key={a.id} a={a} onApprove={s.approve} onReject={s.reject} />
              ))}
            </ul>
          </section>
        )}
        {handled.data?.accounts?.length > 0 && (
          <section className="card" aria-labelledby="signups-handled">
            <h2 id="signups-handled">Recently handled</h2>
            <ul className="plain-list">
              {handled.data.accounts.map((a) => (
                <li key={a.id}>
                  <strong>{a.fullName}</strong>{' '}
                  <StatusPill tone={a.status === 'approved' ? 'stable' : 'inactive'}>{a.status === 'approved' ? 'Approved' : 'Rejected'}</StatusPill>{' '}
                  <span className="muted">
                    {a.patient ? (
                      <>
                        <Link to={`/patients/${a.patient.id}`}>{a.patient.mrn}</Link> ·{' '}
                      </>
                    ) : null}
                    {a.reviewed ? `${a.reviewed.byName}, ${formatDate(a.reviewed.at)}` : ''}
                    {a.reviewed?.reason ? ` – ${a.reviewed.reason}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {s.dialogs}
    </>
  );
}
