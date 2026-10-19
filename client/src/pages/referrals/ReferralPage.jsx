import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CalendarCheck,
  Check,
  ClipboardCopy,
  FileDown,
  FileOutput,
  FileSignature,
  FileText,
  Handshake,
  Hourglass,
  MessageCircle,
  NotebookPen,
  Paperclip,
  Pencil,
  Search,
  Send,
  UserPlus,
} from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, apiFile } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { fileBody, fileProblem, fileSize } from '../../components/fileUpload.js';
import { Letterhead, LetterheadFooter } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintFacts, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { downloadFile, makePdf } from '../../components/print/pdfExport.js';
import { Alert, Field, StatusPill, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';
import { PatientFinder, SlotChooser } from '../appointments/AppointmentDialogs.jsx';
import { STATUS_LOOK as APPOINTMENT_LOOK, VISIT_TYPES, VISIT_TYPE_LABELS, dayLabel, timeLabel } from '../appointments/appointmentFormat.js';
import { DocPrintDocument } from '../inpatient/DocumentPage.jsx';
import { PossibleMatchesDialog } from '../patients/PossibleMatchesDialog.jsx';
import { CARE_TYPE_LABELS } from '../patients/patientFormat.js';
import { blobToBase64, showWhatsappNumber, whatsappLink, whatsappNumber } from '../visits/whatsapp.js';
import { GuestFields, IntakeFields, guestBody, intakeBody, intakeForm, intakeHasFetalSex } from './NewReferralPage.jsx';
import { PromisePill, promiseWhen, useNow } from './ReferralsDeskPage.jsx';
import {
  MESSAGE_LABELS,
  MISSED_STATES,
  NOTE_KEYS,
  RELEASE_LABELS,
  SENT_FIELDS,
  VIA_LABELS,
  emptyNote,
  formatLocalDay,
  localIso,
  noteFields,
  promiseLabel,
  releaseFileName,
  sharingLook,
  statusLook,
  urgencyLook,
  whoFacts,
  whoName,
} from './referralFormat.js';

// One referral from another doctor (docs/REFERRALS_PLAN.md), worked through the guide's promises in order:
// - the patient: found among the registered patients, or registered here (name, age, phone, type of care, doctor),
//   then linked to the referral;
// - her appointment (doctor, day, free time), and the reply to the referring doctor – the app prepares the text,
//   the desk copies it into the doctor's WhatsApp chat (opened from here, with nothing about her in the link), sends
//   it from its own phone and marks it sent;
// - her Yes or No, asked at her first visit: the consultant note and the discharge summary go only with her Yes;
// - the consultant note in the guide's layout, started from her first visit, signed by a doctor and released to the
//   desk as a PDF made in this browser; the confirmed discharge card released the same way;
// - the PDFs saved by the desk (after her Yes) to attach in the chat, the messages marked sent, the attachments the
//   doctor sent, the weekly review notes on a missed promise, and closing.
// What each person may do comes from the server (referral.access); the desk never sees her medical record.

/** A small dialog with one text box (a reason, an addition to the signed note). */
function TextDialog({ id, title, text, label, okLabel, danger = false, min = 5, max = 300, rows = 3, onSave, onCancel }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const ref = useDialogFocus(onCancel);
  const save = async (e) => {
    e.preventDefault();
    if (value.trim().length < min) return setError('Write at least a few words.');
    if (mentionsFetalSex(value)) return setError(PCPNDT_MESSAGE);
    setSaving(true);
    try {
      await onSave(value.trim());
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
    return undefined;
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onSubmit={save} noValidate>
        <h2 id={`${id}-title`}>{title}</h2>
        {text && <p>{text}</p>}
        <Field label={label} id={`${id}-text`} error={error}>
          <textarea id={`${id}-text`} rows={rows} maxLength={max} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </Field>
        <div className="row">
          <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={saving}>
            {saving ? 'Saving…' : okLabel}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Back
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * The weekly review of a missed promise (doctors and RMOs): what went wrong and what changed. Also used on the
 * Weekly review page. promises: the referral's promises; preset: the promise to review first.
 */
export function ReviewDialog({ referral, promises, preset = null, onSaved, onCancel }) {
  const missed = promises.filter((p) => MISSED_STATES.includes(p.state));
  const choices = missed.length ? missed : promises;
  const [promise, setPromise] = useState(preset ?? choices[0]?.key ?? 'reply');
  const [wentWrong, setWentWrong] = useState('');
  const [changed, setChanged] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const ref = useDialogFocus(onCancel);
  const save = async (e) => {
    e.preventDefault();
    if (wentWrong.trim().length < 5 || changed.trim().length < 5) return setError('Write what went wrong and what changed – a few words each.');
    if ([wentWrong, changed].some((t) => mentionsFetalSex(t))) return setError(PCPNDT_MESSAGE);
    setSaving(true);
    setError(null);
    try {
      const res = await api(`/referrals/${referral.id}/reviews`, { method: 'POST', body: { promise, wentWrong: wentWrong.trim(), changed: changed.trim() } });
      onSaved(res);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
    return undefined;
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="ref-review-title" onSubmit={save} noValidate>
        <h2 id="ref-review-title">Write the review – {referral.number}</h2>
        <p className="hint">The guide promises that every miss is reviewed within the week. Write about the work, not about a person.</p>
        <Alert type="error">{error}</Alert>
        <Field label="Promise" id="ref-review-promise">
          <select id="ref-review-promise" value={promise} onChange={(e) => setPromise(e.target.value)}>
            {choices.map((p) => (
              <option key={p.key} value={p.key}>
                {promiseLabel(p)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="What went wrong" id="ref-review-wrong">
          <textarea id="ref-review-wrong" rows={3} maxLength={1000} value={wentWrong} onChange={(e) => setWentWrong(e.target.value)} />
        </Field>
        <Field label="What changed, so it does not happen again" id="ref-review-changed">
          <textarea id="ref-review-changed" rows={3} maxLength={1000} value={changed} onChange={(e) => setChanged(e.target.value)} />
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save the review'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * One label / value list. rows: [[label, value]] – empty values are left out. compact: labels as wide as they need
 * (the narrow column beside the work), otherwise the ruled list of the wide column.
 */
function Facts({ rows, compact = false }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!shown.length) return null;
  if (compact) {
    return (
      <dl className="lab-stamps">
        {shown.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd className="pre-line">{v}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl className="details">
      {shown.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const btn = (primary) => `btn ${primary ? 'btn-primary' : 'btn-secondary'}`;

// ---------- The patient: find or register, then link ----------

function FindDialog({ referral, onDone, onCancel }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const ref = useDialogFocus(onCancel);
  // The desk links a record only when her name or phone matches the referral (409 LINK_MISMATCH otherwise, with the
  // server's words); her doctor or an RMO may link any record. (canReview: doctors and RMOs who may open her record)
  const desk = !referral.access?.canReview;
  const link = async (p) => {
    if (p.duplicateOf || p.closed) return setError(p.duplicateOf ? `This record is a duplicate – choose ${p.duplicateOf.mrn} instead.` : 'This record is closed. Choose another record or register her.');
    setBusy(true);
    setError(null);
    try {
      const res = await api(`/referrals/${referral.id}/link`, { method: 'POST', body: { patientId: p.id } });
      onDone(res, `The referral is now on ${p.fullName}’s record (${p.mrn}).`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
    return undefined;
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div ref={ref} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="ref-find-title">
        <h2 id="ref-find-title">Find her record</h2>
        {referral.guest && (
          <p className="muted">
            Referred as {referral.guest.name}
            {referral.guest.phone ? ` · ${referral.guest.phone}` : ''}
            {referral.guest.ageYears != null ? ` · ${referral.guest.ageYears} yrs` : ''}
          </p>
        )}
        {referral.guest && desk && <p className="hint">Her name or phone on the record must match the referral. If they do not, her doctor or an RMO links it.</p>}
        <Alert type="error">{error}</Alert>
        {busy ? <p className="muted">Linking…</p> : <PatientFinder onPick={link} />}
        <div className="row">
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const REGISTER_CARE_TYPES = Object.keys(CARE_TYPE_LABELS).filter((t) => t !== 'newborn');

/** Registers her with her identity details only (the desk never enters medical details), then links the referral. */
function RegisterDialog({ referral, doctors, onDone, onCancel }) {
  const g = referral.guest ?? {};
  const [form, setForm] = useState({ careType: 'antenatal', fullName: g.name ?? '', ageYears: g.ageYears != null ? String(g.ageYears) : '', phone: g.phone ?? '', assignedDoctor: referral.consultant?.id ?? '' });
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [matches, setMatches] = useState(null); // "She may already be registered": { list, total }
  const [busy, setBusy] = useState(null); // 'register' | a record's id | null
  const payload = () => ({ careType: form.careType, fullName: form.fullName.trim(), ageYears: form.ageYears, phone: form.phone.trim(), assignedDoctor: form.assignedDoctor || null });

  const link = async (patient, registered) => {
    try {
      const res = await api(`/referrals/${referral.id}/link`, { method: 'POST', body: { patientId: patient.id } });
      onDone(res, registered ? `${patient.fullName} was registered as ${patient.mrn}, and the referral is now on her record.` : `The referral is now on ${patient.fullName}’s record (${patient.mrn}).`);
    } catch (err) {
      // (her name and phone not matching the referral – LINK_MISMATCH – is not helped by "Find her record": her
      // doctor or an RMO links it)
      const retry = err.code === 'LINK_MISMATCH' ? '' : ' Use “Find her record”.';
      const words = registered ? `${patient.fullName} was registered as ${patient.mrn}, but the referral could not be linked: ${err.message}${retry}` : err.message;
      setMatches(null);
      setError(words);
      setBusy(null);
    }
  };
  const register = async (anyway = false) => {
    if (mentionsFetalSex(form.fullName)) return setError(PCPNDT_MESSAGE);
    setBusy('register');
    setError(null);
    setFields({});
    try {
      const { patient } = await api('/patients', { method: 'POST', body: { ...payload(), ...(anyway ? { registerAnyway: true } : {}) } });
      await link(patient, true);
    } catch (err) {
      setBusy(null);
      if (err.code === 'POSSIBLE_MATCHES') {
        setMatches({ list: err.matches ?? [], total: err.total ?? 0 });
        return undefined;
      }
      setMatches(null);
      setError(err.message);
      setFields(err.fields ?? {});
    }
    return undefined;
  };

  if (matches) {
    return (
      <PossibleMatchesDialog
        careType={form.careType}
        matches={matches.list}
        total={matches.total}
        busy={busy}
        error={error}
        openNote="Choosing a record links this referral to it."
        onOpen={(m) => {
          setBusy(m.id);
          link(m, false);
        }}
        onRegisterAnyway={() => register(true)}
        onBack={() => setMatches(null)}
      />
    );
  }
  return <RegisterForm form={form} setForm={setForm} fields={fields} error={error} busy={busy} doctors={doctors} onSubmit={() => register(false)} onCancel={onCancel} />;
}

/** The form of "Register her" (its own component, so its keyboard handling ends while the matches are shown). */
function RegisterForm({ form, setForm, fields, error, busy, doctors, onSubmit, onCancel }) {
  const ref = useDialogFocus(onCancel);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        ref={ref}
        tabIndex={-1}
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ref-register-title"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        noValidate
      >
        <h2 id="ref-register-title">Register her</h2>
        <p className="hint">Her name, age, phone, type of care and doctor only. Her doctor or an RMO adds the medical details at her first visit.</p>
        <Alert type="error">{error}</Alert>
        <div className="form-grid">
          <Field label="Type of care" id="ref-reg-care" error={fields.careType}>
            <select id="ref-reg-care" value={form.careType} onChange={set('careType')}>
              {REGISTER_CARE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CARE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Full name" id="ref-reg-name" error={fields.fullName}>
            <input id="ref-reg-name" maxLength={150} value={form.fullName} onChange={set('fullName')} autoFocus />
          </Field>
          <Field label="Age (years)" id="ref-reg-age" error={fields.ageYears}>
            <input id="ref-reg-age" inputMode="numeric" className="tabular" maxLength={3} value={form.ageYears} onChange={(e) => setForm((f) => ({ ...f, ageYears: e.target.value.replace(/\D/g, '') }))} />
          </Field>
          <Field label="Phone number" id="ref-reg-phone" error={fields.phone}>
            <input id="ref-reg-phone" type="tel" maxLength={30} value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="Her doctor" id="ref-reg-doctor" error={fields.assignedDoctor}>
            <select id="ref-reg-doctor" value={form.assignedDoctor} onChange={set('assignedDoctor')}>
              <option value="">Not chosen yet</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={Boolean(busy)}>
            <UserPlus aria-hidden="true" /> {busy ? 'Saving…' : 'Register and link'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function PatientCard({ r, doctors, onDone, primary }) {
  const [dialog, setDialog] = useState(null); // 'find' | 'register'
  const a = r.access ?? {};
  return (
    <section className="card" aria-labelledby="ref-patient-title">
      <h2 id="ref-patient-title">The patient</h2>
      {r.patient ? (
        <p>
          <Link to={`/patients/${r.patient.id}`} className="strong-name">
            {r.patient.fullName}
          </Link>{' '}
          <span className="muted tabular">· {whoFacts(r)}</span>
        </p>
      ) : (
        <>
          <p>
            <strong>{r.guest?.name}</strong> <span className="muted tabular">· {[whoFacts(r), r.guest?.phone].filter(Boolean).join(' · ')}</span>
          </p>
          {a.canLink && (
            <>
              <p className="hint">Find her record if she has been here before; otherwise register her. The referral then joins her record.</p>
              <div className="row">
                <button type="button" className={btn(primary)} onClick={() => setDialog('find')}>
                  <Search aria-hidden="true" /> Find her record
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setDialog('register')}>
                  <UserPlus aria-hidden="true" /> Register her
                </button>
              </div>
            </>
          )}
        </>
      )}
      {dialog === 'find' && (
        <FindDialog
          referral={r}
          onCancel={() => setDialog(null)}
          onDone={(res, message) => {
            setDialog(null);
            onDone(res, message);
          }}
        />
      )}
      {dialog === 'register' && (
        <RegisterDialog
          referral={r}
          doctors={doctors}
          onCancel={() => setDialog(null)}
          onDone={(res, message) => {
            setDialog(null);
            onDone(res, message);
          }}
        />
      )}
    </section>
  );
}

// ---------- Her appointment ----------

function BookForm({ r, doctors, onDone, onRefused, primary }) {
  const [doctorId, setDoctorId] = useState(r.consultant?.id ?? doctors[0]?.id ?? '');
  const today = localIso();
  const [date, setDate] = useState(today);
  const [start, setStart] = useState(null);
  const [visitType, setVisitType] = useState('new');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const book = async (confirm) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api(`/referrals/${r.id}/book`, { method: 'POST', body: { doctorId, date, start, visitType, confirm } });
      setWarning(null);
      onDone(res, `Booked: ${dayLabel(date)} at ${timeLabel(start)}. Next: send the reply to the doctor.`);
    } catch (err) {
      // A warning the desk can talk past (the time is taken, or she is already booked that day)
      if (err.status === 409 && ['SLOT_TAKEN', 'ALREADY_BOOKED'].includes(err.code)) setWarning(err.message);
      // She was seen meanwhile (or booked by someone else): no booking is needed, and this form goes once the
      // referral is loaded again – so the server's words are shown by the card, not here
      else if (err.status === 409 && ['ALREADY_SEEN', 'HAS_APPOINTMENT'].includes(err.code)) onRefused(err.message);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Alert type="error">{error}</Alert>
      <div className="form-grid">
        <Field label="Doctor" id="ref-book-doctor">
          <select
            id="ref-book-doctor"
            value={doctorId}
            onChange={(e) => {
              setDoctorId(e.target.value);
              setStart(null);
              setWarning(null);
            }}
          >
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Day" id="ref-book-date" hint={r.urgency === 'urgent' ? 'Urgent: she is to be seen today.' : 'Routine: within 48 hours of the referral.'} keepHint>
          <input
            id="ref-book-date"
            type="date"
            min={today}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setStart(null);
              setWarning(null);
            }}
          />
        </Field>
        <Field label="Visit type" id="ref-book-type">
          <select id="ref-book-type" value={visitType} onChange={(e) => setVisitType(e.target.value)}>
            {VISIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {VISIT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <SlotChooser
        doctorId={doctorId}
        date={date}
        value={start}
        onChange={(s) => {
          setStart(s);
          setWarning(null);
        }}
      />
      {warning && (
        <div className="appt-warning" role="alert">
          <p>{warning}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => book(true)} disabled={busy}>
            Book anyway
          </button>
        </div>
      )}
      <div className="row">
        <button type="button" className={btn(primary)} disabled={!start || !doctorId || busy || Boolean(warning)} onClick={() => book(false)}>
          <CalendarCheck aria-hidden="true" /> {busy ? 'Booking…' : 'Book this time'}
        </button>
      </div>
    </>
  );
}

function AppointmentCard({ r, doctors, onDone, onStale, primary }) {
  const a = r.access ?? {};
  const appt = r.appointment;
  const look = appt ? APPOINTMENT_LOOK[appt.status] : null;
  const [refused, setRefused] = useState(null);
  // The server decides: no booking yet, or one cancelled or missed (she did not come) – and never once she has been
  // seen (a walk-in, or seen on another day than her booking): the reply then tells her doctor when she was seen
  const canBookNow = a.canBook && r.status === 'open' && !r.firstSeen;
  return (
    <section className="card" aria-labelledby="ref-appt-title">
      <h2 id="ref-appt-title">Her appointment</h2>
      <Alert type="warning" onClose={() => setRefused(null)}>
        {refused}
      </Alert>
      {appt ? (
        <div className="row-between">
          <p className="vs-booking">
            <CalendarCheck aria-hidden="true" /> {dayLabel(String(appt.date).slice(0, 10))}
            {appt.start ? ` · ${timeLabel(appt.start)}` : ''} · {appt.doctorName}
          </p>
          {look && (
            <StatusPill tone={look.tone} icon={look.icon}>
              {look.label}
            </StatusPill>
          )}
        </div>
      ) : r.firstSeen ? (
        <p className="muted">
          Not booked: she was first seen {r.firstSeen.onAdmission ? 'on admission' : 'at a visit'}, {formatDateTime(r.firstSeen.at)}. No booking is needed.
        </p>
      ) : (
        <p className="muted">Not booked yet.</p>
      )}
      {appt && !['cancelled', 'no_show'].includes(appt.status) && <p className="hint">To move or cancel it, use the Appointments page.</p>}
      {canBookNow && doctors.length > 0 && (
        <BookForm
          r={r}
          doctors={doctors}
          onDone={(res, message) => {
            setRefused(null);
            onDone(res, message);
          }}
          onRefused={(message) => {
            setRefused(message);
            onStale();
          }}
          primary={primary}
        />
      )}
      {canBookNow && !doctors.length && <Alert type="warning">There are no doctors in this hospital to book with.</Alert>}
    </section>
  );
}

// ---------- The reply, and the PDFs the desk sends ----------

/** The chat with the referring doctor: WhatsApp's own link with her number only – never anything about the patient. */
function ChatLink({ doctor }) {
  const number = whatsappNumber(doctor?.phone);
  if (!number) return null;
  return (
    <a className="btn btn-secondary" href={whatsappLink(number)} target="_blank" rel="noreferrer">
      <MessageCircle aria-hidden="true" /> Open WhatsApp chat
    </a>
  );
}
function NoNumber({ doctor }) {
  if (whatsappNumber(doctor?.phone)) return null;
  return (
    <p className="hint">
      {doctor?.name} has no WhatsApp number on record. <Link to="/referrals/doctors">Add it on Referring doctors</Link>, or send it another way and mark it sent.
    </p>
  );
}

function ReplyCard({ r, onDone, primary, busy, setBusy }) {
  const a = r.access ?? {};
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const doctor = r.referringDoctor;
  const sent = r.messages?.filter((m) => m.what === 'reply') ?? [];
  const number = whatsappNumber(doctor?.phone);
  const copy = async () => {
    setError(null);
    try {
      await navigator.clipboard.writeText(r.replyText);
      setCopied(true);
    } catch {
      setCopied(false);
      setError('This browser did not allow copying. Select the message with the mouse and copy it.');
    }
  };
  const markSent = async () => {
    setBusy('reply');
    setError(null);
    try {
      onDone(await api(`/referrals/${r.id}/messages`, { method: 'POST', body: { what: 'reply' } }), 'The reply is marked as sent.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="card" aria-labelledby="ref-reply-title">
      <h2 id="ref-reply-title">Reply to the doctor</h2>
      <p className="hint help">The guide promises a reply within 2 working hours with her appointment time and the consultant. It goes without asking her.</p>
      {sent.map((m) => (
        <p key={m.at} className="vs-booking">
          <Check aria-hidden="true" /> Sent by {m.byName}, {formatDateTime(m.at)}
        </p>
      ))}
      {r.replyText ? (
        <>
          <Field label="The message" id="ref-reply-text" hint="Prepared from the booking; nothing goes into the WhatsApp link itself.">
            <textarea id="ref-reply-text" readOnly rows={Math.min(10, r.replyText.split('\n').length + 1)} value={r.replyText} onFocus={(e) => e.target.select()} />
          </Field>
          <Alert type="error">{error}</Alert>
          {a.canMarkSent && (
            <>
              <div className="row">
                <button type="button" className={btn(primary)} onClick={copy}>
                  <ClipboardCopy aria-hidden="true" /> {copied ? 'Copied' : 'Copy the message'}
                </button>
                <ChatLink doctor={doctor} />
                <button type="button" className="btn btn-secondary" onClick={markSent} disabled={busy === 'reply'}>
                  <Send aria-hidden="true" /> {busy === 'reply' ? 'Saving…' : sent.length ? 'Mark as sent again' : 'Mark as sent'}
                </button>
              </div>
              <p className="hint">
                Copy the message, open the chat with {doctor?.name}
                {number ? ` (${showWhatsappNumber(number)})` : ''}, paste it and press Send on the desk’s phone or WhatsApp Web. Then mark it sent here.
              </p>
              <NoNumber doctor={doctor} />
            </>
          )}
        </>
      ) : (
        <p className="muted">The reply is ready once her appointment is booked and the consultant is chosen.</p>
      )}
    </section>
  );
}

function SharingCard({ r, onDone, busy, setBusy }) {
  const a = r.access ?? {};
  const look = sharingLook(r.sharing);
  const [error, setError] = useState(null);
  const answer = async (value) => {
    setBusy(`sharing-${value}`);
    setError(null);
    try {
      const res = await api(`/referrals/${r.id}/sharing`, { method: 'POST', body: { answer: value } });
      onDone(res, value === 'yes' ? 'Her Yes is recorded: the consultant note and the discharge summary may be sent to her doctor.' : 'Her No is recorded: the consultant note and the discharge summary are not sent. That is not a missed promise.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="card" aria-labelledby="ref-sharing-title">
      <div className="plan-card-head">
        <h2 id="ref-sharing-title">
          <Handshake aria-hidden="true" /> Her agreement
        </h2>
        <StatusPill tone={look.tone} icon={look.icon}>
          {look.word}
        </StatusPill>
      </div>
      <p>Ask her at her first visit: “May we send {r.referringDoctor?.name ?? 'your doctor'} a note of what we found and, after a stay, your discharge summary?”</p>
      {r.sharing && (
        <p className="hint">
          Recorded by {r.sharing.byName}, {formatDateTime(r.sharing.at)}.
        </p>
      )}
      <Alert type="error">{error}</Alert>
      {a.canAnswerSharing && (
        <div className="row">
          {r.sharing?.answer !== 'yes' && (
            <button type="button" className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => answer('yes')}>
              <Check aria-hidden="true" /> {busy === 'sharing-yes' ? 'Saving…' : r.sharing ? 'She now says Yes' : 'She said Yes'}
            </button>
          )}
          {r.sharing?.answer !== 'no' && (
            <button type="button" className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => answer('no')}>
              {busy === 'sharing-no' ? 'Saving…' : r.sharing ? 'She now says No' : 'She said No'}
            </button>
          )}
        </div>
      )}
      <p className="hint help">The reply with her appointment goes without asking. The note and the discharge summary go only with her Yes; a No is respected.</p>
    </section>
  );
}

// ---------- The consultant note ----------

/** The consultant note on paper, in the guide's layout: what is released to the desk as a PDF. */
function NoteDocument({ r, letterhead }) {
  const note = r.note;
  const doctor = r.referringDoctor;
  const s = note.signed;
  const age = r.patient?.ageYears ?? r.guest?.ageYears;
  const footer = (
    <>
      <span className="tabular">
        Ref {r.number} · {whoName(r)}
      </span>
      <span>
        Questions: {r.consultant?.name}
        {r.consultant?.directLine ? `, ${r.consultant.directLine}` : ''}
      </span>
    </>
  );
  return (
    <PrintDocument footer={footer}>
      <Letterhead letterhead={letterhead} />
      <h1 className="pdoc-title">Consultant note to referring doctor</h1>
      <PrintFacts
        items={[
          ['Ref', <span key="ref" className="pdoc-tabular">{r.number}</span>],
          ['To', [doctor?.name, doctor?.qualification].filter(Boolean).join(', ')],
          ['Clinic', doctor?.clinic ?? ''],
          ['Referred on', formatLocalDay(r.receivedAt)],
          ['Patient', `${whoName(r)}${age != null ? `, ${age} yrs` : ''}`],
          ['Seen', r.firstSeen ? `${formatLocalDay(r.firstSeen.at)} by ${r.consultant?.name ?? ''}` : ''],
        ]}
      />
      {noteFields(letterhead?.name).map((f) => {
        const text = f.key === 'questionRestated' ? note.questionRestated || r.question : note[f.key];
        return text ? (
          <div key={f.key}>
            <h2>{f.label}</h2>
            <p className="pre-line">{text}</p>
          </div>
        ) : null;
      })}
      {note.additions?.length > 0 && (
        <>
          <h2>Added after signing</h2>
          {note.additions.map((x) => (
            <p key={x.at}>
              {x.text} <span className="pdoc-small">({x.byName}, {formatDateTime(x.at)})</span>
            </p>
          ))}
        </>
      )}
      {s && (
        <div className="lh-sign">
          <div className="lh-sign-line" />
          <strong className="lh-sign-name">{s.byName}</strong>
          {s.qualification && <div>{s.qualification}</div>}
          {s.registrationNumber && (
            <div className="tabular">
              Reg. No. {s.registrationNumber}
              {s.council ? ` (${s.council})` : ''}
            </div>
          )}
          <div className="tabular">Signed {formatDateTime(s.at)}</div>
        </div>
      )}
      <LetterheadFooter letterhead={letterhead} />
    </PrintDocument>
  );
}

/**
 * The print preview of a PDF to release (the note, or the discharge card): the PDF is made here from the page on
 * screen and sent to the server, where only the desk and clinicians of this referral can fetch it.
 */
function ReleasePreview({ r, kind, title, ready = true, docKey, onReleased, onClose, children }) {
  const holder = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const earlier = (r.releases ?? []).some((x) => x.kind === kind && !x.superseded);
  const release = async () => {
    setBusy(true);
    setError(null);
    try {
      const doc = holder.current?.querySelector('.pdoc');
      if (!doc) throw new Error('The page is still loading.');
      const blob = await makePdf(doc, undefined, { title: RELEASE_LABELS[kind] });
      const fileName = releaseFileName(r.number, kind);
      const res = await api(`/referrals/${r.id}/releases`, { method: 'POST', body: { kind, fileName, mediaType: 'application/pdf', data: await blobToBase64(blob) } });
      onReleased(res, `Released to the referral desk as “${fileName}”.${earlier ? ' The earlier PDF is marked replaced.' : ''}`);
    } catch (err) {
      setError(`Nothing was released. ${err.message}`);
      setBusy(false);
    }
  };
  const controls = (
    <div className="pv-controls">
      <div className="row">
        <button type="button" className="btn btn-secondary" onClick={release} disabled={busy || !ready}>
          <FileOutput aria-hidden="true" /> {busy ? 'Making the PDF…' : 'Release to the referral desk'}
        </button>
      </div>
      {earlier && <p className="hint">A PDF of this was released before; the new one replaces it.</p>}
      <Alert type="error">{error}</Alert>
    </div>
  );
  return (
    <PrintPreview title={title} hint="Check the page. The desk sends the released PDF to the referring doctor on WhatsApp." controls={controls} docKey={docKey} onClose={onClose}>
      <div ref={holder}>{children}</div>
    </PrintPreview>
  );
}

const KEPT_TEXT = 'Someone changed the note meanwhile – your text is kept; check it against theirs, then save again.';

function NoteCard({ r, hospitalName, letterhead, onDone, onFailed, primary }) {
  const a = r.access ?? {};
  const note = r.note;
  const fields = noteFields(hospitalName);
  const fromNote = () => ({ ...emptyNote(), ...Object.fromEntries(NOTE_KEYS.map((k) => [k, note?.[k] ?? ''])) });
  const [form, setForm] = useState(fromNote);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [dialog, setDialog] = useState(null); // 'addition' | 'release'
  // The note as it was when the form last followed it: what the doctor has typed since is hers
  const base = useRef(null);
  if (base.current === null) base.current = fromNote();
  // Set by this card's own save, signing or start from her visit: the note that comes back is taken as it is
  const adopt = useRef(false);
  const [kept, setKept] = useState(false); // her text was kept over a newer note saved by someone else
  // The form follows the note as last saved – except while the doctor has typed something not saved yet and someone
  // else saved the note meanwhile (409 STALE, or a newer note in any answer from the server): her text is kept, never
  // replaced by theirs, and saving again writes it over theirs once she has checked it against theirs
  useEffect(() => {
    const next = fromNote();
    const typed = NOTE_KEYS.some((k) => form[k] !== base.current[k]);
    const differs = NOTE_KEYS.some((k) => form[k] !== next[k]);
    const own = adopt.current;
    adopt.current = false;
    base.current = next;
    setFieldErrors({});
    if (!own && typed && differs && note?.status !== 'signed') {
      setKept(true);
      setError(KEPT_TEXT);
      return;
    }
    setKept(false);
    setForm(next);
  }, [note?.rev, note?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const signed = note?.status === 'signed';
  const editable = a.canWriteNote && !signed;
  const saved = fromNote();
  const dirty = editable && NOTE_KEYS.some((k) => form[k] !== saved[k]);
  const empty = NOTE_KEYS.every((k) => !saved[k].trim());
  const body = () => Object.fromEntries(NOTE_KEYS.map((k) => [k, form[k].trim()]));

  const run = async (key, fn, message) => {
    setBusy(key);
    setError(null);
    try {
      const res = await fn();
      adopt.current = true;
      setKept(false);
      onDone(res, message);
      return res;
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
      // Someone changed it meanwhile: the referral is loaded again (what she typed stays – see above)
      if (err.status === 409) onFailed();
      return null;
    } finally {
      setBusy(null);
    }
  };
  const save = () => {
    if (Object.values(form).some((t) => mentionsFetalSex(t))) {
      setError(PCPNDT_MESSAGE);
      return Promise.resolve(null);
    }
    return run('save', () => api(`/referrals/${r.id}/note`, { method: 'PUT', body: { rev: note?.rev ?? 0, ...body() } }), 'The note is saved.');
  };
  const sign = async () => {
    const missing = fields.filter((f) => f.required && !form[f.key].trim());
    if (missing.length) {
      setFieldErrors(Object.fromEntries(missing.map((f) => [f.key, `Write the ${f.label.toLowerCase()} before signing.`])));
      setError(`Before signing, fill in: ${missing.map((f) => f.label).join(', ')}.`);
      return;
    }
    let rev = note?.rev ?? 0;
    if (dirty || !note) {
      const res = await save();
      if (!res) return;
      rev = res.referral?.note?.rev ?? rev + 1;
    }
    await run('sign', () => api(`/referrals/${r.id}/note/sign`, { method: 'POST', body: { rev } }), 'The note is signed. Release it to the referral desk when you are ready.');
  };

  if (!note && !a.canWriteNote) {
    return (
      <section className="card" aria-labelledby="ref-note-title">
        <h2 id="ref-note-title">Consultant note</h2>
        <p className="muted">{r.firstSeen ? 'Not written yet. Her doctor or an RMO writes it; a doctor signs it.' : 'Written after her first visit.'}</p>
      </section>
    );
  }
  const noteRelease = (r.releases ?? []).find((x) => x.kind === 'note' && !x.superseded);
  return (
    <section className="card" aria-labelledby="ref-note-title">
      <div className="plan-card-head">
        <h2 id="ref-note-title">
          <NotebookPen aria-hidden="true" /> Consultant note
        </h2>
        {note && (
          <StatusPill tone={signed ? 'stable' : 'due'} icon={signed ? FileSignature : Pencil}>
            {signed ? 'Signed' : 'Draft'}
          </StatusPill>
        )}
      </div>
      <p className="hint help">The guide promises the note within 24 hours of her first visit. It goes to the referring doctor only with her Yes. “Returns to you for” must be filled in: she goes back to her doctor.</p>
      <Alert type="error">{error}</Alert>
      {editable ? (
        <>
          {kept && (
            <details className="hint">
              <summary>Their saved version{note?.saved ? ` (${note.saved.byName}, ${formatDateTime(note.saved.at)})` : ''}</summary>
              <Facts rows={fields.map((f) => [f.label, saved[f.key]])} />
              <button
                type="button"
                className="btn btn-link btn-sm"
                disabled={Boolean(busy)}
                onClick={() => {
                  setForm(saved);
                  setKept(false);
                  setError(null);
                }}
              >
                Use their version instead
              </button>
            </details>
          )}
          {/* (only from a visit: when she was first seen on admission, the note is written from her stay) */}
          {empty && r.firstSeen && !r.firstSeen.onAdmission && (
            <button type="button" className="btn btn-link btn-sm" disabled={Boolean(busy) || dirty} onClick={async () => {
              const res = await run('visit', () => api(`/referrals/${r.id}/note/from-visit`, { method: 'POST', body: {} }), 'Started from her first visit – check every line.');
              // Parts of the visit that mention the baby's sex were left out (PC-PNDT): say so
              if (res?.left?.length) onDone(res, `Started from her first visit – check every line. Left out because they mention the baby's sex: ${res.left.map((k) => fields.find((f) => f.key === k)?.label ?? k).join(', ')}.`);
            }}>
              {busy === 'visit' ? 'Starting…' : 'Start from her first visit'}
            </button>
          )}
          {!r.firstSeen && <p className="hint">Her first visit after the referral is not recorded yet; the note can still be drafted.</p>}
          {empty && r.firstSeen?.onAdmission && <p className="hint">She was first seen on admission: write the note from her stay.</p>}
          {fields.map((f) => (
            <Field key={f.key} label={f.required ? f.label : `${f.label} (optional)`} id={`ref-note-${f.key}`} error={fieldErrors[f.key]}>
              <textarea id={`ref-note-${f.key}`} rows={f.rows} maxLength={f.max} value={form[f.key]} onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))} placeholder={f.key === 'questionRestated' ? r.question : undefined} />
            </Field>
          ))}
          <p className="hint">Never the private note of her visit, and no words about the baby’s sex.</p>
          <div className="row">
            {a.canSignNote && (
              <button type="button" className={btn(primary)} disabled={Boolean(busy)} onClick={sign}>
                <FileSignature aria-hidden="true" /> {busy === 'sign' ? 'Signing…' : 'Sign the note'}
              </button>
            )}
            <button type="button" className={a.canSignNote ? 'btn btn-secondary' : btn(primary)} disabled={Boolean(busy) || (!dirty && Boolean(note))} onClick={save}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
          </div>
          {!a.canSignNote && <p className="hint">A doctor signs the note.</p>}
          {note?.saved && (
            <p className="hint">
              Last saved by {note.saved.byName}, {formatDateTime(note.saved.at)}.
            </p>
          )}
        </>
      ) : (
        note && (
          <>
            <Facts rows={fields.map((f) => [f.label, f.key === 'questionRestated' ? note.questionRestated || r.question : note[f.key]])} />
            {note.additions?.map((x) => (
              <p key={x.at}>
                <strong>Added</strong> <span className="muted">({x.byName}, {formatDateTime(x.at)})</span>: {x.text}
              </p>
            ))}
            {signed && (
              <p className="hint">
                Signed by {note.signed.byName}, {formatDateTime(note.signed.at)}.
              </p>
            )}
            {/* (canWriteNote and canSignNote end with the signing; who may write the note may still add to it) */}
            {signed && (a.canRelease || a.canAddToNote) && (
              <div className="row">
                {a.canRelease && (
                  <button type="button" className={btn(primary)} onClick={() => setDialog('release')}>
                    <FileOutput aria-hidden="true" /> {noteRelease ? 'Release again' : 'Release to the referral desk'}
                  </button>
                )}
                {a.canAddToNote && (
                  <button type="button" className="btn btn-secondary" onClick={() => setDialog('addition')}>
                    Add a correction or addition
                  </button>
                )}
              </div>
            )}
            {signed && noteRelease && a.canRelease && <p className="hint">Released {formatDateTime(noteRelease.at)} by {noteRelease.byName}. A change added since is in the PDF only after releasing it again.</p>}
          </>
        )
      )}
      {dialog === 'addition' && (
        <TextDialog
          id="ref-addition"
          title="Add to the signed note"
          text="The signed note does not change; this is added below it, with your name and the time."
          label="Correction or addition"
          okLabel="Add it"
          max={1000}
          onCancel={() => setDialog(null)}
          onSave={async (text) => {
            const res = await api(`/referrals/${r.id}/note/additions`, { method: 'POST', body: { text } });
            setDialog(null);
            onDone(res, 'Added to the note. Release it again so the doctor gets the new PDF.');
          }}
        />
      )}
      {dialog === 'release' && (
        <ReleasePreview
          r={r}
          kind="note"
          title="Consultant note – print preview"
          docKey={`${r.id}-${note.rev}`}
          onClose={() => setDialog(null)}
          onReleased={(res, message) => {
            setDialog(null);
            onDone(res, message);
          }}
        >
          <NoteDocument r={r} letterhead={letterhead} />
        </ReleasePreview>
      )}
    </section>
  );
}

/** The confirmed discharge card, as printed (DocumentPage's own layout), released as a PDF. Clinicians only. */
function DischargeRelease({ r, letterhead, onDone, onClose }) {
  const { user } = useAuth();
  const d = r.discharge;
  const page = useFetch(`/patients/${r.patient.id}/admissions/${d.admissionId}/documents/${d.documentId}`);
  const patient = useFetch(`/patients/${r.patient.id}`);
  const [printedAt] = useState(() => new Date());
  const ready = Boolean(page.data && patient.data);
  return (
    <ReleasePreview r={r} kind="discharge" title="Discharge card – print preview" ready={ready} docKey={ready ? `${r.id}-discharge-${page.data.document.rev ?? 0}` : null} onClose={onClose} onReleased={onDone}>
      {page.error || patient.error ? (
        <Alert type="error">{page.error || patient.error}</Alert>
      ) : ready ? (
        <DocPrintDocument patient={patient.data.patient} page={page.data} letterhead={letterhead} printedAt={printedAt} printedByName={user.name} />
      ) : (
        <p className="muted">Loading…</p>
      )}
    </ReleasePreview>
  );
}

function DischargeCard({ r, letterhead, onDone, primary }) {
  const a = r.access ?? {};
  const [releasing, setReleasing] = useState(false);
  if (!r.discharge) return null;
  const current = (r.releases ?? []).find((x) => x.kind === 'discharge' && !x.superseded);
  return (
    <section className="card" aria-labelledby="ref-discharge-title">
      <h2 id="ref-discharge-title">
        <FileText aria-hidden="true" /> Discharge summary
      </h2>
      <p>
        Discharged {formatDateTime(r.discharge.dischargedAt)}. The guide promises the discharge summary within 24 hours – it goes only with her Yes.
      </p>
      {current && (
        <p className="hint">
          Released {formatDateTime(current.at)} by {current.byName}.
        </p>
      )}
      {a.canRelease && r.patient && (
        <button type="button" className={btn(primary)} onClick={() => setReleasing(true)}>
          <FileOutput aria-hidden="true" /> {current ? 'Release the discharge card again' : 'Release the discharge card'}
        </button>
      )}
      {releasing && (
        <DischargeRelease
          r={r}
          letterhead={letterhead}
          onClose={() => setReleasing(false)}
          onDone={(res, message) => {
            setReleasing(false);
            onDone(res, message);
          }}
        />
      )}
    </section>
  );
}

const PDF_CARE = 'Delete the file from this computer once it is sent.';

function PdfsCard({ r, onDone, primary, busy, setBusy }) {
  const a = r.access ?? {};
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const releases = r.releases ?? [];
  if (!releases.length) return null;
  const answer = r.sharing?.answer;
  // The desk saves a PDF only after her recorded Yes (the server refuses it otherwise): sending is done by hand from
  // the desk's phone, so the file itself is what is held back. Her doctor and the RMOs (canReview: those who may open
  // her record) may save it to check it.
  const maySave = answer === 'yes' || (answer !== 'no' && a.canReview);
  const sentFor = (fileId) => (r.messages ?? []).filter((m) => m.releaseFileId === fileId);
  const firstUnsent = releases.find((x) => !x.superseded && !sentFor(x.id).length)?.id;
  const save = async (x) => {
    setError(null);
    setNotice(null);
    setBusy(`save-${x.id}`);
    try {
      const { blob } = await apiFile(`/referrals/${r.id}/releases/${x.id}`);
      downloadFile(blob, x.fileName);
      setNotice(`Saved “${x.fileName}” in the Downloads folder. In the chat with ${r.referringDoctor?.name}, attach it (the paperclip, then Document), check it is the right patient and press Send. ${PDF_CARE}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  const markSent = async (x) => {
    setError(null);
    setBusy(`sent-${x.id}`);
    try {
      onDone(await api(`/referrals/${r.id}/messages`, { method: 'POST', body: { what: x.kind, releaseFileId: x.id } }), `The ${RELEASE_LABELS[x.kind].toLowerCase()} is marked as sent.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="card" aria-labelledby="ref-pdfs-title">
      <h2 id="ref-pdfs-title">PDFs for the referring doctor</h2>
      {answer === 'no' && <Alert type="info">She did not agree: the consultant note and the discharge summary are not sent to her doctor.</Alert>}
      {!answer && <Alert type="warning">Her answer is not recorded yet. Send these only after her Yes (Her agreement, above).</Alert>}
      <Alert type="error">{error}</Alert>
      <Alert type="success" onClose={() => setNotice(null)}>
        {notice}
      </Alert>
      <ul className="wl-list">
        {releases.map((x) => {
          const sent = sentFor(x.id);
          return (
            <li key={x.id}>
              <div className="wl-row-head">
                <span className="wl-who">
                  <strong>{RELEASE_LABELS[x.kind]}</strong>
                  <span className="muted tabular">
                    {x.fileName} · {fileSize(x.size)} · released by {x.byName}, {formatDateTime(x.at)}
                  </span>
                </span>
                <span className="wl-counts">
                  {x.superseded ? (
                    <StatusPill tone="inactive">Replaced by a newer PDF</StatusPill>
                  ) : sent.length ? (
                    <StatusPill tone="stable" icon={Check}>
                      Sent
                    </StatusPill>
                  ) : answer === 'no' ? (
                    <StatusPill tone="inactive">Not sent – she did not agree</StatusPill>
                  ) : !answer ? (
                    <StatusPill tone="watch" icon={Hourglass}>
                      Waiting for her Yes
                    </StatusPill>
                  ) : (
                    <StatusPill tone="due" icon={Send}>
                      To send
                    </StatusPill>
                  )}
                </span>
              </div>
              {sent.map((m) => (
                <p key={m.at} className="hint">
                  Sent by {m.byName}, {formatDateTime(m.at)}
                </p>
              ))}
              {!x.superseded && answer !== 'no' && !maySave && <p className="hint">Ask her first: the PDF is saved only after her Yes.</p>}
              {!x.superseded && maySave && (
                <div className="row">
                  <button type="button" className={btn(primary && x.id === firstUnsent)} onClick={() => save(x)} disabled={busy === `save-${x.id}`}>
                    <FileDown aria-hidden="true" /> {busy === `save-${x.id}` ? 'Saving…' : 'Save the PDF'}
                  </button>
                  {answer === 'yes' && a.canMarkSent && (
                    <>
                      <ChatLink doctor={r.referringDoctor} />
                      <button type="button" className="btn btn-secondary" onClick={() => markSent(x)} disabled={busy === `sent-${x.id}`}>
                        <Send aria-hidden="true" /> {busy === `sent-${x.id}` ? 'Saving…' : sent.length ? 'Mark as sent again' : 'Mark as sent'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {answer === 'yes' && <NoNumber doctor={r.referringDoctor} />}
    </section>
  );
}

// ---------- What the doctor sent, messages, reviews ----------

function AttachmentsCard({ r, onDone, busy, setBusy }) {
  const a = r.access ?? {};
  const input = useRef(null);
  const [error, setError] = useState(null);
  const list = r.attachments ?? [];
  const sent = SENT_FIELDS.map((f) => [f.label, r.sent?.[f.key]]).filter(([, v]) => v);
  const upload = async (file) => {
    if (!file) return;
    const problem = fileProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy('attach');
    setError(null);
    try {
      onDone(await api(`/referrals/${r.id}/attachments`, { method: 'POST', body: await fileBody(file) }), `“${file.name}” is attached.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  };
  const save = async (x) => {
    setError(null);
    setBusy(`file-${x.id}`);
    try {
      const { blob } = await apiFile(`/referrals/${r.id}/attachments/${x.id}`);
      downloadFile(blob, x.fileName);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="card" aria-labelledby="ref-files-title">
      <h2 id="ref-files-title">
        <Paperclip aria-hidden="true" /> What the doctor sent
      </h2>
      {sent.length ? <Facts compact rows={sent} /> : <p className="muted">No dates, BP, Hb, sugar, medicines or scans written down.</p>}
      <Alert type="error">{error}</Alert>
      {list.length ? (
        <ul className="wl-list">
          {list.map((x) => (
            <li key={x.id} className="wl-row-head">
              <span className="wl-who">
                <strong>{x.fileName}</strong>
                <span className="muted tabular">
                  {fileSize(x.size)} · added by {x.byName}, {formatDateTime(x.at)}
                </span>
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => save(x)} disabled={busy === `file-${x.id}`}>
                <FileDown aria-hidden="true" /> {busy === `file-${x.id}` ? 'Saving…' : 'Save a copy'}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No file attached.</p>
      )}
      {a.canAttach && list.length < 10 && (
        <>
          <label className="btn btn-secondary" htmlFor="ref-attach">
            <Paperclip aria-hidden="true" /> {busy === 'attach' ? 'Attaching…' : 'Attach a file'}
          </label>
          <input id="ref-attach" ref={input} className="sr-only" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy === 'attach'} onChange={(e) => upload(e.target.files?.[0])} />
          <p className="hint">The doctor’s note, a report or a scan: a PDF or a photo, at most 5 MB; up to 10 files.</p>
        </>
      )}
    </section>
  );
}

function MessagesCard({ r, onDone, busy, setBusy }) {
  const a = r.access ?? {};
  const [error, setError] = useState(null);
  const list = r.messages ?? [];
  if (!list.length && !a.canMarkSent) return null;
  const other = async () => {
    setBusy('other');
    setError(null);
    try {
      onDone(await api(`/referrals/${r.id}/messages`, { method: 'POST', body: { what: 'other' } }), 'Another message is recorded as sent.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="card" aria-labelledby="ref-messages-title">
      <h2 id="ref-messages-title">
        <MessageCircle aria-hidden="true" /> Messages sent to the doctor
      </h2>
      <Alert type="error">{error}</Alert>
      {list.length ? (
        <ul className="plain-list link-list">
          {list.map((m) => (
            <li key={`${m.what}-${m.at}`}>
              <strong>{MESSAGE_LABELS[m.what] ?? m.what}</strong> <span className="muted">– {m.byName}, {formatDateTime(m.at)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">None yet.</p>
      )}
      {a.canMarkSent && r.status === 'open' && (
        <button type="button" className="btn btn-link btn-sm" onClick={other} disabled={busy === 'other'}>
          {busy === 'other' ? 'Saving…' : 'Record another message sent'}
        </button>
      )}
    </section>
  );
}

function PromisesCard({ r, now }) {
  const promises = r.promises ?? [];
  return (
    <section className="card" aria-labelledby="ref-promises-title">
      <h2 id="ref-promises-title">The promises to the doctor</h2>
      {r.status === 'cancelled' ? (
        <p className="muted">A cancelled referral has no clocks.</p>
      ) : promises.length ? (
        <ul className="wl-list">
          {promises.map((p) => (
            <li key={p.key} className="wl-row-head">
              <span className="wl-who">
                <strong>{promiseLabel(p)}</strong>
                <span className="muted tabular">{promiseWhen(p, now)}</span>
              </span>
              <PromisePill promise={p} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No clocks yet.</p>
      )}
    </section>
  );
}

function ReviewsCard({ r, onDone }) {
  const a = r.access ?? {};
  const [writing, setWriting] = useState(false);
  const reviews = r.reviews ?? [];
  const missed = (r.promises ?? []).some((p) => MISSED_STATES.includes(p.state));
  if (!reviews.length && !(a.canReview && missed)) return null;
  return (
    <section className="card" aria-labelledby="ref-reviews-title">
      <h2 id="ref-reviews-title">Weekly review</h2>
      {reviews.length ? (
        <ul className="wl-list">
          {reviews.map((v) => (
            <li key={v.at}>
              <strong>{promiseLabel({ key: v.promise })}</strong> <span className="muted">– {v.byName}, {formatDateTime(v.at)}</span>
              <Facts
                rows={[
                  ['What went wrong', v.wentWrong],
                  ['What changed', v.changed],
                ]}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">A promise was missed: the guide asks for a review within the week.</p>
      )}
      {a.canReview && missed && (
        <button type="button" className="btn btn-secondary" onClick={() => setWriting(true)}>
          Write the review
        </button>
      )}
      {writing && (
        <ReviewDialog
          referral={r}
          promises={r.promises ?? []}
          onCancel={() => setWriting(false)}
          onSaved={(res) => {
            setWriting(false);
            onDone(res, 'The review is saved.');
          }}
        />
      )}
    </section>
  );
}

// ---------- The page ----------

export function ReferralPage() {
  const { referralId } = useParams();
  const location = useLocation();
  const { activeMembership } = useAuth();
  const { data, error, reload } = useFetch(`/referrals/${referralId}`);
  const view = useFetch('/referrals/settings-view');
  const lh = useFetch('/tenant/settings/letterhead');
  const [current, setCurrent] = useState(null);
  const [notice, setNotice] = useState(location.state?.flash ?? null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [editing, setEditing] = useState(null); // { form, guest } while the details are edited
  const [editFields, setEditFields] = useState({});
  const [dialog, setDialog] = useState(null); // 'close' | 'cancel'
  const now = useNow();
  const editDoctors = useFetch(editing ? '/referring-doctors' : null, { active: 'true' });

  // A new answer from the server replaces what is shown; a reload shows the server's copy again
  useEffect(() => setCurrent(null), [data]);
  // (only this referral's: while another one opened from here loads, the last one is not shown)
  const shown = (x) => (x?.id === referralId ? x : null);
  const r = shown(current) ?? shown(data?.referral);
  const letterhead = lh.data?.letterhead ?? { name: activeMembership?.tenantName };
  const hospitalName = activeMembership?.tenantName;
  const doctors = view.data?.doctors ?? [];

  const header = (
    <PageHeader
      breadcrumbs={[{ label: 'Referrals', to: '/referrals' }, { label: r?.number ?? 'Referral' }]}
      title={r ? `Referral ${r.number}` : 'Referral'}
      documentTitle="Referral"
      badges={
        r && (
          <>
            <StatusPill tone={statusLook(r).tone} icon={statusLook(r).icon}>
              {statusLook(r).word}
            </StatusPill>
            <StatusPill tone={urgencyLook(r).tone} icon={urgencyLook(r).icon}>
              {urgencyLook(r).word}
            </StatusPill>
          </>
        )
      }
    />
  );
  if (error && !r) {
    return (
      <>
        {header}
        <div className="pf-content">
          <Alert type="error">{error}</Alert>
          <Link to="/referrals">Back to the referrals</Link>
        </div>
      </>
    );
  }
  if (!r) {
    return (
      <>
        {header}
        <div className="pf-content">
          <p className="muted">Loading…</p>
        </div>
      </>
    );
  }

  const a = r.access ?? {};
  const open = r.status === 'open';
  // (without a referral in the answer, it is loaded again; what is on screen stays until it comes)
  const applied = (res, message) => {
    if (res?.referral) setCurrent(res.referral);
    else reload();
    setNotice(message ?? null);
    setActionError(null);
  };
  // Someone changed it meanwhile: the server's copy is loaded again. Until it comes, the referral as last shown stays
  // on screen – never the copy of the first page load, which may be several steps old.
  const stale = () => reload();

  // The one primary button of the page: the next step of the guide's promises that this person can take
  // (booking first: a guest can be booked before she is registered, and the reply needs her appointment – but never
  // once she has been seen: then the reply tells her doctor when she was seen)
  const noteReleased = (r.releases ?? []).some((x) => x.kind === 'note' && !x.superseded);
  const step = (() => {
    if (!open) return null;
    if (a.canBook && !r.firstSeen) return 'book';
    if (a.canMarkSent && r.waiting?.reply && r.replyText) return 'reply';
    if (a.canLink && !r.patient) return 'patient';
    if (a.canWriteNote && r.note?.status !== 'signed' && r.firstSeen) return 'note';
    if (a.canRelease && r.waiting?.release) return r.note?.status === 'signed' && !noteReleased ? 'note' : 'discharge';
    if (a.canMarkSent && r.waiting?.send) return 'send';
    return null;
  })();

  // The time it came and its urgency are fixed once the reply is sent, she has been seen or a promise is late (the
  // server refuses a change then – 409 FROZEN): the clocks ran from them, and moving them would hide a miss
  const frozen = Boolean((r.messages ?? []).some((m) => m.what === 'reply') || r.firstSeen || (r.promises ?? []).some((p) => MISSED_STATES.includes(p.state)));
  // Cancelling is only for a referral logged by mistake, before anything happened (409 NOT_CANCELLABLE otherwise):
  // after that it is closed, and any missed promise stays on record
  const cancellable = !(r.messages ?? []).length && !r.firstSeen && !(r.promises ?? []).some((p) => MISSED_STATES.includes(p.state));

  const startEdit = () => {
    setEditFields({});
    const form = intakeForm(r, view.data);
    // receivedFrom: the time as the form first showed it (to the minute) – unchanged, the stored time is sent back
    // exactly, so an edit of other details never reads as a change of when it came
    setEditing({ form, receivedFrom: form.receivedAt, guest: { name: r.guest?.name ?? '', phone: r.guest?.phone ?? '', ageYears: r.guest?.ageYears != null ? String(r.guest.ageYears) : '' } });
  };
  const saveEdit = async () => {
    const { form, guest, receivedFrom } = editing;
    if (intakeHasFetalSex(form, r.patient ? null : guest)) return setActionError(PCPNDT_MESSAGE);
    setBusy('edit');
    setActionError(null);
    setEditFields({});
    try {
      const intake = intakeBody(form);
      if (form.receivedAt === receivedFrom) intake.receivedAt = r.receivedAt;
      const res = await api(`/referrals/${r.id}`, { method: 'PUT', body: { rev: r.rev, ...intake, ...(r.patient ? {} : { guest: guestBody(guest) }) } });
      setEditing(null);
      applied(res, 'The referral details are saved.');
    } catch (err) {
      setActionError(err.message);
      setEditFields(err.fields ?? {});
      if (err.status === 409 && err.code === 'FROZEN') {
        // The form stays open with the other changes; the time and urgency go back to what is stored
        setActionError(`${err.message} The time and urgency are put back – save again to keep your other changes.`);
        setEditing((e) => (e ? { ...e, form: { ...e.form, receivedAt: e.receivedFrom, urgency: r.urgency } } : e));
        stale();
      } else if (err.status === 409) {
        setEditing(null);
        stale();
      }
    } finally {
      setBusy(null);
    }
    return undefined;
  };

  const doctor = r.referringDoctor ?? {};
  const doctorNumber = whatsappNumber(doctor.phone);
  const reasons = (r.reasons ?? []).map((x) => x.label ?? x).join(', ');
  return (
    <>
      {header}
      <div className="pf-content">
        <Link to="/referrals" className="btn btn-link btn-sm">
          <ArrowLeft aria-hidden="true" /> Referrals
        </Link>
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
        <Alert type="error">{actionError}</Alert>

        {editing ? (
          <>
            {frozen && <Alert type="info">The time it came and its urgency are fixed now: the reply is sent, she has been seen or a promise is late. The other details can still be corrected.</Alert>}
            {!r.patient && (
              <section className="card form-section" aria-labelledby="ref-edit-guest-title">
                <h2 id="ref-edit-guest-title">The patient (not registered yet)</h2>
                <GuestFields guest={editing.guest} setGuest={(fn) => setEditing((e) => ({ ...e, guest: typeof fn === 'function' ? fn(e.guest) : fn }))} fields={editFields} idPrefix="ref-edit" />
              </section>
            )}
            <IntakeFields
              form={editing.form}
              setForm={(fn) => setEditing((e) => ({ ...e, form: typeof fn === 'function' ? fn(e.form) : fn }))}
              view={view.data}
              doctors={editDoctors.data?.doctors ?? []}
              current={r.referringDoctor}
              fields={editFields}
              idPrefix="ref-edit"
            />
            <div className="sticky-actions">
              <button type="button" className="btn btn-primary" onClick={saveEdit} disabled={busy === 'edit'}>
                {busy === 'edit' ? 'Saving…' : 'Save the details'}
              </button>
              <button type="button" className="btn btn-link" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="panel-grid">
              <div className="vs-page">
                <section className="card" aria-labelledby="ref-details-title">
                  <div className="plan-card-head">
                    <h2 id="ref-details-title">From {doctor.name}</h2>
                    {a.canEdit && open && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={startEdit} disabled={!view.data}>
                        <Pencil aria-hidden="true" /> Edit
                      </button>
                    )}
                  </div>
                  <Facts
                    compact
                    rows={[
                      ['Doctor', [doctor.qualification, doctor.clinic].filter(Boolean).join(' · ')],
                      ['WhatsApp', doctorNumber ? showWhatsappNumber(doctorNumber) : doctor.phone || 'Not given'],
                      ['Received', `${formatDateTime(r.receivedAt)} · ${VIA_LABELS[r.via] ?? r.via}`],
                      ['Centre', r.centreName ?? r.centre],
                      ['Consultant', r.consultant ? `${r.consultant.name}${r.consultant.directLine ? ` · ${r.consultant.directLine}` : ''}` : 'Not chosen yet'],
                      ['Reasons', [reasons, r.otherReason].filter(Boolean).join(', ')],
                      ['The question', r.question],
                      ['Logged', r.created ? `${r.created.byName}, ${formatDateTime(r.created.at)}` : ''],
                      ['First seen', r.firstSeen ? `${formatDateTime(r.firstSeen.at)}${r.firstSeen.onAdmission ? ' · on admission' : ''}` : ''],
                      ['Closed', r.closed ? `${r.closed.byName}, ${formatDateTime(r.closed.at)}${r.closed.reason ? ` – ${r.closed.reason}` : ''}` : ''],
                      ['Cancelled', r.cancelled ? `${r.cancelled.byName}, ${formatDateTime(r.cancelled.at)}${r.cancelled.reason ? ` – ${r.cancelled.reason}` : ''}` : ''],
                    ]}
                  />
                </section>
                <AttachmentsCard r={r} onDone={applied} busy={busy} setBusy={setBusy} />
              </div>
              <div className="vs-page">
                <PromisesCard r={r} now={now} />
                <PatientCard r={r} doctors={doctors} onDone={applied} primary={step === 'patient'} />
                <AppointmentCard r={r} doctors={doctors} onDone={applied} onStale={stale} primary={step === 'book'} />
                {open && <ReplyCard r={r} onDone={applied} primary={step === 'reply'} busy={busy} setBusy={setBusy} />}
                {r.patient && <SharingCard r={r} onDone={applied} busy={busy} setBusy={setBusy} />}
                {r.patient && <NoteCard r={r} hospitalName={hospitalName} letterhead={letterhead} onDone={applied} onFailed={stale} primary={step === 'note'} />}
                <DischargeCard r={r} letterhead={letterhead} onDone={applied} primary={step === 'discharge'} />
                <PdfsCard r={r} onDone={applied} primary={step === 'send'} busy={busy} setBusy={setBusy} />
                <MessagesCard r={r} onDone={applied} busy={busy} setBusy={setBusy} />
                <ReviewsCard r={r} onDone={applied} />
                {a.canClose && open && (
                  <section className="card" aria-labelledby="ref-close-title">
                    <h2 id="ref-close-title">Close the referral</h2>
                    <p className="hint">
                      Close it when the work is done or she went elsewhere: a promise whose clock has started keeps running, and a missed one stays on record.{' '}
                      {cancellable ? 'Cancel it only when it was logged by mistake, before anything happened: a cancelled referral has no clocks.' : 'It can no longer be cancelled: a message was sent, she was seen or a promise is late.'}
                    </p>
                    <div className="row">
                      <button type="button" className="btn btn-secondary" onClick={() => setDialog('close')}>
                        Close the referral
                      </button>
                      {cancellable && (
                        <button type="button" className="btn btn-link" onClick={() => setDialog('cancel')}>
                          Cancel the referral
                        </button>
                      )}
                    </div>
                  </section>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      {dialog === 'close' && (
        <TextDialog
          id="ref-close"
          title={`Close ${r.number}`}
          label="Why is it closed? (e.g. all promises kept, she chose another hospital)"
          okLabel="Close the referral"
          onCancel={() => setDialog(null)}
          onSave={async (reason) => {
            const res = await api(`/referrals/${r.id}/close`, { method: 'POST', body: { reason } });
            setDialog(null);
            applied(res, 'The referral is closed.');
          }}
        />
      )}
      {dialog === 'cancel' && (
        <TextDialog
          id="ref-cancel"
          title={`Cancel ${r.number}`}
          text="A cancelled referral has no promises and stays in the list of closed referrals."
          label="Why is it cancelled?"
          okLabel="Cancel the referral"
          danger
          onCancel={() => setDialog(null)}
          onSave={async (reason) => {
            try {
              const res = await api(`/referrals/${r.id}/cancel`, { method: 'POST', body: { reason } });
              setDialog(null);
              applied(res, 'The referral is cancelled.');
            } catch (err) {
              // Something happened on it meanwhile (409 NOT_CANCELLABLE): the dialog shows the server's words – close
              // it instead – and the referral is loaded again
              if (err.code === 'NOT_CANCELLABLE') stale();
              throw err;
            }
          }}
        />
      )}
    </>
  );
}
