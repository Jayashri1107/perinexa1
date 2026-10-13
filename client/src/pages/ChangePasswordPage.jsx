import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Alert, Field } from '../components/ui.jsx';

// Change password. Shown on its own at /change-password (first login with a temporary password, so it
// puts its own title in the title bar), or as the "Password" tab of My settings (embedded: My settings's
// header is already on the screen, so the card gets a card title instead), or in a pop-up from the profile menu
// (onClose: the pop-up's Cancel, then Done once the password is changed).
export function ChangePasswordPage({ embedded = false, onClose = null }) {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const forced = user.mustChangePassword;
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [success, setSuccess] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setFieldErrors({});
    if (form.newPassword !== form.confirmPassword) {
      setFieldErrors({ confirmPassword: "The new passwords don't match – type the same password in both boxes." });
      return;
    }
    setSubmitting(true);
    try {
      const data = await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: form.currentPassword, newPassword: form.newPassword },
      });
      setUser(data.user);
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      if (forced) navigate('/', { replace: true, state: { flash: 'Your password has been changed. Welcome.' } });
      else setSuccess('Your password has been changed.');
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields);
    } finally {
      setSubmitting(false);
    }
  };

  const title = forced ? 'Choose a new password' : 'Change password';

  const card = (
    <form className={embedded ? 'card acc-card' : 'card narrow'} id={embedded ? 'password' : undefined} onSubmit={onSubmit} noValidate>
      {embedded && <h2>{title}</h2>}
      {forced && (
        <Alert type="info">For your security, please replace the temporary password with one only you know before continuing.</Alert>
      )}
      <Alert type="success">{success}</Alert>
      <Alert type="error">{error}</Alert>
      <Field label={forced ? 'Temporary (current) password' : 'Current password'} id="currentPassword" error={fieldErrors.currentPassword}>
        <input id="currentPassword" type="password" autoComplete="current-password" value={form.currentPassword} onChange={update('currentPassword')} required autoFocus={!embedded} />
      </Field>
      <Field label="New password" id="newPassword" error={fieldErrors.newPassword} hint="At least 12 characters, with at least one letter and one number." keepHint>
        <input id="newPassword" type="password" autoComplete="new-password" value={form.newPassword} onChange={update('newPassword')} required />
      </Field>
      <Field label="Repeat new password" id="confirmPassword" error={fieldErrors.confirmPassword}>
        <input id="confirmPassword" type="password" autoComplete="new-password" value={form.confirmPassword} onChange={update('confirmPassword')} required />
      </Field>
      <div className="acc-actions">
        {success && onClose ? (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Change password'}
          </button>
        )}
        {onClose && !success && (
          <button type="button" className="btn btn-link" onClick={onClose}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );

  if (embedded) return card;
  return (
    <>
      <PageHeader title={title} />
      <div className="pf-content">{card}</div>
    </>
  );
}
