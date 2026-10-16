import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, CalendarDays, CalendarPlus, House, LogOut, Phone } from 'lucide-react';
import { useParams } from 'react-router-dom';
import logo from '../../assets/brand/perinexa-logo.png';
import { Alert, Field, formatDate } from '../../components/ui.jsx';
import { timeLabel } from '../appointments/appointmentFormat.js';
import { ChangePassword, HospitalEntry } from './PortalAccount.jsx';
import { PortalShell } from './PortalShell.jsx';
import { RECORD_TABS, RecordsTab, recordIcon } from './PortalRecords.jsx';
import { accountWords } from './portalAccountWords.js';
import { portal } from './portalApi.js';
import {
  PORTAL_LANGUAGES,
  PORTAL_LANGUAGE_NAMES,
  isTypedText,
  portalError,
  portalItemText,
  portalLanguage,
  portalWords,
  rememberPortalLanguage,
  rememberedPortalLanguage,
} from './portalWords.js';

// The patient portal (Version 2): the patient signs in with the code the hospital gave her and the last 4 digits
// of her mobile number, and sees her next appointment and what is due in her care plan, in plain words, with the
// hospital's phone. Nothing else from her record. Signs out after 15 minutes without use. Its own small requests
// (never the staff helper: a portal "please sign in again" must not touch a staff session in the same browser).
// In English, Marathi or Hindi (5 Oct 2026): the switch at the top; the choice is remembered on this phone or
// computer (only the language). Without a choice she sees it in the language recorded for her messages once she is
// signed in, and the page stays in that language after she signs out or is timed out (the notice about it included).
// The Marathi and Hindi wording is a DRAFT (portalWords.js); an item a doctor added or reworded is shown as typed.
// Since 16 Oct 2026 (docs/PATIENT_ACCOUNTS_PLAN.md): her own account – sign up, then sign in with mobile + OTP or
// email + password once reception approved it (PortalAccount.jsx; also on the sign-in page, Patient) – and once
// signed in, tabs for her prescriptions, lab reports, visits and bills (PortalRecords.jsx).

/** English, मराठी, हिंदी – at the top of every portal page. */
function LanguageSwitch({ lang, onChange }) {
  return (
    <div className="segmented portal-lang" role="group" aria-label={portalWords(lang).language}>
      {PORTAL_LANGUAGES.map((l) => (
        <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => onChange(l)}>
          {PORTAL_LANGUAGE_NAMES[l]}
        </button>
      ))}
    </div>
  );
}

/**
 * Booking her own appointment (only when the hospital switched it on): one appointment with her own doctor, from
 * tomorrow up to 30 days ahead. She chooses a day, then one of the free times; a booking she made here can be cancelled.
 */
export function Booking({ booking, onChanged, lang }) {
  const w = portalWords(lang);
  // The doctors she may choose (her own first); older servers sent only doctorName and leave
  const doctors = booking.doctors?.length ? booking.doctors : booking.doctorName ? [{ id: booking.doctorId ?? '', name: booking.doctorName, leave: booking.leave ?? [] }] : [];
  const [doctorId, setDoctorId] = useState(booking.doctorId ?? doctors[0]?.id ?? '');
  const doctor = doctors.find((d) => d.id === doctorId) ?? doctors[0];
  const [date, setDate] = useState('');
  const [times, setTimes] = useState(null);
  const [start, setStart] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const errorText = error ? portalError(error, lang, { booking: true }) : null;

  const [dayOnLeave, setDayOnLeave] = useState(false);
  const chooseDay = async (value, forDoctor = doctor?.id) => {
    setDate(value);
    setStart('');
    setTimes(null);
    setDayOnLeave(false);
    setError(null);
    if (!value) return;
    try {
      const res = await portal(`/booking/times?date=${value}${forDoctor ? `&doctorId=${forDoctor}` : ''}`);
      setTimes(res.times);
      setDayOnLeave(Boolean(res.onLeave));
    } catch (err) {
      setError(err);
    }
  };
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setDate('');
      setTimes(null);
      setStart('');
      setConfirming(false);
      onChanged();
    } catch (err) {
      setError(err);
      if (err.code === 'SLOT_TAKEN') chooseDay(date);
    } finally {
      setBusy(false);
    }
  };

  if (booking.upcoming) {
    if (!booking.upcoming.canCancel) return null; // booked by the hospital: the phone number below is the way to change it
    return (
      <div className="portal-booking">
        <Alert type="error">{errorText}</Alert>
        {confirming ? (
          <div className="row">
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => run(() => portal('/booking/cancel', { method: 'POST' }))}>
              {busy ? w.cancelling : w.yesCancel}
            </button>
            <button type="button" className="btn btn-link" onClick={() => setConfirming(false)}>
              {w.keepIt}
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirming(true)}>
            {w.cancelAppointment}
          </button>
        )}
      </div>
    );
  }
  if (!doctor) return <p className="hint">{w.callToBookOnline}</p>;
  const chooseDoctor = (id) => {
    setDoctorId(id);
    if (date) chooseDay(date, id); // the same day, that doctor's free times
  };
  return (
    <div className="portal-booking">
      <h3>
        <CalendarPlus aria-hidden="true" /> {w.bookWith(doctor.name)}
      </h3>
      <Alert type="error">{errorText}</Alert>
      {doctors.length > 1 && (
        <fieldset className="portal-times">
          <legend>{w.chooseDoctor}</legend>
          <div className="portal-time-grid portal-doctor-grid">
            {doctors.map((d) => (
              <button key={d.id} type="button" className="appt-slot-choice" aria-pressed={d.id === doctor.id} onClick={() => chooseDoctor(d.id)}>
                {d.name}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {doctor.leave?.length > 0 && <Alert type="warning">{w.doctorOnLeave(doctor.name, doctor.leave.map((l) => when(l.from, l.to)).join(', '))}</Alert>}
      <Field label={w.day} id="portal-book-day">
        <input id="portal-book-day" type="date" value={date} min={booking.from} max={booking.to} onChange={(e) => chooseDay(e.target.value)} />
      </Field>
      {date && times && times.length === 0 && <p>{dayOnLeave ? w.onLeaveDay(doctor.name) : w.noFreeTime}</p>}
      {date && times && times.length > 0 && (
        <fieldset className="portal-times">
          <legend>{w.time}</legend>
          <p className="hint">{w.onlyFree}</p>
          <div className="portal-time-grid">
            {times.map((t) => (
              <button key={t} type="button" className="appt-slot-choice" aria-pressed={start === t} onClick={() => setStart(t)}>
                {timeLabel(t)}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <button type="button" className="btn btn-primary" disabled={!date || !start || busy} onClick={() => run(() => portal('/booking', { method: 'POST', body: { date, start, ...(doctor.id ? { doctorId: doctor.id } : {}) } }))}>
        {busy ? w.booking : start ? w.bookAt(`${formatDate(date)}, ${timeLabel(start)}`) : w.book}
      </button>
    </div>
  );
}

const when = (from, by) => (by && formatDate(by) !== formatDate(from) ? `${formatDate(from)} – ${formatDate(by)}` : formatDate(from));

/** A care-plan item's words: in her language when it is a built-in item nobody reworded, else as typed (in English). */
function ItemText({ item, lang }) {
  return <span lang={isTypedText(item, lang) ? 'en' : undefined}>{portalItemText(item, lang)}</span>;
}

function SignIn({ onDone, lang }) {
  const w = portalWords(lang);
  const [code, setCode] = useState('');
  const [digits, setDigits] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await portal('/login', { method: 'POST', body: { code, digits } });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card portal-card" onSubmit={submit} noValidate>
      <h1>{w.signInTitle}</h1>
      <p>{w.signInIntro}</p>
      <Alert type="error">{error ? portalError(error, lang) : null}</Alert>
      <Field label={w.code} id="portal-code" hint={w.codeHint} keepHint>
        <input id="portal-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" maxLength={20} autoFocus />
      </Field>
      <Field label={w.digits} id="portal-digits">
        <input id="portal-digits" value={digits} onChange={(e) => setDigits(e.target.value)} inputMode="numeric" autoComplete="off" maxLength={4} />
      </Field>
      <button type="submit" className="btn btn-primary" disabled={busy || !code.trim() || digits.trim().length !== 4}>
        {busy ? w.signingIn : w.signIn}
      </button>
      <p className="hint">{w.sharedDevice}</p>
    </form>
  );
}

/**
 * What she sees once signed in (exported for the tests), in the app's own frame (PortalShell.jsx): Home (her next
 * appointment, her care plan, the hospital's phone), Appointments (booking, when the hospital allows it), her records,
 * and Change password for an account with an email.
 */
export function MyCare({ data, booking, onChanged, onSignOut, onLanguage = null, lang = 'en' }) {
  const [section, setSection] = useState('home');
  return (
    <PortalShell
      patientName={data.patient.fullName}
      hospitalName={data.hospital.name}
      section={section}
      onSection={setSection}
      canChangePassword={Boolean(data.canChangePassword)}
      lang={lang}
      onLanguage={onLanguage}
      onSignOut={onSignOut}
    >
      <div className="portal-stack">
        {section === 'home' && (
          <>
            <HomeCards data={data} booking={booking} onChanged={onChanged} lang={lang} withBooking={false} onBook={() => setSection('appointments')} />
            <CallCard hospital={data.hospital} lang={lang} />
          </>
        )}
        {section === 'appointments' && (
          <>
            <HomeCards data={data} booking={booking} onChanged={onChanged} lang={lang} withPlan={false} />
            <CallCard hospital={data.hospital} lang={lang} />
          </>
        )}
        {RECORD_TABS.includes(section) && <RecordsTab key={section} tab={section} lang={lang} />}
        {section === 'password' && (
          <section className="card portal-card">
            <ChangePassword lang={lang} onClose={() => setSection('home')} />
          </section>
        )}
      </div>
    </PortalShell>
  );
}

/** "Questions, or need to change the date? Call …" */
function CallCard({ hospital, lang }) {
  const w = portalWords(lang);
  return (
    <section className="card portal-card">
      <h2>
        <Phone aria-hidden="true" /> {w.questions}
      </h2>
      <p>
        {w.call(hospital.name)}
        {hospital.phone ? (
          <>
            {w.callJoin}
            {/* the number on one line: in Marathi or Hindi the longer sentence broke it after "+91" on a phone */}
            <a className="nowrap" href={`tel:${hospital.phone.replace(/[^\d+]/g, '')}`}>
              {hospital.phone}
            </a>
          </>
        ) : null}
        {w.stop} {w.emergency}
      </p>
    </section>
  );
}

/** Home: her next appointment (and booking) and what is coming up in her care plan. */
function HomeCards({ data, booking, onChanged, lang, withBooking = true, withPlan = true, onBook = null }) {
  const w = portalWords(lang);
  const aw = accountWords(lang);
  const { appointment, plan } = data;
  return (
    <>
      <section className="card portal-card" aria-labelledby="portal-appt">
        <h2 id="portal-appt">
          <CalendarCheck aria-hidden="true" /> {w.nextAppointment}
        </h2>
        {appointment ? (
          <p className="portal-big">
            {formatDate(appointment)}
            {data.appointmentTime ? `, ${timeLabel(data.appointmentTime)}` : ''}
          </p>
        ) : (
          <p>
            {w.noAppointment}
            {booking?.enabled ? '' : ` ${w.callToBook}`}
          </p>
        )}
        {booking?.enabled && withBooking && <Booking booking={booking} onChanged={onChanged} lang={lang} />}
        {booking?.enabled && !withBooking && onBook && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onBook}>
            <CalendarDays aria-hidden="true" /> {aw.tabs.appointments}
          </button>
        )}
      </section>
      {plan && withPlan && (
        <section className="card portal-card" aria-labelledby="portal-plan">
          <h2 id="portal-plan">
            <CalendarDays aria-hidden="true" /> {w.comingUp}
          </h2>
          {plan.nextVisit && (
            <p>
              <strong>{w.checkUp}:</strong> <ItemText item={plan.nextVisit} lang={lang} /> – {when(plan.nextVisit.from, plan.nextVisit.by)}
            </p>
          )}
          {plan.items.length ? (
            <ul className="portal-list">
              {plan.items.map((it, i) => (
                <li key={`${it.text}-${i}`}>
                  <strong>{w.kinds[it.kind] ?? w.item}:</strong> <ItemText item={it} lang={lang} /> – {when(it.from, it.by)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{w.nothingElse}</p>
          )}
          <p className="hint">{w.doctorDecides}</p>
        </section>
      )}
    </>
  );
}

/**
 * The page's state once /me has answered, and after she leaves (pure, for the tests). `recorded` is the language
 * recorded for her messages as /me last gave it. It stays when she signs out, is timed out or her session ends, so the
 * notice about that and the sign-in page stay in the language she was reading – until the page is closed or someone
 * else signs in on it. Kept in memory only (never on the phone).
 */
export const signedInState = (data, booking) => ({ step: 'in', data, booking, recorded: data?.language ?? null });
export const signInState = (before, error = null) => ({ step: 'signin', recorded: before?.recorded ?? null, ...(error ? { error } : {}) });

/**
 * The portal as it looks for one state (exported for the tests); its language: chosen on this phone, else recorded.
 * hospital: on the hospital's own address, { key, data, error } – her own account's sign-in and sign-up instead of the code.
 */
export function PortalScreen({ state, notice, chosen, onChoose, onDismiss, onSignedIn, onChanged, onSignOut, hospital = null }) {
  const lang = portalLanguage(chosen, state.recorded);
  const w = portalWords(lang);
  useEffect(() => {
    const before = document.title;
    document.title = w.pageTitle;
    return () => {
      document.title = before;
    };
  }, [w.pageTitle]);
  if (state.step === 'in') {
    return (
      <>
        {notice && (
          <Alert type="info" onClose={onDismiss} closeLabel={w.dismiss}>
            {w[notice]}
          </Alert>
        )}
        <MyCare data={state.data} booking={state.booking} onChanged={onChanged} onSignOut={onSignOut} onLanguage={onChoose} lang={lang} />
      </>
    );
  }
  return (
    <main className="portal-page" lang={lang}>
      <div className="portal-top">
        <img src={logo} alt="Perinexa" className="portal-logo" />
        <LanguageSwitch lang={lang} onChange={onChoose} />
      </div>
      {w.draftNote && <p className="hint portal-draft">{w.draftNote}</p>}
      <Alert type="info" onClose={onDismiss} closeLabel={w.dismiss}>
        {notice ? w[notice] : null}
      </Alert>
      <Alert type="error">{state.error ? portalError(state.error, lang) : null}</Alert>
      {state.step === 'loading' && <p className="muted">{w.loading}</p>}
      {state.step === 'signin' && !hospital && <SignIn lang={lang} onDone={onSignedIn} />}
      {state.step === 'signin' && hospital?.error && <Alert type="error">{portalError(hospital.error, lang, { account: true })}</Alert>}
      {state.step === 'signin' && hospital?.data && <HospitalEntry hospitalKey={hospital.key} hospital={hospital.data.hospital} otpMode={hospital.data.otp} lang={lang} onSignedIn={onSignedIn} />}
    </main>
  );
}

export function PortalPage() {
  const { key: hospitalKey } = useParams(); // the hospital's own address (/portal/h/<code>), else undefined
  const [hospital, setHospital] = useState(null); // { key, data, error }
  useEffect(() => {
    if (!hospitalKey) return undefined;
    let current = true;
    portal(`/h/${encodeURIComponent(hospitalKey)}`)
      .then((data) => current && setHospital({ key: hospitalKey, data, error: null }))
      .catch((error) => current && setHospital({ key: hospitalKey, data: null, error }));
    return () => {
      current = false;
    };
  }, [hospitalKey]);
  const [state, setState] = useState({ step: 'loading', recorded: null }); // loading | signin | in
  const [notice, setNotice] = useState(null); // 'timedOut' | 'signedOut'
  const [chosen, setChosen] = useState(rememberedPortalLanguage); // the language chosen on this phone or computer
  const choose = (l) => {
    setChosen(l);
    rememberPortalLanguage(l);
  };
  const load = useCallback(async () => {
    try {
      const data = await portal('/me');
      const booking = await portal('/booking').catch(() => null);
      setState(signedInState(data, booking));
    } catch (err) {
      setState((before) => signInState(before, err.status === 401 ? null : err));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  // 15 minutes without use: sign out (the server ends the session too)
  useEffect(() => {
    if (state.step !== 'in') return undefined;
    const t = setTimeout(() => {
      portal('/logout', { method: 'POST' }).catch(() => {});
      setNotice('timedOut');
      setState(signInState);
    }, (state.data.sessionMinutes ?? 15) * 60 * 1000);
    return () => clearTimeout(t);
  }, [state]);
  const signOut = async () => {
    await portal('/logout', { method: 'POST' }).catch(() => {});
    setNotice('signedOut');
    setState(signInState);
  };
  return (
    <PortalScreen
      state={state}
      notice={notice}
      chosen={chosen}
      onChoose={choose}
      onDismiss={() => setNotice(null)}
      onSignedIn={() => {
        setNotice(null);
        load();
      }}
      onChanged={load}
      onSignOut={signOut}
      hospital={hospitalKey ? (hospital ?? { key: hospitalKey, data: null, error: null }) : null}
    />
  );
}
