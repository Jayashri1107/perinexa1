import { useNavigate } from 'react-router-dom';
import { Alert } from '../../components/Alert.jsx';
import { FormBuilder } from '../../components/form/FormBuilder.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { changePasswordFields, emptyChangePassword } from '../../forms/authForms.js';
import { useForm } from '../../hooks/useForm.js';
import { BrandMark } from '../../layout/AdminLayout.jsx';

export function ChangePasswordPage() {
  const { password } = useAppConfig();
  const { user, changePassword, logout } = useAuth();
  const form = useForm(emptyChangePassword);
  const navigate = useNavigate();
  const forced = user.mustChangePassword;

  const onSubmit = async ({ confirmPassword, ...values }) => {
    if (values.newPassword !== confirmPassword) {
      form.setErrors({ confirmPassword: 'The two new passwords are not the same.' });
      return;
    }
    await changePassword(values);
    navigate('/', { replace: true });
  };

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <BrandMark size="lg" />
        <h1>{forced ? 'Choose your own password' : 'Change password'}</h1>
        {forced && <Alert type="info">You logged in with a temporary password. Choose your own before you continue.</Alert>}
        <form onSubmit={form.submit(onSubmit)} noValidate>
          <FormBuilder fields={changePasswordFields(password)} form={form} />
          <button type="submit" className="btn btn-primary btn-block" disabled={form.submitting}>
            {form.submitting ? 'Saving…' : 'Save password'}
          </button>
        </form>
        <button type="button" className="btn btn-link" onClick={() => (forced ? logout() : navigate(-1))}>
          {forced ? 'Log out' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
