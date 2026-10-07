// Sign in. "Remember my email" keeps only the email in this browser (never the password), so the next sign-in starts
// with the password.
import { ArrowRight, Lock } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert } from '../../components/Alert.jsx';
import { AuthLayout } from '../../components/AuthLayout.jsx';
import { FormBuilder } from '../../components/form/FormBuilder.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { emptyLogin, loginFields } from '../../forms/authForms.js';
import { useForm } from '../../hooks/useForm.js';

const EMAIL_KEY = 'perinexa1:rememberedEmail';
// Browser storage may be blocked (private windows): then nothing is remembered.
const readEmail = () => {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
};
const keepEmail = (email) => {
  try {
    if (email) localStorage.setItem(EMAIL_KEY, email);
    else localStorage.removeItem(EMAIL_KEY);
  } catch {
    /* not remembered – fine */
  }
};

export function LoginPage() {
  const { user, login, endReason } = useAuth();
  const [remembered] = useState(readEmail);
  const [remember, setRemember] = useState(Boolean(remembered));
  const form = useForm({ ...emptyLogin, email: remembered });
  const navigate = useNavigate();
  const from = useLocation().state?.from ?? '/';

  if (user) return <Navigate to={user.mustChangePassword ? '/change-password' : from} replace />;

  const onSubmit = async (values) => {
    const session = await login(values);
    keepEmail(remember ? values.email.trim() : '');
    navigate(session.user.mustChangePassword ? '/change-password' : from, { replace: true });
  };

  return (
    <AuthLayout
      title={remembered ? 'Welcome back' : 'Sign in'}
      subtitle="Use the email and password your administrator gave you."
      footer={
        <>
          <Lock size={14} aria-hidden /> Forgot your password? Ask your hospital administrator to reset it.
        </>
      }
    >
      <Alert type="info">{endReason}</Alert>
      <form onSubmit={form.submit(onSubmit)} noValidate>
        <FormBuilder fields={loginFields} form={form} />
        <label className="inline-check small top-gap-sm">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember my email on this computer
        </label>
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={form.submitting}>
          {form.submitting ? 'Signing in…' : (<>Sign in <ArrowRight size={18} aria-hidden /></>)}
        </button>
      </form>
    </AuthLayout>
  );
}
