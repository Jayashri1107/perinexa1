import { useEffect, useState } from 'react';
import { ArrowRight, Baby, BedDouble, CalendarClock, Check, FlaskConical, HeartPulse, Lock, Pill, Receipt, ShieldCheck, Stethoscope, Syringe } from 'lucide-react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import logo from '../assets/brand/perinexa-logo.png';
import appIcon from '../assets/brand/perinexa-app-icon.png';
import { api } from '../api.js';
import { LOGIN_EMAIL_KEY, useAuth } from '../auth/AuthContext.jsx';
import { FullPageSpinner } from '../auth/guards.jsx';
import { PasswordInput } from '../components/PasswordInput.jsx';
import { Alert, Field } from '../components/ui.jsx';

const REASONS = {
  idle: { type: 'warning', text: 'You were logged out automatically after a period of inactivity. Log in again to continue.' },
  expired: { type: 'warning', text: 'Your session has ended. Log in again to continue.' },
  manual: { type: 'success', text: 'You have been logged out.' },
  switch: { type: 'info', text: 'You have been logged out of the platform account. Enter the password of your doctor account to continue.' },
};

// After "Switch to your doctor account": that account's email, filled in once.
function takeSwitchEmail() {
  try {
    const email = sessionStorage.getItem(LOGIN_EMAIL_KEY) ?? '';
    sessionStorage.removeItem(LOGIN_EMAIL_KEY);
    return email;
  } catch {
    return '';
  }
}

// "Remember my email on this computer": only the email, in this browser (never the password). Browser storage may be
// blocked (private windows): then nothing is remembered and the box simply starts empty.
const REMEMBER_KEY = 'perinexa1:rememberedEmail';
function rememberedEmail() {
  try {
    return localStorage.getItem(REMEMBER_KEY) ?? '';
  } catch {
    return '';
  }
}
function keepEmail(value) {
  try {
    if (value) localStorage.setItem(REMEMBER_KEY, value);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* not remembered – fine */
  }
}

export function LoginPage() {
  const { user, loading, login, logoutReason, timeoutMinutes } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [remembered] = useState(rememberedEmail);
  const [remember, setRemember] = useState(Boolean(remembered));
  const [email, setEmail] = useState(() => takeSwitchEmail() || remembered);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  // First start: no super admin yet – this page creates the first one (nothing is kept in a settings file)
  const [needsSetup, setNeedsSetup] = useState(false);
  useEffect(() => {
    api('/auth/setup-status')
      .then((r) => setNeedsSetup(Boolean(r.needsSetup)))
      .catch(() => {});
  }, []);

  if (loading) return <FullPageSpinner />;
  if (user) return <Navigate to={user.mustChangePassword ? '/change-password' : '/'} replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      const loggedIn = await login(email, password);
      keepEmail(remember ? email.trim() : '');
      const from = location.state?.from?.pathname || '/';
      navigate(loggedIn.mustChangePassword ? '/change-password' : from, { replace: true });
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields);
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  const reason = REASONS[logoutReason];
  const reasonText = logoutReason === 'idle' ? reason.text.replace('a period of', `${timeoutMinutes} minutes of`) : reason?.text;

  return (
    <AuthFrame>
      {needsSetup ? (
        <FirstSuperAdminForm
          onDone={async (account) => {
            const loggedIn = await login(account.email, account.password);
            navigate(loggedIn.mustChangePassword ? '/change-password' : '/', { replace: true });
          }}
        />
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <header className="auth1-head">
            <h1>{remembered ? 'Welcome back' : 'Sign in'}</h1>
            <p className="muted">Use the email and password your administrator gave you.</p>
          </header>
          {reason && !error && <Alert type={reason.type}>{reasonText}</Alert>}
          <Alert type="error">{error}</Alert>
          <Field label="Email" id="email" error={fieldErrors.email}>
            <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={!email} />
          </Field>
          <Field label="Password" id="password" error={fieldErrors.password}>
            <PasswordInput id="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus={Boolean(email)} />
          </Field>
          <label className="check auth-remember" htmlFor="remember-email">
            <input id="remember-email" type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember my email on this computer
          </label>
          <button type="submit" className="btn btn-primary btn-block auth1-submit" disabled={submitting}>
            {submitting ? (
              'Signing in…'
            ) : (
              <>
                Sign in <ArrowRight aria-hidden="true" />
              </>
            )}
          </button>
          <p className="auth1-foot">
            <Lock aria-hidden="true" /> Forgot your password? Ask your hospital administrator to reset it.
          </p>
        </form>
      )}
    </AuthFrame>
  );
}

// The sign-in frame as in Perinexa1 of 7 Oct (owner, 13 Oct 2026): an indigo panel on the left with the logo, a headline
// and what Perinexa does; the form card on the right. Below 960 px only the card, with the logo above it.
// The ring of hospital work around the logo, on the light side of the sign-in card (owner, 14 Oct 2026)
const AUTH_ICONS = [Stethoscope, HeartPulse, Baby, CalendarClock, BedDouble, FlaskConical, Pill, Syringe, Receipt, ShieldCheck];
const AUTH_POINTS = ['OPD and appointments', 'Wards and inpatients', 'Lab, pharmacy and billing', 'Private by design'];

function AuthFrame({ children }) {
  return (
    <div className="auth2">
      <p className="auth2-title" aria-hidden="true">
        Perinexa <span>Hospital sign-in</span>
      </p>
      <div className="auth2-card">
        <main className="auth2-form">
          <img className="auth2-logo" src={logo} alt="Perinexa by Docvritta" width="170" height="42" />
          {children}
        </main>
        <aside className="auth2-art" aria-label="About Perinexa">
          <div className="auth2-orbit" aria-hidden="true">
            <ul>
              {AUTH_ICONS.map((Icon, i) => (
                <li key={i} style={{ '--i': i, '--n': AUTH_ICONS.length }}>
                  <Icon />
                </li>
              ))}
            </ul>
            <div className="auth2-centre">
              <img src={appIcon} alt="" width="56" height="56" />
              <strong>Perinexa</strong>
              <span>Hospital workspace</span>
            </div>
          </div>
          <ul className="auth2-points">
            {AUTH_POINTS.map((t) => (
              <li key={t}>
                <Check aria-hidden="true" /> {t}
              </li>
            ))}
          </ul>
        </aside>
      </div>
      <p className="auth2-foot">© {new Date().getFullYear()} Perinexa by Docvritta</p>
    </div>
  );
}

/**
 * The very first start (owner's request, 12 Oct 2026): there is no super admin yet, so this creates the first one –
 * name, email and password typed here, never kept in a settings file. The server refuses once a super admin exists.
 */
function FirstSuperAdminForm({ onDone }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', repeat: '' });
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    if (form.password !== form.repeat) {
      setFieldErrors({ repeat: 'The two passwords are not the same.' });
      return;
    }
    setSubmitting(true);
    try {
      await api('/auth/setup', { method: 'POST', body: { name: form.name, email: form.email, password: form.password } });
      await onDone({ email: form.email, password: form.password });
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <header className="auth1-head">
        <h1>Create the first super admin</h1>
        <p className="muted">Perinexa has no super admin yet. This account manages every hospital and every user account. It never sees patient records.</p>
      </header>
      <Alert type="error">{error}</Alert>
      <Field label="Full name" id="setup-name" error={fieldErrors.name}>
        <input id="setup-name" value={form.name} onChange={set('name')} maxLength={100} autoComplete="name" required autoFocus />
      </Field>
      <Field label="Email" id="setup-email" error={fieldErrors.email}>
        <input id="setup-email" type="email" value={form.email} onChange={set('email')} maxLength={254} autoComplete="username" required />
      </Field>
      <Field label="Password" id="setup-password" error={fieldErrors.password} hint="At least 8 characters, with at least one letter and one number." keepHint>
        <PasswordInput id="setup-password" value={form.password} onChange={set('password')} autoComplete="new-password" required />
      </Field>
      <Field label="Repeat the password" id="setup-repeat" error={fieldErrors.repeat}>
        <PasswordInput id="setup-repeat" value={form.repeat} onChange={set('repeat')} autoComplete="new-password" required />
      </Field>
      <button type="submit" className="btn btn-primary btn-block auth1-submit" disabled={submitting}>
        {submitting ? 'Creating…' : 'Create super admin'}
      </button>
    </form>
  );
}
