import { useEffect, useRef, useState } from 'react';
import { FilePlus2, Search, UserPlus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api, newRequestId } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, FieldError } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';
import { PatientFinder } from '../appointments/AppointmentDialogs.jsx';
import { fromLocalInput, toLocalInput } from '../inpatient/inpatientFormat.js';
import { ReferringDoctorDialog } from './ReferringDoctorsPage.jsx';
import { REASON_GROUPS, SENT_FIELDS, URGENCY_OPTIONS, VIA_OPTIONS, emptySent, textsOf } from './referralFormat.js';

// Logging a referral from another doctor (docs/REFERRALS_PLAN.md): who sent her and when, how soon she must be
// seen, where and by which consultant, the guide's reasons, the question the doctor wants answered and what the
// doctor sent with her (LMP or EDD, gravida and para, BP, Hb, sugar, medicines, scans). She is either found among
// the registered patients or written down with her name, phone and age until she is registered. The desk, doctors
// and RMOs log referrals. The intake fields are shared with the referral page's Edit.

/** The intake fields of a referral, empty, or from a saved referral (fullView). */
export function intakeForm(referral = null, view = null) {
  const firstCentre = view?.centres?.find((c) => c.active !== false)?.key ?? '';
  if (!referral) {
    return { referringDoctorId: '', receivedAt: toLocalInput(new Date()), via: 'whatsapp', urgency: 'routine', centre: firstCentre, reasons: [], otherReason: '', question: '', sent: emptySent(), consultantId: '' };
  }
  return {
    referringDoctorId: referral.referringDoctor?.id ?? '',
    receivedAt: toLocalInput(referral.receivedAt),
    via: referral.via,
    urgency: referral.urgency,
    centre: referral.centre ?? firstCentre,
    reasons: (referral.reasons ?? []).map((r) => r.key ?? r),
    otherReason: referral.otherReason ?? '',
    question: referral.question ?? '',
    sent: { ...emptySent(), ...Object.fromEntries(Object.entries(referral.sent ?? {}).map(([k, v]) => [k, v ?? ''])) },
    consultantId: referral.consultant?.id ?? '',
  };
}

/** What the server is sent for the intake fields. */
export function intakeBody(form) {
  return {
    referringDoctorId: form.referringDoctorId,
    receivedAt: fromLocalInput(form.receivedAt),
    via: form.via,
    urgency: form.urgency,
    centre: form.centre,
    reasons: form.reasons,
    otherReason: form.otherReason.trim(),
    question: form.question.trim(),
    sent: Object.fromEntries(Object.entries(form.sent).map(([k, v]) => [k, v.trim()])),
    consultantId: form.consultantId || null, // empty: no consultant chosen (or cleared)
  };
}

/** Words about the baby's sex anywhere in the typed text (PCPNDT Act): checked before anything is sent. */
export const intakeHasFetalSex = (form, guest = null) => [form.otherReason, form.question, ...textsOf(form.sent), guest?.name ?? ''].some((t) => mentionsFetalSex(t));

/**
 * The intake fields as white cards. view: GET /referrals/settings-view (centres, reasons, the hospital's doctors);
 * doctors: the referring doctors to choose from; current: the referral's own doctor (kept even when inactive).
 */
export function IntakeFields({ form, setForm, view, doctors, current = null, fields = {}, onAddDoctor, idPrefix = 'ref' }) {
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const id = (k) => `${idPrefix}-${k}`;
  const reasons = view?.reasons ?? [];
  // The guide's own group headings, as the server sends them (the list here only if they are missing)
  const groups = (view?.reasonGroups ?? REASON_GROUPS).map((g) => ({ ...g, items: reasons.filter((r) => r.group === g.key) })).filter((g) => g.items.length);
  const toggleReason = (reason) =>
    setForm((f) => {
      const on = f.reasons.includes(reason.key);
      // A reason the guide lists as urgent makes the referral urgent (it can still be changed below)
      return { ...f, reasons: on ? f.reasons.filter((k) => k !== reason.key) : [...f.reasons, reason.key], urgency: !on && reason.group === 'urgent' ? 'urgent' : f.urgency };
    });
  const doctorOptions = current && !doctors.some((d) => d.id === current.id) ? [current, ...doctors] : doctors;
  const centres = (view?.centres ?? []).filter((c) => c.active !== false || c.key === form.centre);
  return (
    <>
      <section className="card form-section" aria-labelledby={id('who-title')}>
        <h2 id={id('who-title')}>Who referred her</h2>
        <div className="form-grid">
          <Field label="Referring doctor" id={id('doctor')} error={fields.referringDoctorId}>
            <select id={id('doctor')} value={form.referringDoctorId} onChange={set('referringDoctorId')}>
              <option value="">Choose the doctor</option>
              {doctorOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.clinic ? ` – ${d.clinic}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Received" id={id('received')} error={fields.receivedAt} hint="When it reached the hospital – the reply clock starts here">
            <input id={id('received')} type="datetime-local" value={form.receivedAt} max={toLocalInput(new Date())} onChange={set('receivedAt')} />
          </Field>
          <Field label="Came by" id={id('via')} error={fields.via}>
            <select id={id('via')} value={form.via} onChange={set('via')}>
              {VIA_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {onAddDoctor && (
          <button type="button" className="btn btn-link btn-sm" onClick={onAddDoctor}>
            <UserPlus aria-hidden="true" /> Add a doctor not in the list
          </button>
        )}
      </section>

      <section className="card form-section" aria-labelledby={id('soon-title')}>
        <h2 id={id('soon-title')}>How soon, where and with whom</h2>
        <fieldset className="fieldset">
          <legend>How soon must she be seen</legend>
          {URGENCY_OPTIONS.map((o) => (
            <label key={o.value} className="checkbox" htmlFor={id(`urgency-${o.value}`)}>
              <input id={id(`urgency-${o.value}`)} type="radio" name={id('urgency')} value={o.value} checked={form.urgency === o.value} onChange={() => setForm((f) => ({ ...f, urgency: o.value }))} />
              {o.label}
            </label>
          ))}
          <p className="hint help">An urgent referral that reaches the hospital after the evening cut-off is seen by the next morning.</p>
        </fieldset>
        <div className="form-grid">
          <Field label="Centre she will be seen at" id={id('centre')} error={fields.centre}>
            <select id={id('centre')} value={form.centre} onChange={set('centre')}>
              {!form.centre && <option value="">Choose the centre</option>}
              {centres.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Consultant" id={id('consultant')} error={fields.consultantId} hint="Named in the reply to the referring doctor">
            <select id={id('consultant')} value={form.consultantId} onChange={set('consultantId')}>
              <option value="">Choose the consultant</option>
              {(view?.doctors ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="card form-section" aria-labelledby={id('why-title')}>
        <h2 id={id('why-title')}>Why she was referred</h2>
        {fields.reasons && <Alert type="error">{fields.reasons}</Alert>}
        {groups.map((g) => (
          <fieldset key={g.key} className="fieldset">
            <legend>{g.label}</legend>
            <div className="check-grid">
              {g.items.map((r) => (
                <label key={r.key} className="checkbox" htmlFor={id(`reason-${r.key}`)}>
                  <input id={id(`reason-${r.key}`)} type="checkbox" checked={form.reasons.includes(r.key)} onChange={() => toggleReason(r)} /> {r.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <Field label="Other reason (optional)" id={id('other')} error={fields.otherReason}>
          <input id={id('other')} maxLength={300} value={form.otherReason} onChange={set('otherReason')} />
        </Field>
        <Field label="The question the doctor wants answered" id={id('question')} error={fields.question} hint="In the doctor’s own words, as on the slip or the message">
          <textarea id={id('question')} rows={3} maxLength={1000} value={form.question} onChange={set('question')} />
        </Field>
      </section>

      <section className="card form-section" aria-labelledby={id('sent-title')}>
        <h2 id={id('sent-title')}>What the doctor sent with her</h2>
        <p className="hint help">As written on the slip or in the message. Leave empty what was not sent.</p>
        <div className="form-grid">
          {SENT_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} id={id(`sent-${f.key}`)} error={fields[`sent.${f.key}`]}>
              <input id={id(`sent-${f.key}`)} maxLength={200} value={form.sent[f.key]} onChange={(e) => setForm((x) => ({ ...x, sent: { ...x.sent, [f.key]: e.target.value } }))} />
            </Field>
          ))}
        </div>
      </section>
    </>
  );
}

/** Her name, phone and age before she is registered (also on the referral page's Edit). */
export function GuestFields({ guest, setGuest, fields = {}, idPrefix = 'ref' }) {
  const set = (k) => (e) => setGuest((g) => ({ ...g, [k]: e.target.value }));
  return (
    <div className="form-grid">
      <Field label="Her name" id={`${idPrefix}-guest-name`} error={fields['guest.name']}>
        <input id={`${idPrefix}-guest-name`} maxLength={150} value={guest.name} onChange={set('name')} />
      </Field>
      <Field label="Phone number" id={`${idPrefix}-guest-phone`} error={fields['guest.phone']}>
        <input id={`${idPrefix}-guest-phone`} type="tel" maxLength={30} value={guest.phone} onChange={set('phone')} />
      </Field>
      <Field label="Age (years)" id={`${idPrefix}-guest-age`} error={fields['guest.ageYears']}>
        <input id={`${idPrefix}-guest-age`} inputMode="numeric" className="tabular" maxLength={3} value={guest.ageYears} onChange={(e) => setGuest((g) => ({ ...g, ageYears: e.target.value.replace(/\D/g, '') }))} />
      </Field>
    </div>
  );
}
export const guestBody = (guest) => ({ name: guest.name.trim(), phone: guest.phone.trim(), ageYears: guest.ageYears === '' ? null : Number(guest.ageYears) });

export function NewReferralPage() {
  const navigate = useNavigate();
  const view = useFetch('/referrals/settings-view');
  const doctorsRes = useFetch('/referring-doctors', { active: 'true' });
  const [extraDoctors, setExtraDoctors] = useState([]); // added here, before the list is loaded again
  const [form, setForm] = useState(null);
  const [mode, setMode] = useState('find'); // find | patient | guest
  const [patient, setPatient] = useState(null);
  const [guest, setGuest] = useState({ name: '', phone: '', ageYears: '' });
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [addingDoctor, setAddingDoctor] = useState(false);
  const requestId = useRef(newRequestId());

  // The form starts once the hospital's centres are known (the first active centre is chosen)
  useEffect(() => {
    if (view.data) setForm((f) => f ?? intakeForm(null, view.data));
  }, [view.data]);
  const doctors = [...extraDoctors.filter((d) => !(doctorsRes.data?.doctors ?? []).some((x) => x.id === d.id)), ...(doctorsRes.data?.doctors ?? [])];

  const save = async (e) => {
    e.preventDefault();
    const problems = {};
    if (!form.referringDoctorId) problems.referringDoctorId = 'Choose the referring doctor (or add the doctor first).';
    if (!form.reasons.length && !form.otherReason.trim()) problems.reasons = 'Tick at least one reason, or write the other reason.';
    if (mode === 'find') problems.patient = 'Find her among the registered patients, or choose “New patient” and write her name.';
    if (mode === 'guest' && guest.name.trim().length < 2) problems['guest.name'] = 'Write her name.';
    if (Object.keys(problems).length) {
      setFields(problems);
      setError('Some details are missing – see the fields marked below.');
      return;
    }
    if (intakeHasFetalSex(form, mode === 'guest' ? guest : null)) {
      setError(PCPNDT_MESSAGE);
      return;
    }
    setSaving(true);
    setError(null);
    setFields({});
    try {
      const body = { clientRequestId: requestId.current, ...intakeBody(form), ...(mode === 'patient' ? { patientId: patient.id } : { guest: guestBody(guest) }) };
      const { referral } = await api('/referrals', { method: 'POST', body });
      navigate(`/referrals/${referral.id}`, { state: { flash: `Referral ${referral.number} saved. Next: book her appointment, then send the reply to the doctor.` } });
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setSaving(false);
    }
  };

  const header = <PageHeader breadcrumbs={[{ label: 'Referrals', to: '/referrals' }, { label: 'New referral' }]} title="New referral" documentTitle="New referral" />;
  if (view.error || doctorsRes.error) {
    return (
      <>
        {header}
        <div className="pf-content">
          <Alert type="error">{view.error || doctorsRes.error}</Alert>
        </div>
      </>
    );
  }
  if (!form || !doctorsRes.data) {
    return (
      <>
        {header}
        <div className="pf-content">
          <p className="muted">Loading…</p>
        </div>
      </>
    );
  }
  return (
    <>
      {header}
      <form className="pf-content form-page" onSubmit={save} noValidate>
        <Alert type="error">{error}</Alert>
        <section className="card form-section" aria-labelledby="ref-patient-title">
          <h2 id="ref-patient-title">The patient</h2>
          {mode !== 'patient' && (
            <div className="segmented" role="group" aria-label="Is she registered">
              <button type="button" aria-pressed={mode === 'find'} onClick={() => setMode('find')}>
                <Search aria-hidden="true" /> Registered patient
              </button>
              <button type="button" aria-pressed={mode === 'guest'} onClick={() => setMode('guest')}>
                <UserPlus aria-hidden="true" /> New patient
              </button>
            </div>
          )}
          {mode === 'find' && (
            <>
              <PatientFinder
                onPick={(p) => {
                  setPatient(p);
                  setMode('patient');
                  setFields((f) => ({ ...f, patient: undefined }));
                }}
              />
              <FieldError id="ref-patient-error">{fields.patient}</FieldError>
            </>
          )}
          {mode === 'patient' && patient && (
            <div className="appt-chosen">
              <strong>{patient.fullName}</strong>
              <span className="muted">
                {patient.mrn}
                {patient.phone ? ` · ${patient.phone}` : ''}
              </span>
              <button type="button" className="btn btn-link btn-sm" onClick={() => setMode('find')}>
                Choose someone else
              </button>
            </div>
          )}
          {mode === 'guest' && (
            <>
              <GuestFields guest={guest} setGuest={setGuest} fields={fields} />
              <p className="hint">Register her from the referral once it is saved (or when she arrives); the referral then joins her record.</p>
            </>
          )}
        </section>
        <IntakeFields form={form} setForm={setForm} view={view.data} doctors={doctors} fields={fields} onAddDoctor={() => setAddingDoctor(true)} />
        <div className="sticky-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <FilePlus2 aria-hidden="true" /> {saving ? 'Saving…' : 'Save the referral'}
          </button>
          <Link to="/referrals" className="btn btn-link">
            Cancel
          </Link>
        </div>
      </form>
      {addingDoctor && (
        <ReferringDoctorDialog
          onCancel={() => setAddingDoctor(false)}
          onSaved={(d) => {
            setExtraDoctors((list) => [d, ...list]);
            setForm((f) => ({ ...f, referringDoctorId: d.id }));
            setAddingDoctor(false);
            doctorsRes.reload();
          }}
        />
      )}
    </>
  );
}
