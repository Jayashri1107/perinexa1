import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert } from '../../components/Alert.jsx';
import { FormBuilder } from '../../components/form/FormBuilder.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { emptyLogin, loginFields } from '../../forms/authForms.js';
import { useForm } from '../../hooks/useForm.js';
import { BrandMark } from '../../layout/AdminLayout.jsx';

export function LoginPage() {
  const { user, login, endReason } = useAuth();
  const form = useForm(emptyLogin);
  const navigate = useNavigate();
  const from = useLocation().state?.from ?? '/';

  if (user) return <Navigate to={user.mustChangePassword ? '/change-password' : from} replace />;

  const onSubmit = async (values) => {
    const session = await login(values);
    navigate(session.user.mustChangePassword ? '/change-password' : from, { replace: true });
  };

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <BrandMark size="lg" />
        <h1>Log in</h1>
        <Alert type="info">{endReason}</Alert>
        <form onSubmit={form.submit(onSubmit)} noValidate>
          <FormBuilder fields={loginFields} form={form} />
          <button type="submit" className="btn btn-primary btn-block" disabled={form.submitting}>
            {form.submitting ? 'Checking…' : 'Log in'}
          </button>
        </form>
        <p className="muted small">Forgot your password? Ask your administrator to reset it.</p>
      </div>
    </div>
  );
}
