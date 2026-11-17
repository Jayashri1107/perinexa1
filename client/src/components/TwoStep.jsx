import { useState } from 'react';
import { Copy, ShieldCheck, ShieldOff } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { PasswordInput } from './PasswordInput.jsx';
import { QrCode } from './print/QrCode.jsx';
import { Alert, Field, StatusPill } from './ui.jsx';

// Two-step sign-in with an authenticator app (health check H4; owner's decision of 17 Nov 2026). Used on the sign-in
// page (an admin's first sign-in sets it up) and on My profile (anyone may turn it on; admins cannot turn it off).

/** How to add Perinexa to the authenticator app: the QR code, and the key to type when the camera can't be used. */
export function TwoStepSetup({ secret, uri }) {
  const grouped = String(secret).replace(/(.{4})/g, '$1 ').trim();
  return (
    <>
      <ol className="twostep-steps">
        <li>Install Google Authenticator or Microsoft Authenticator on your phone.</li>
        <li>In the app, add an account and scan this QR code.</li>
        <li>Type the 6-digit code the app shows.</li>
      </ol>
      <div className="twostep-qr">
        <QrCode value={uri} sizeMm={42} label="QR code for your authenticator app" />
      </div>
      <p className="hint">
        Can't scan? In the app choose to enter a setup key and type: <span className="twostep-key">{grouped}</span>
      </p>
    </>
  );
}

/** The recovery codes, shown once: each signs in once when the phone is lost. */
export function RecoveryCodes({ codes, onDone, doneLabel = 'Continue' }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div>
      <header className="auth1-head">
        <h2>Your recovery codes</h2>
        <p className="muted">If you lose your phone, each code signs you in once instead of the app. They are shown only now. Write them down or print them, and keep them away from your computer.</p>
      </header>
      <ul className="twostep-codes" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="row">
        <button type="button" className="btn btn-secondary" onClick={copy}>
          <Copy aria-hidden="true" /> {copied ? 'Copied' : 'Copy the codes'}
        </button>
      </div>
      <label className="check" htmlFor="twostep-saved">
        <input id="twostep-saved" type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I have kept these codes somewhere safe
      </label>
      <button type="button" className="btn btn-primary btn-block auth1-submit" disabled={!saved} onClick={onDone}>
        {doneLabel}
      </button>
    </div>
  );
}

/** My profile → Two-step sign-in: on or off, turning it on, turning it off (when the role allows). */
export function TwoStepSection() {
  const { user, setUser, twoStepRequired } = useAuth();
  const on = Boolean(user?.twoStep?.enabled);
  const [stage, setStage] = useState(null); // null | 'password' | { secret, uri } | { codes } | 'off'
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const reset = () => {
    setStage(null);
    setPassword('');
    setCode('');
    setError(null);
    setFields({});
  };
  const run = async (fn) => {
    setError(null);
    setFields({});
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  };
  const start = () =>
    run(async () => {
      const r = await api('/auth/me/two-step/setup', { method: 'POST', body: { password } });
      setPassword('');
      setStage({ secret: r.secret, uri: r.uri });
    });
  const confirm = () =>
    run(async () => {
      const r = await api('/auth/me/two-step/confirm', { method: 'POST', body: { code } });
      setCode('');
      setUser(r.user);
      setStage({ codes: r.recoveryCodes });
    });
  const turnOff = () =>
    run(async () => {
      const r = await api('/auth/me/two-step/off', { method: 'POST', body: { password, code } });
      setUser(r.user);
      reset();
    });

  return (
    <section className="card" aria-labelledby="twostep-title">
      <h2 id="twostep-title">Two-step sign-in</h2>
      <p>
        {on ? (
          <StatusPill tone="stable" icon={ShieldCheck}>
            On
          </StatusPill>
        ) : (
          <StatusPill tone="inactive" icon={ShieldOff}>
            Off
          </StatusPill>
        )}
      </p>
      <p className="hint">
        After your password, Perinexa asks for a code from an authenticator app on your phone, so a stolen password alone cannot open your account.
        {twoStepRequired ? ' It is required for your role.' : ''}
      </p>
      <Alert type="error">{error}</Alert>

      {!on && stage === null && (
        <button type="button" className="btn btn-secondary" onClick={() => setStage('password')}>
          Turn on two-step sign-in
        </button>
      )}
      {stage === 'password' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
          noValidate
        >
          <Field label="Your password" id="twostep-password" error={fields.password}>
            <PasswordInput id="twostep-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          </Field>
          <div className="row">
            <button type="submit" className="btn btn-secondary" disabled={busy || !password}>
              Continue
            </button>
            <button type="button" className="btn btn-link" onClick={reset}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {stage?.secret && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            confirm();
          }}
          noValidate
        >
          <TwoStepSetup secret={stage.secret} uri={stage.uri} />
          <Field label="Code from the app" id="twostep-confirm" error={fields.code}>
            <input id="twostep-confirm" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} required autoFocus />
          </Field>
          <div className="row">
            <button type="submit" className="btn btn-secondary" disabled={busy || !code.trim()}>
              Turn on
            </button>
            <button type="button" className="btn btn-link" onClick={reset}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {stage?.codes && <RecoveryCodes codes={stage.codes} onDone={reset} doneLabel="Done" />}

      {on && !twoStepRequired && stage === null && (
        <button type="button" className="btn btn-link" onClick={() => setStage('off')}>
          Turn off two-step sign-in
        </button>
      )}
      {stage === 'off' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            turnOff();
          }}
          noValidate
        >
          <Field label="Your password" id="twostep-off-password" error={fields.password}>
            <PasswordInput id="twostep-off-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          </Field>
          <Field label="Code from the app, or a recovery code" id="twostep-off-code" error={fields.code}>
            <input id="twostep-off-code" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} required />
          </Field>
          <div className="row">
            <button type="submit" className="btn btn-danger" disabled={busy || !password || !code.trim()}>
              Turn off
            </button>
            <button type="button" className="btn btn-link" onClick={reset}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
