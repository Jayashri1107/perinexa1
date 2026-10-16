import { useState } from 'react';
import { BadgeCheck, Globe, UserPlus, UserX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { canRegisterPatients, patientTabs } from '../../platform/modules.js';
import { CARE_TYPE_LABELS } from './patientFormat.js';
import { PatientFinder } from '../appointments/AppointmentDialogs.jsx';
import { Modal } from '../pharmacy/pharmacyUi.jsx';
import { Section } from '../worklist/WorklistSections.jsx';

// Patients → Online sign-ups (owner, 16 Oct 2026 – docs/PATIENT_ACCOUNTS_PLAN.md): patients who signed up for their own
// portal account wait here, with the registration details they typed (name, age, mobile, address, what they come for,
// and for a pregnancy the first day of the last period). Reception checks who she is (at the desk or by phone), then
// approves – linking a record that is already hers ("same mobile" / "same name"), or registering her as a new patient
// from her own details in one click – or rejects with a reason. Only an approved account can sign in.

/** Approve against an existing record: the records that may be hers, or any found. */
/** What she typed when she signed up. */
function SignupDetails({ a }) {
  const rows = [
    ['Age', a.ageYears != null ? `${a.ageYears} yrs` : ''],
    ['Mobile', a.mobile],
    ['Address', a.address],
    ['Coming for', a.careType ? CARE_TYPE_LABELS[a.careType] : ''],
    ['Last period (said by her)', a.lmpSaid ? formatDate(a.lmpSaid) : ''],
    ['Email', a.email ?? 'none – signs in with mobile and OTP'],
  ].filter(([, v]) => v);
  return (
    <dl className="signup-details">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ApproveDialog({ account, onClose, onDone }) {
  const matches = useFetch(`/patient-accounts/${account.id}/matches`);
  const [chosen, setChosen] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // 'link' | 'new'
  const run = async (kind, fn) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  };
  const approve = () =>
    run('link', async () => {
      await api(`/patient-accounts/${account.id}/approve`, { method: 'POST', body: { patientId: chosen.id } });
      onDone(`${account.fullName}: approved, linked to ${chosen.fullName} (${chosen.mrn}). She can sign in now.`);
    });
  const registerNew = () =>
    run('new', async () => {
      const out = await api(`/patient-accounts/${account.id}/approve-new`, { method: 'POST' });
      onDone(`${account.fullName}: registered as ${out.account.patient.mrn} from her own details and approved. She can sign in now.${account.lmpSaid ? ' The date of her last period is on her record as a note for the doctor to confirm.' : ''}`);
    });
  const found = matches.data?.matches ?? [];
  return (
    <Modal id="signup-approve" title={`Approve ${account.fullName}`} onClose={onClose} wide>
      <p className="hint">Check who she is first (at the desk, or by calling {account.mobile}).</p>
      <SignupDetails a={account} />
      <Alert type="error">{error ?? matches.error}</Alert>
      {matches.data && account.careType && (
        <div className={`signup-new ${found.length ? '' : 'is-only'}`}>
          <div>
            <strong>{found.length ? 'Not one of the records below?' : 'No record with the same mobile number or name.'}</strong>
            <p className="hint">Her record is made from the details above (patient number given now). The doctor adds the medical details at her visit.</p>
          </div>
          <button type="button" className={`btn btn-sm ${found.length ? 'btn-secondary' : 'btn-primary'}`} disabled={Boolean(busy)} onClick={registerNew}>
            <UserPlus aria-hidden="true" /> {busy === 'new' ? 'Registering…' : 'Register as a new patient and approve'}
          </button>
        </div>
      )}
      {found.length > 0 && <h3 className="signup-sub">Records that may be hers</h3>}
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
      <PatientFinder onPick={(p) => setChosen({ id: p.id, fullName: p.fullName, mrn: p.mrn })} />
      {chosen && (
        <p className="appt-chosen">
          <strong>{chosen.fullName}</strong> <span className="muted">{chosen.mrn}</span>
        </p>
      )}
      <div className="row">
        <button type="button" className={`btn ${found.length || !account.careType ? 'btn-primary' : 'btn-secondary'}`} disabled={!chosen || Boolean(busy)} onClick={approve}>
          <BadgeCheck aria-hidden="true" /> {busy === 'link' ? 'Approving…' : chosen ? `Approve as ${chosen.fullName} (${chosen.mrn})` : 'Approve with the record chosen'}
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
          {a.ageYears != null ? `${a.ageYears} yrs · ` : ''}mobile {a.mobile}
          {a.careType ? ` · ${CARE_TYPE_LABELS[a.careType]}` : ''} · signed up {formatDateTime(a.signedUpAt)}
        </p>
      </div>
      <span className="row">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onApprove(a)}>
          <BadgeCheck aria-hidden="true" /> Review and approve
        </button>
        {/* Signed up before the registration details were asked for: the New patient form, filled in */}
        {!a.careType && (
          <Link className="btn btn-link btn-sm" to="/patients/new" state={{ fromSignup: { id: a.id, name: a.fullName, phone: a.mobile, age: a.ageYears } }}>
            <UserPlus aria-hidden="true" /> Register and approve
          </Link>
        )}
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
              A patient signed up on the sign-in page with her own registration details. Check who she is, then Review and approve: link the record that is already hers, or register
              her as a new patient from her details in one click – or reject. She can sign in only after approval, and sees only signed visits, reviewed lab reports and her bills.
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
