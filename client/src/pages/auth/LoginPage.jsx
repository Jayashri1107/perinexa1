import { ArrowRight, Lock } from 'lucide-react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert } from '../../components/Alert.jsx';
import { AuthLayout } from '../../components/AuthLayout.jsx';
import { FormBuilder } from '../../components/form/FormBuilder.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { emptyLogin, loginFields } from '../../forms/authForms.js';
import { useForm } from '../../hooks/useForm.js';

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
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in with the email and password your administrator gave you."
      footer={
        <>
          <Lock size={14} aria-hidden /> Forgot your password? Ask your hospital administrator to reset it.
        </>
      }
    >
      <Alert type="info">{endReason}</Alert>
      <form onSubmit={form.submit(onSubmit)} noValidate>
        <FormBuilder fields={loginFields} form={form} />
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={form.submitting}>
          {form.submitting ? 'Signing in…' : (<>Sign in <ArrowRight size={18} aria-hidden /></>)}
        </button>
      </form>
    </AuthLayout>
  );
}
