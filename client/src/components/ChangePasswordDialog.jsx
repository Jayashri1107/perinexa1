// Change password in a pop-up, where you are (My settings, the profile menu). The first login with a temporary
// password still uses its own page, because nothing else may be done before it.
import { CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { useAppConfig } from '../context/AppConfigContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { changePasswordFields, emptyChangePassword } from '../forms/authForms.js';
import { useForm } from '../hooks/useForm.js';
import { Alert } from './Alert.jsx';
import { FormBuilder } from './form/FormBuilder.jsx';
import { Modal } from './Modal.jsx';

export function ChangePasswordDialog({ onClose }) {
  const { password } = useAppConfig();
  const { changePassword } = useAuth();
  const form = useForm(emptyChangePassword);
  const [done, setDone] = useState(false);

  const onSubmit = async ({ confirmPassword, ...values }) => {
    if (values.newPassword !== confirmPassword) {
      form.setErrors({ confirmPassword: 'The two new passwords are not the same.' });
      return;
    }
    await changePassword(values);
    setDone(true);
  };

  return (
    <Modal title="Change password" onClose={onClose} size="sm">
      {done ? (
        <>
          <Alert type="success"><CircleCheck size={16} aria-hidden /> Your password is changed. Your other sessions were signed out.</Alert>
          <div className="modal-foot inline">
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        </>
      ) : (
        <form onSubmit={form.submit(onSubmit)} noValidate>
          <p className="muted small">Your other sessions will be signed out.</p>
          <FormBuilder fields={changePasswordFields(password)} form={form} />
          <div className="modal-foot inline">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={form.submitting}>{form.submitting ? 'Saving…' : 'Save password'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
