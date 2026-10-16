import { useState } from 'react';
import { KeyRound, LogIn, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, Field } from '../../components/ui.jsx';
import { accountWords } from './portalAccountWords.js';
import { portal } from './portalApi.js';
import { portalError, portalWords } from './portalWords.js';

// The hospital's own portal page (/portal/h/<code>, docs/PATIENT_SIGNUP_PLAN.md): sign in with ABHA, or sign up with
// ABHA – both with an OTP from ABDM to her mobile. Sign-up only puts her in reception's list; she can sign in once
// the hospital has confirmed her. No Aadhaar card or number is asked for. Patients with a paper code sign in on
// /portal as before.

const HINTS = ['abha-number', 'abha-address', 'mobile'];

/** Her ABHA as she knows it, then the OTP. Calls onVerified(answer of the verify step) once ABDM accepted the OTP. */
function OtpSteps({ hospitalKey, purpose, lang, onVerified, children }) {
  const w = accountWords(lang);
  const [hint, setHint] = useState('abha-number');
  const [value, setValue] = useState('');
  const [sent, setSent] = useState(null); // { id, sentTo, practiceOtp? }
  const [otp, setOtp] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
      if (err.code === 'EXPIRED') setSent(null);
    } finally {
      setBusy(false);
    }
  };
  const send = (e) => {
    e.preventDefault();
    run(async () => {
      setSent(await portal(`/h/${hospitalKey}/otp`, { method: 'POST', body: { purpose, hint, value } }));
      setOtp('');
    });
  };
  const verify = (e) => {
    e.preventDefault();
    run(async () => onVerified(await portal(`/h/${hospitalKey}/${purpose}/verify`, { method: 'POST', body: { id: sent.id, otp } })));
  };
  const labels = { 'abha-number': w.abhaNumber, 'abha-address': w.abhaAddress, mobile: w.mobile };
  const hints = { 'abha-number': w.abhaNumberHint, 'abha-address': w.abhaAddressHint, mobile: w.mobileHint };
  const errorText = error ? portalError(error, lang, { account: true }) : null;

  if (!sent) {
    return (
      <form onSubmit={send} noValidate>
        {children}
        <Alert type="error">{errorText}</Alert>
        <div className="segmented portal-abha-kind" role="group" aria-label={w.abhaNumber}>
          {HINTS.map((h) => (
            <button
              key={h}
              type="button"
              aria-pressed={hint === h}
              onClick={() => {
                setHint(h);
                setValue('');
              }}
            >
              {labels[h]}
            </button>
          ))}
        </div>
        <Field label={labels[hint]} id={`portal-${purpose}-value`} hint={hints[hint]} keepHint>
          <input
            id={`portal-${purpose}-value`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode={hint === 'abha-address' ? 'email' : 'numeric'}
            autoComplete="off"
            autoCapitalize="none"
            maxLength={60}
          />
        </Field>
        <button type="submit" className="btn btn-primary" disabled={busy || value.trim().length < 3}>
          {busy ? w.sendingOtp : w.sendOtp}
        </button>
      </form>
    );
  }
  return (
    <form onSubmit={verify} noValidate>
      <p>{w.otpSentTo(sent.sentTo)}</p>
      {sent.practiceOtp && <Alert type="info">{w.practiceOtp(sent.practiceOtp)}</Alert>}
      <Alert type="error">{errorText}</Alert>
      <Field label={w.otp} id={`portal-${purpose}-otp`}>
        <input id={`portal-${purpose}-otp`} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus />
      </Field>
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={busy || otp.length !== 6}>
          {busy ? w.checking : w.next}
        </button>
        <button type="button" className="btn btn-link" onClick={() => setSent(null)}>
          {w.startAgain}
        </button>
      </div>
    </form>
  );
}

function AbhaSignIn({ hospitalKey, lang, onSignedIn }) {
  const w = accountWords(lang);
  const [choose, setChoose] = useState(null); // { id, choose: [{ id, name }] }
  const [error, setError] = useState(null);
  const verified = (out) => {
    if (out.choose) setChoose(out);
    else onSignedIn();
  };
  const pick = async (patientId) => {
    setError(null);
    try {
      await portal(`/h/${hospitalKey}/signin`, { method: 'POST', body: { id: choose.id, patientId } });
      onSignedIn();
    } catch (err) {
      setError(err);
      setChoose(null);
    }
  };
  if (choose) {
    return (
      <fieldset className="portal-choose">
        <legend>{w.chooseName}</legend>
        {choose.choose.map((p) => (
          <button key={p.id} type="button" className="btn btn-secondary" onClick={() => pick(p.id)}>
            <LogIn aria-hidden="true" /> {p.name}
          </button>
        ))}
      </fieldset>
    );
  }
  return (
    <>
      <Alert type="error">{error ? portalError(error, lang, { account: true }) : null}</Alert>
      <OtpSteps hospitalKey={hospitalKey} purpose="signin" lang={lang} onVerified={verified}>
        <p>{w.abhaIntro}</p>
      </OtpSteps>
    </>
  );
}

function AbhaSignUp({ hospitalKey, hospital, lang }) {
  const w = accountWords(lang);
  const [step, setStep] = useState(null); // { id, accounts }
  const [abha, setAbha] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [done, setDone] = useState(null); // { signupDays }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (done) return <Alert type="success">{w.signedUp(done.signupDays)}</Alert>;
  if (!step) {
    return (
      <OtpSteps
        hospitalKey={hospitalKey}
        purpose="signup"
        lang={lang}
        onVerified={(out) => {
          setStep(out);
          setAbha(out.accounts.length === 1 ? out.accounts[0].abhaNumber : '');
        }}
      >
        <p>{w.signupIntro}</p>
        <p className="hint">{w.noAadhaar}</p>
      </OtpSteps>
    );
  }
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setDone(await portal(`/h/${hospitalKey}/signup`, { method: 'POST', body: { id: step.id, abhaNumber: abha, consent: agreed } }));
    } catch (err) {
      setError(err);
      if (err.code === 'EXPIRED') setStep(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} noValidate>
      <Alert type="error">{error ? portalError(error, lang, { account: true }) : null}</Alert>
      <fieldset className="portal-choose">
        <legend>{w.chooseAbha}</legend>
        {step.accounts.map((a) => (
          <label key={a.abhaNumber} className="check">
            <input type="radio" name="portal-abha" checked={abha === a.abhaNumber} onChange={() => setAbha(a.abhaNumber)} />{' '}
            <span>
              <strong>{a.name}</strong>
              <span className="muted">
                {' '}
                · {a.abhaNumber}
                {a.yearOfBirth ? ` · ${w.bornIn(a.yearOfBirth)}` : ''}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> {w.agree(hospital.name)}
      </label>
      <button type="submit" className="btn btn-primary" disabled={busy || !abha || !agreed}>
        <UserPlus aria-hidden="true" /> {busy ? w.signingUp : w.signUp}
      </button>
    </form>
  );
}

/** The hospital's page before she is signed in: sign in with ABHA, or sign up (exported for the tests). */
export function HospitalEntry({ hospitalKey, hospital, lang, onSignedIn, initialTab = 'signin' }) {
  const w = accountWords(lang);
  const pw = portalWords(lang);
  const [tab, setTab] = useState(initialTab);
  return (
    <section className="card portal-card">
      <h1>{w.hospitalTitle(hospital.name)}</h1>
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
          <AbhaSignIn key="signin" hospitalKey={hospitalKey} lang={lang} onSignedIn={onSignedIn} />
          <p>
            <Link to="/portal">
              <KeyRound aria-hidden="true" /> {w.withCode}
            </Link>
          </p>
        </>
      ) : (
        <AbhaSignUp key="signup" hospitalKey={hospitalKey} hospital={hospital} lang={lang} />
      )}
      <p className="hint">{pw.sharedDevice}</p>
    </section>
  );
}
