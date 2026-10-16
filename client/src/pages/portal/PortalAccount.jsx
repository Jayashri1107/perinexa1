import { useState } from 'react';
import { KeyRound, LogIn, Mail, Smartphone, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PasswordInput } from '../../components/PasswordInput.jsx';
import { Alert, Field } from '../../components/ui.jsx';
import { accountWords } from './portalAccountWords.js';
import { portal } from './portalApi.js';
import { portalError, portalWords } from './portalWords.js';

// A patient's own account on the hospital's portal (owner, 16 Oct 2026 – docs/PATIENT_ACCOUNTS_PLAN.md): Sign in with
// mobile number + OTP or email + password, or Sign up (name, age, mobile; email and password optional) – the registration then
// waits for reception to approve it. Shown on the sign-in page (Patient) and on the hospital's portal address.
// Patients with a paper code sign in on /portal as before.

/** A refusal in her language; a pending or rejected registration is a notice, not an error. */
function Refusal({ error, lang }) {
  if (!error) return null;
  const notice = ['ACCOUNT_PENDING', 'ACCOUNT_REJECTED'].includes(error.code);
  return <Alert type={notice ? 'warning' : 'error'}>{portalError(error, lang, { account: true })}</Alert>;
}

function useStep() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

function OtpSignIn({ hospitalKey, otpMode, lang, onSignedIn }) {
  const w = accountWords(lang);
  const [mobile, setMobile] = useState('');
  const [sent, setSent] = useState(null); // { sentTo, practiceOtp? }
  const [otp, setOtp] = useState('');
  const step = useStep();
  if (otpMode === 'off') return <Alert type="info">{w.otpOff}</Alert>;
  if (!sent) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          step.run(async () => {
            setSent(await portal(`/h/${hospitalKey}/otp`, { method: 'POST', body: { mobile } }));
            setOtp('');
          });
        }}
        noValidate
      >
        <Refusal error={step.error} lang={lang} />
        <Field label={w.mobile} id="portal-mobile" hint={w.mobileHint}>
          <input id="portal-mobile" type="tel" inputMode="numeric" autoComplete="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} maxLength={20} />
        </Field>
        <button type="submit" className="btn btn-primary" disabled={step.busy || mobile.replace(/\D/g, '').length < 10}>
          {step.busy ? w.sendingOtp : w.sendOtp}
        </button>
      </form>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        step.run(async () => {
          await portal(`/h/${hospitalKey}/otp/verify`, { method: 'POST', body: { mobile, otp } });
          onSignedIn();
        });
      }}
      noValidate
    >
      <p>{w.otpSentTo(sent.sentTo)}</p>
      {sent.practiceOtp && <Alert type="info">{w.practiceOtp(sent.practiceOtp)}</Alert>}
      <Refusal error={step.error} lang={lang} />
      <Field label={w.otp} id="portal-otp">
        <input id="portal-otp" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus />
      </Field>
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={step.busy || otp.length !== 6}>
          {step.busy ? w.signingIn : w.signIn}
        </button>
        <button type="button" className="btn btn-link" onClick={() => setSent(null)}>
          {w.startAgain}
        </button>
      </div>
    </form>
  );
}

function PasswordSignIn({ hospitalKey, lang, onSignedIn }) {
  const w = accountWords(lang);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const step = useStep();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        step.run(async () => {
          try {
            await portal(`/h/${hospitalKey}/login`, { method: 'POST', body: { email, password } });
            onSignedIn();
          } finally {
            setPassword('');
          }
        });
      }}
      noValidate
    >
      <Refusal error={step.error} lang={lang} />
      <Field label={w.email} id="portal-email">
        <input id="portal-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
      </Field>
      <Field label={w.password} id="portal-password">
        <PasswordInput id="portal-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <button type="submit" className="btn btn-primary" disabled={step.busy || !email.trim() || !password}>
        {step.busy ? w.signingIn : w.signIn}
      </button>
      <p className="hint">{w.forgotPassword}</p>
    </form>
  );
}

function SignUp({ hospitalKey, hospital, lang }) {
  const w = accountWords(lang);
  const [form, setForm] = useState({ fullName: '', ageYears: '', mobile: '', email: '', password: '' });
  const [agreed, setAgreed] = useState(false);
  const [done, setDone] = useState(false);
  const step = useStep();
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const fields = step.error?.fields ?? {};
  if (done) return <Alert type="success">{w.signedUp(hospital.name)}</Alert>;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        step.run(async () => {
          const email = form.email.trim();
          await portal(`/h/${hospitalKey}/signup`, { method: 'POST', body: { ...form, email, password: email ? form.password : undefined, consent: agreed } });
          setDone(true);
        });
      }}
      noValidate
    >
      <Refusal error={step.error} lang={lang} />
      <Field label={w.fullName} id="signup-name" error={fields.fullName}>
        <input id="signup-name" autoComplete="name" value={form.fullName} onChange={set('fullName')} maxLength={150} />
      </Field>
      <Field label={w.age} id="signup-age" error={fields.ageYears}>
        <input id="signup-age" inputMode="numeric" value={form.ageYears} onChange={set('ageYears')} maxLength={3} />
      </Field>
      <Field label={w.mobile} id="signup-mobile" error={fields.mobile}>
        <input id="signup-mobile" type="tel" inputMode="numeric" autoComplete="tel" value={form.mobile} onChange={set('mobile')} maxLength={20} />
      </Field>
      <Field label={w.emailOptional} id="signup-email" error={fields.email} hint={w.emailOptionalHint} keepHint>
        <input id="signup-email" type="email" autoComplete="email" value={form.email} onChange={set('email')} maxLength={254} />
      </Field>
      {/* A password only with an email: without one she signs in with her mobile number and an OTP */}
      {form.email.trim() && (
        <Field label={w.password} id="signup-password" error={fields.password} hint={w.passwordHint} keepHint>
          <PasswordInput id="signup-password" autoComplete="new-password" value={form.password} onChange={set('password')} />
        </Field>
      )}
      <label className="check">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> {w.agree(hospital.name)}
      </label>
      <button type="submit" className="btn btn-primary" disabled={step.busy || !agreed}>
        <UserPlus aria-hidden="true" /> {step.busy ? w.signingUp : w.signUp}
      </button>
    </form>
  );
}

/**
 * Sign in or sign up on one hospital's portal (exported for the tests and the sign-in page). bare: inside another card
 * (the Patient side of the sign-in page) – no card and no title of its own. otpMode: 'sms' | 'practice' | 'off'.
 */
export function HospitalEntry({ hospitalKey, hospital, otpMode = 'practice', lang, onSignedIn, initialTab = 'signin', bare = false }) {
  const w = accountWords(lang);
  const pw = portalWords(lang);
  const [tab, setTab] = useState(initialTab);
  const [how, setHow] = useState(otpMode === 'off' ? 'password' : 'otp');
  const Wrap = bare ? 'div' : 'section';
  return (
    <Wrap className={bare ? 'portal-entry' : 'card portal-card portal-entry'}>
      {!bare && <h1>{w.hospitalTitle(hospital.name)}</h1>}
      <div className="segmented" role="group" aria-label={w.hospitalTitle(hospital.name)}>
        <button type="button" aria-pressed={tab === 'signin'} onClick={() => setTab('signin')}>
          <LogIn aria-hidden="true" /> {w.signInTab}
        </button>
        <button type="button" aria-pressed={tab === 'signup'} onClick={() => setTab('signup')}>
          <UserPlus aria-hidden="true" /> {w.signUpTab}
        </button>
      </div>
      {tab === 'signin' ? (
        <>
          <div className="segmented portal-how" role="group" aria-label={w.signInTab}>
            <button type="button" aria-pressed={how === 'otp'} onClick={() => setHow('otp')}>
              <Smartphone aria-hidden="true" /> {w.withOtp}
            </button>
            <button type="button" aria-pressed={how === 'password'} onClick={() => setHow('password')}>
              <Mail aria-hidden="true" /> {w.withPassword}
            </button>
          </div>
          {how === 'otp' ? (
            <OtpSignIn key="otp" hospitalKey={hospitalKey} otpMode={otpMode} lang={lang} onSignedIn={onSignedIn} />
          ) : (
            <PasswordSignIn key="password" hospitalKey={hospitalKey} lang={lang} onSignedIn={onSignedIn} />
          )}
          <p>
            <Link to="/portal">
              <KeyRound aria-hidden="true" /> {w.withCode}
            </Link>
          </p>
        </>
      ) : (
        <SignUp key="signup" hospitalKey={hospitalKey} hospital={hospital} lang={lang} />
      )}
      <p className="hint">{pw.sharedDevice}</p>
    </Wrap>
  );
}

/** Her new password, on her page once signed in with her own account (also the way back after a forgotten one). */
export function ChangePassword({ lang, onClose }) {
  const w = accountWords(lang);
  const [password, setPassword] = useState('');
  const [saved, setSaved] = useState(false);
  const step = useStep();
  if (saved) return <Alert type="success" onClose={onClose}>{w.passwordSaved}</Alert>;
  return (
    <form
      className="portal-password"
      onSubmit={(e) => {
        e.preventDefault();
        step.run(async () => {
          await portal('/account/password', { method: 'POST', body: { password } });
          setSaved(true);
        });
      }}
      noValidate
    >
      <Refusal error={step.error} lang={lang} />
      <Field label={w.newPassword} id="portal-new-password" error={step.error?.fields?.password} hint={w.passwordHint} keepHint>
        <PasswordInput id="portal-new-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <div className="row">
        <button type="submit" className="btn btn-secondary" disabled={step.busy || password.length < 8}>
          {step.busy ? w.saving : w.savePassword}
        </button>
      </div>
    </form>
  );
}
