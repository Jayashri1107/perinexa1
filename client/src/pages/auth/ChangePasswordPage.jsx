import { useNavigate } from 'react-router-dom';
import { AuthLayout } from '../../components/AuthLayout.jsx';
import { FormBuilder } from '../../components/form/FormBuilder.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { changePasswordFields, emptyChangePassword } from '../../forms/authForms.js';
import { useForm } from '../../hooks/useForm.js';

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
    <AuthLayout
      title={forced ? 'Choose your own password' : 'Change password'}
      subtitle={forced ? `Hello ${user.name.split(' ')[0]} – you signed in with a temporary password. Choose your own to continue.` : 'Your other sessions will be signed out.'}
      footer={
        <button type="button" className="btn btn-link" onClick={() => (forced ? logout() : navigate(-1))}>
          {forced ? 'Log out' : 'Cancel'}
        </button>
      }
    >
      <form onSubmit={form.submit(onSubmit)} noValidate>
        <FormBuilder fields={changePasswordFields(password)} form={form} />
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={form.submitting}>
          {form.submitting ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </AuthLayout>
  );
}
