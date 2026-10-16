import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, formatDate } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useFetch } from '../../hooks/useFetch.js';
import { moduleByKey } from '../../platform/modules.js';

// Hospital admin → Patient messages (Version 2): switch automatic reminders and the patient portal on or off; since
// 4 Oct 2026 also online booking by patients (in the portal) and the waiting-room screen with its secret address.
// The message provider's keys are in server/.env (never here); this page only says whether one is set up.
// The reminders switch also covers the two general messages added on 4 Oct 2026 ("a check-up or test is due", "we
// missed you"): the page says exactly what switching it on sends, that agreements from before that day were asked
// for appointment reminders only, and that a death recorded on a record (by her doctor) stops every message to it.
// Since 16 Oct 2026: patients may sign up for their own account (docs/PATIENT_ACCOUNTS_PLAN.md) – reception approves
// each one – and the hospital's portal address with a poster to print.

/** The poster for the waiting room: the hospital's portal address in large print, and what a patient can do there. */
function SignupPoster({ url, hospital, onClose }) {
  return (
    <PrintPreview title="Poster – print preview" hint="Put it up where patients wait. The address works until sign-up is switched off." onClose={onClose}>
      <PrintDocument footer={<span>{hospital} · printed {formatDate(new Date())}</span>}>
        <div className="signup-poster">
          <h1>{hospital}</h1>
          <p className="signup-poster-lead">Your care online</p>
          <p className="signup-poster-url">{url}</p>
          <ol>
            <li>Open this address on your phone.</li>
            <li>Sign up with your name, age, mobile number, email and a password.</li>
            <li>The hospital checks who you are and approves your registration. Then sign in with your mobile number and an OTP, or your email and password, to see your appointments, prescriptions, lab reports, visits and bills, and to book an appointment.</li>
          </ol>
          <p>You can also sign in from the Perinexa sign-in page: choose Patient.</p>
        </div>
      </PrintDocument>
    </PrintPreview>
  );
}

export function PatientMessagesSettingsPage() {
  const { data, error } = useFetch('/reminders/settings');
  const { activeMembership } = useAuth();
  const [poster, setPoster] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [displayKey, setDisplayKey] = useState(null);
  useEffect(() => {
    if (data && !form) {
      setForm(data.settings);
      setDisplayKey(data.displayKey ?? null);
    }
  }, [data, form]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const { signupKey: _address, ...settings } = form; // the address is made by the server, never sent
      const res = await api('/reminders/settings', { method: 'PUT', body: settings });
      setForm(res.settings);
      setDisplayKey(res.displayKey ?? null);
      setNotice('Saved.');
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };
  const newLink = async () => {
    setSaveError(null);
    try {
      const res = await api('/reminders/settings/display-link', { method: 'POST' });
      setDisplayKey(res.displayKey ?? null);
      setNotice('The screen has a new address. The old one no longer works.');
    } catch (err) {
      setSaveError(err.message);
    }
  };
  const displayUrl = displayKey ? `${window.location.origin}/display/${displayKey}` : null;
  const signupKey = form?.signupKey ?? null;
  const signupUrl = signupKey ? `${window.location.origin}/portal/h/${signupKey}` : null;
  const provider = data?.provider;
  const whatsapp = data?.whatsapp;
  return (
    <>
      <PageHeader title="Patient messages" help="Automatic reminders and the patient portal. Both are off until you switch them on." tabs={moduleByKey('hospital-admin').tabs} />
      <div className="pf-content">
        <Alert type="error">{error ?? saveError}</Alert>
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
        {form && (
          <form className="card narrow msg-settings" onSubmit={save} noValidate>
            <h2>Automatic reminders</h2>
            <label className="check">
              <input type="checkbox" checked={form.remindersEnabled} onChange={(e) => setForm({ ...form, remindersEnabled: e.target.checked })} /> Send automatic reminders to patients who agreed
            </label>
            <p className="hint">Switching this on sends these messages, each only to patients who agreed (recorded on their page: More → Reminders and portal):</p>
            <ul className="hint">
              <li>about an appointment – when it is booked, moved or cancelled, and the day before: the hospital, the date and time, the doctor and the phone number;</li>
              <li>
                "A check-up or test is due at {'<'}hospital{'>'}. Please call {'<'}phone{'>'} to book." – when something in her care plan (a test, a scan, a vaccination, a check-up) became overdue in
                the last 6 weeks and nothing is booked. Only from care plans a doctor has approved (Clinic library → To approve);
              </li>
              <li>"we missed you at your appointment on {'<'}date{'>'}" – the day after a booked appointment nobody came to.</li>
            </ul>
            <p className="hint">
              The last two never say what is due or why. A patient – and a mobile number – gets at most one of them in 14 days, and none while she is in hospital, is already booked or has come,
              or her record is closed. They are not sent in the evening or at night. A baby's messages go to the number on the baby's own record, only when the agreement is recorded on the baby's
              record. The Marathi and Hindi wording is a draft: have it checked by a fluent speaker before use.{' '}
              {provider
                ? `Message provider: ${provider.name}.`
                : 'No message provider is set up yet: reminders wait in Calendar → Reminders for staff to send by hand. To send them automatically, the provider’s keys go in the server’s settings file (server/.env), never in the app.'}{' '}
              In India, SMS needs DLT registration of the sender and the wording; WhatsApp needs approved message templates.
            </p>
            <p className="hint">
              Patients who agreed before 4 Oct 2026 were told about appointment reminders only. Ask them again (More → Reminders and portal) – the agreement now also covers the last two messages.
            </p>
            <p className="hint">
              If a patient or a baby has died, her doctor records it on the record (More → Record a death). The record is then closed: no reminder or message of any kind goes to it.
            </p>
            <h2>Patient portal</h2>
            <label className="check">
              <input type="checkbox" checked={form.portalEnabled} onChange={(e) => setForm({ ...form, portalEnabled: e.target.checked })} /> Let patients see their next appointment and care plan online
            </label>
            <p className="hint">
              Staff give a patient a code (More → Reminders and portal); she signs in at {window.location.origin}/portal with the code and the last 4 digits of her mobile. She sees no results, notes or
              documents. Before switching this on for real patients: the app must be on a secure (https) address and reviewed by an experienced developer, and patients told how their data is used
              (Digital Personal Data Protection Act 2023).
            </p>
            <p className="hint">
              She can read the portal in English, Marathi or Hindi: she picks one at the top, and her phone remembers it. Until she picks one, it shows the language of her reminders once she has
              signed in (if she agreed to reminders). The Marathi and Hindi wording is a draft – have it checked by a fluent speaker before patients use it.
              Care-plan items a doctor added or reworded are shown as typed, in English.
            </p>
            <label className="check">
              <input type="checkbox" checked={form.portalBooking && form.portalEnabled} disabled={!form.portalEnabled} onChange={(e) => setForm({ ...form, portalBooking: e.target.checked })} /> Let patients book
              their own appointment in the portal
            </label>
            <p className="hint">
              A patient with a portal code may book one appointment with her own doctor, from the next day up to 30 days ahead, in a free time of the doctor's OPD, and cancel a booking she made
              online. She sees which times are free, never who else is booked. Reception sees these bookings marked "booked online by the patient".
            </p>
            <label className="check">
              <input type="checkbox" checked={Boolean(form.portalSignup) && form.portalEnabled} disabled={!form.portalEnabled} onChange={(e) => setForm({ ...form, portalSignup: e.target.checked })} /> Let
              patients sign up for their own account (reception approves each one)
            </label>
            <p className="hint">
              A patient signs up on the sign-in page (Patient) or at the hospital's portal address (below, for a poster) with her name, age, mobile number, email and a password. Her sign-up
              waits for reception (Patients → Online sign-ups): reception checks who she is and approves it – linking her patient record, or registering her – or rejects it. Only then can she
              sign in, with her mobile number and an OTP by SMS (the reminders' SMS provider; until one is set up, a practice OTP is shown on screen, never on a live server) or with her email
              and password. She sees her prescriptions and visits (signed visits only, as printed), lab reports (once a doctor has reviewed them) and bills. Never notes, risk or anything about
              HIV. Withdrawing her portal access (on her record) also closes her account. Switching this off makes the address stop working.
            </p>
            {signupUrl && (
              <p>
                Portal address: <a href={signupUrl} target="_blank" rel="noreferrer">{signupUrl}</a>{' '}
                <button type="button" className="btn btn-link btn-sm" onClick={() => setPoster(true)}>
                  <Printer aria-hidden="true" /> Print a poster
                </button>
              </p>
            )}
            {form.portalSignup && form.portalEnabled && !signupUrl && <p className="hint">Save to get the portal address.</p>}
            <h2>Prescriptions on WhatsApp</h2>
            <label className="check">
              <input type="checkbox" checked={Boolean(form.whatsappDocuments)} onChange={(e) => setForm({ ...form, whatsappDocuments: e.target.checked })} /> Let staff send a prescription or
              visit summary to the patient on WhatsApp in one click
            </label>
            <p className="hint">
              From the print preview (Share → Send on WhatsApp now), only to the mobile number on the patient’s record, and only for patients who agreed to WhatsApp messages (More → Reminders
              and portal). The PDF goes from the hospital’s own WhatsApp Business number through WhatsApp’s (Meta’s) servers, and cannot be taken back once sent.{' '}
              {whatsapp?.mode === 'live' && whatsapp.ready
                ? 'WhatsApp is set up on this server.'
                : whatsapp?.mode === 'practice'
                  ? 'Practice mode: the screens work, but nothing is really sent.'
                  : whatsapp?.mode === 'live'
                    ? 'WhatsApp is switched to live on this server, but its keys are missing in the server’s settings file (server/.env).'
                    : 'Not set up on this server yet: the hospital needs a WhatsApp Business account with Meta and an approved message template; the keys then go in the server’s settings file (server/.env), never in the app. Until then staff use Send on WhatsApp, which opens a chat to attach the PDF by hand.'}{' '}
              Use it for real patients only after the app has been reviewed by an experienced developer.
            </p>
            <h2>Waiting-room screen</h2>
            <label className="check">
              <input type="checkbox" checked={Boolean(form.displayEnabled)} onChange={(e) => setForm({ ...form, displayEnabled: e.target.checked })} /> Show who goes in next on a screen in the
              waiting room
            </label>
            <p className="hint">
              For a TV or tablet in the waiting room: each doctor's name and who is next, as a token number or an appointment time – never a name. It needs no login; anyone with the address can
              open it, so keep the address to the hospital's own screens.
            </p>
            {displayUrl && (
              <p>
                Address of the screen: <a href={displayUrl} target="_blank" rel="noreferrer">{displayUrl}</a>{' '}
                <button type="button" className="btn btn-link btn-sm" onClick={newLink}>
                  Make a new address
                </button>
              </p>
            )}
            {form.displayEnabled && !displayUrl && <p className="hint">Save to get the address of the screen.</p>}
            <div className="row">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
        {poster && signupUrl && <SignupPoster url={signupUrl} hospital={activeMembership?.tenantName ?? 'The hospital'} onClose={() => setPoster(false)} />}
      </div>
    </>
  );
}
