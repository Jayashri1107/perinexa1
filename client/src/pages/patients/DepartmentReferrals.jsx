import { useState } from 'react';
import { api } from '../../api.js';
import { Alert, Field, formatDateTime, hasRole, useDialogFocus } from '../../components/ui.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DEPARTMENTS } from '../../platform/departments.js';

// Sending her to another department (owner, 9 Nov 2026 – docs/DEPARTMENT_ACCESS_PLAN.md): while the referral is open,
// that department's doctors can open her record. Her doctor or an RMO sends her; they, or a doctor of that department,
// close it when the department has seen her.

/** "Send to another department": the department and why. */
export function SendToDepartmentDialog({ patient, onSent, onCancel }) {
  const open = (patient.departmentReferrals ?? []).filter((r) => !r.closedAt).map((r) => r.department);
  const choices = DEPARTMENTS.filter((d) => d !== patient.department && !open.includes(d));
  const [department, setDepartment] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    if (!department) {
      setFieldErrors({ department: 'Choose a department' });
      return;
    }
    setSaving(true);
    try {
      await api(`/patients/${patient.id}/department-referrals`, { method: 'POST', body: { department, reason } });
      onSent(department);
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
      setSaving(false);
    }
  };

  const dialogRef = useDialogFocus(onCancel);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={dialogRef} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="dr-title" onSubmit={save} noValidate>
        <h2 id="dr-title">Send to another department</h2>
        <p className="hint">The doctors of that department can open {patient.fullName}'s record until the referral is closed.</p>
        <Alert type="error">{error}</Alert>
        <Field label="Department" id="dr-department" error={fieldErrors.department}>
          <select id="dr-department" value={department} onChange={(e) => setDepartment(e.target.value)} autoFocus>
            <option value="">Choose a department…</option>
            {choices.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reason (optional)" id="dr-reason" error={fieldErrors.reason} hint='e.g. "Pre-anaesthesia check before the caesarean"'>
          <input id="dr-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Sending…' : 'Send'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/** Her department and where she was sent (seen with the medical details); open referrals can be closed here. */
export function DepartmentReferralsCard({ patient, onChanged }) {
  const { activeMembership } = useAuth();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const referrals = patient.departmentReferrals ?? [];
  if (!referrals.length) return null;
  const mine = activeMembership?.departments ?? [];
  const mayClose = (r) => patient.access?.canEditClinical || (hasRole(activeMembership, 'doctor') && mine.includes(r.department));
  const close = async (r) => {
    setBusy(r.id ?? r._id);
    setError(null);
    try {
      await api(`/patients/${patient.id}/department-referrals/${r.id ?? r._id}/close`, { method: 'POST' });
      onChanged(`The referral to ${r.department} is closed.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="card">
      <h2>Sent to other departments</h2>
      <Alert type="error">{error}</Alert>
      <ul className="plain-list">
        {referrals.map((r) => (
          <li key={r.id ?? r._id} className="row-between">
            <span>
              <strong>{r.department}</strong>
              {r.reason ? ` – ${r.reason}` : ''}
              <span className="cell-sub">
                Sent by {r.byName || 'a doctor'} on {formatDateTime(r.at)}
                {r.closedAt ? ` · Closed by ${r.closedByName || 'a doctor'} on ${formatDateTime(r.closedAt)}` : ' · Open'}
              </span>
            </span>
            {!r.closedAt && mayClose(r) && (
              <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => close(r)}>
                {busy === (r.id ?? r._id) ? 'Closing…' : 'Close referral'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
