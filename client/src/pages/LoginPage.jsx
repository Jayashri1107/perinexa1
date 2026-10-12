import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import logo from '../assets/brand/perinexa-logo.png';
import logoReversed from '../assets/brand/perinexa-logo-reversed.png';
import { LOGIN_EMAIL_KEY, useAuth } from '../auth/AuthContext.jsx';
import { FullPageSpinner } from '../auth/guards.jsx';
import { SampleDataBanner } from '../components/Layout.jsx';
import { Alert, Field } from '../components/ui.jsx';

// Optional photo for the right-hand side. Drop a licensed photo at client/src/assets/brand/login-photo.jpg
// (or .jpeg / .png / .webp); without one the side shows the plain Mist panel.
const photo = Object.values(
  import.meta.glob('../assets/brand/login-photo.{jpg,jpeg,png,webp}', { eager: true, import: 'default' }),
)[0];

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

export function LoginPage() {
  const { user, loading, login, logoutReason, timeoutMinutes } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState(takeSwitchEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <FullPageSpinner />;
  if (user) return <Navigate to={user.mustChangePassword ? '/change-password' : '/'} replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      const loggedIn = await login(email, password);
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
    <div className="auth-page">
      <SampleDataBanner />
      <div className={photo ? 'auth has-photo' : 'auth'}>
        <main className="auth-main">
          <form className="auth-card" onSubmit={onSubmit} noValidate>
            <img className="auth-card-logo" src={logo} alt="Perinexa by Docvritta" width="200" height="49" />
            <h1>Log in</h1>
            {reason && !error && <Alert type={reason.type}>{reasonText}</Alert>}
            <Alert type="error">{error}</Alert>
            <Field label="Email" id="email" error={fieldErrors.email}>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </Field>
            <Field label="Password" id="password" error={fieldErrors.password}>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <div className="auth-actions">
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Logging in…' : 'Log in'}
              </button>
              <p className="hint">Forgot your password? Ask your administrator.</p>
            </div>
          </form>
        </main>
        <aside className="auth-side" aria-label="About Perinexa">
          {photo && <img className="auth-photo" src={photo} alt="" />}
          <img className="auth-logo" src={photo ? logoReversed : logo} alt="Perinexa by Docvritta" width="200" height="49" />
          <div className="auth-side-text">
            <h2>One clear plan for every pregnancy.</h2>
            <p>Decision support for obstetric teams: registration from the LMP with EDD and gestation, care-plan templates and risk flags. The consultant decides.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
