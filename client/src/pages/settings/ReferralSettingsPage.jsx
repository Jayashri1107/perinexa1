import { useEffect, useState } from 'react';
import { AlarmClock, Building2, CalendarClock, CalendarOff, Phone, PhoneCall, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../../api.js';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, FieldError, formatDate } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { moduleByKey } from '../../platform/modules.js';
import { WEEKDAYS, WEEK_ORDER, timeLabel } from '../appointments/appointmentFormat.js';

// Hospital admin → Referrals (docs/REFERRALS_PLAN.md): the settings the referral desk works with – the centres a
// referred patient can be seen at, the desk's own number, the consultants' direct lines (the guide's "a consultant you
// can call"), the working hours and holidays the 2-hour reply clock counts, and the times for urgent referrals.
// Never a referral: those are patient data, and the hospital admin sees none. Real numbers are entered here by the
// admin, never put in the code. Everyone in the hospital can read these settings (the desk and the slip need them);
// only the hospital admin changes them, so the page is read-only for anyone else.

// Each referral keeps the key of its centre, so a saved centre keeps its key when renamed. A new centre gets one from
// its name ("Waluj" → "waluj"; 2 to 30 small letters, digits or _, as the server checks). A centre that has referrals
// cannot be taken off the list (the server says so) – it is marked not in use instead.
function centreKey(name, taken) {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
  if (base.length < 2) base = `centre${base ? `_${base}` : ''}`;
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base.slice(0, 30 - String(n).length - 1)}_${n}`;
  return key;
}

const todayIso = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

// The form also marks the centres added since the last save (they get their key when saved).
const toForm = (settings) => ({
  ...settings,
  centres: (settings.centres ?? []).map((c) => ({ ...c, isNew: false })),
  consultantLines: (settings.consultantLines ?? []).map((l) => ({ ...l })),
  holidays: (settings.holidays ?? []).map((h) => ({ ...h })),
  workingHours: { ...settings.workingHours, days: [...(settings.workingHours?.days ?? [])] },
});

// Exactly the shape the server keeps: new centres get their key from their name.
function toBody(form) {
  const taken = new Set(form.centres.filter((c) => !c.isNew).map((c) => c.key));
  const centres = form.centres.map((c) => {
    if (!c.isNew) return { key: c.key, name: c.name, active: c.active };
    const key = centreKey(c.name, taken);
    taken.add(key);
    return { key, name: c.name, active: c.active };
  });
  return {
    centres,
    deskNumber: form.deskNumber,
    consultantLines: form.consultantLines.map((l) => ({ userId: l.userId, phone: l.phone, note: l.note })),
    workingHours: { days: [...form.workingHours.days].sort((a, b) => a - b), from: form.workingHours.from, to: form.workingHours.to },
    holidays: form.holidays.map((h) => ({ on: h.on, note: h.note })),
    urgentCutoff: form.urgentCutoff,
    urgentNextMorning: form.urgentNextMorning,
  };
}

// The server's messages for fields this page shows next to their field or row; anything else is listed under the error.
const SHOWN_FIELDS = /^(centres|consultantLines|holidays)(\.\d+(\..+)?)?$|^(deskNumber|workingHours(\.(days|from|to))?|urgentCutoff|urgentNextMorning)$/;

export function ReferralSettingsPage() {
  const { data, error: loadError, reload } = useFetch('/tenant/settings/referrals');
  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  // The saved settings (on opening, and again after "Undo my changes")
  useEffect(() => {
    if (!data) return;
    setForm(toForm(data.settings));
    setDirty(false);
  }, [data]);

  const canEdit = Boolean(data?.canEdit);
  const doctors = data?.doctors ?? [];
  const doctorName = (userId) => doctors.find((d) => d.id === userId)?.name ?? 'A doctor no longer working here';

  const header = (
    <PageHeader
      breadcrumbs={[{ label: 'Hospital admin' }, { label: 'Referrals' }]}
      title="Referral settings"
      help="What the referral desk works with: centres, the desk number, consultants' direct lines, working hours, holidays and the times for urgent referrals. Referrals themselves are not shown here."
      tabs={moduleByKey('hospital-admin').tabs}
      actions={
        canEdit &&
        form && (
          <button type="submit" form="ref-settings" className="btn btn-primary" disabled={saving || !dirty}>
            <Save aria-hidden="true" /> {saving ? 'Saving…' : 'Save settings'}
          </button>
        )
      }
    />
  );

  if (loadError && !data) {
    return (
      <>
        {header}
        <div className="pf-content">
          <div className="card narrow load-error">
            <Alert type="error">Couldn't load the referral settings. {loadError}</Alert>
          </div>
        </div>
      </>
    );
  }
  if (!form) return <FullPageSpinner />;

  // Every change: mark the form changed and clear the last "Saved".
  const change = (next) => {
    setForm(next);
    setDirty(true);
    setSaved(false);
  };
  const setRow = (list, i, key, value) => change({ ...form, [list]: form[list].map((row, j) => (j === i ? { ...row, [key]: value } : row)) });
  const removeRow = (list, i) => change({ ...form, [list]: form[list].filter((_, j) => j !== i) });
  const addRow = (list, row) => change({ ...form, [list]: [...form[list], row] });
  const setHours = (key, value) => change({ ...form, workingHours: { ...form.workingHours, [key]: value } });
  const toggleDay = (day) =>
    setHours('days', form.workingHours.days.includes(day) ? form.workingHours.days.filter((d) => d !== day) : [...form.workingHours.days, day]);
  const err = (key) => fieldErrors[key];
  // The first message about one row of a list (its name, phone, date …)
  const rowErr = (list, i) => Object.entries(fieldErrors).find(([key]) => key === `${list}.${i}` || key.startsWith(`${list}.${i}.`))?.[1];

  const save = async (e) => {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const out = await api('/tenant/settings/referrals', { method: 'PUT', body: toBody(form) });
      setForm(toForm(out.settings));
      setDirty(false);
      setSaved(true);
    } catch (saveError) {
      setError(saveError.message);
      setFieldErrors(saveError.fields ?? {});
    } finally {
      setSaving(false);
    }
  };
  // Start again from what is saved (e.g. after someone else saved at the same time)
  const undoChanges = () => {
    setSaved(false);
    setError(null);
    setFieldErrors({});
    reload();
  };

  const otherErrors = Object.entries(fieldErrors).filter(([key]) => !SHOWN_FIELDS.test(key));
  const freeDoctor = doctors.find((d) => !form.consultantLines.some((l) => l.userId === d.id));

  return (
    <>
      {header}
      <form id="ref-settings" className="pf-content appt-page" onSubmit={save} noValidate>
        <Alert type="success" onClose={() => setSaved(false)}>
          {saved && 'Referral settings saved.'}
        </Alert>
        {error && (
          <Alert type="error" onClose={() => setError(null)}>
            Couldn't save the referral settings. {error}
            {otherErrors.length > 0 && (
              <ul>
                {otherErrors.map(([key, message]) => (
                  <li key={key}>{message}</li>
                ))}
              </ul>
            )}{' '}
            <button type="button" className="btn btn-link plan-inline-link" onClick={undoChanges}>
              Undo my changes
            </button>
          </Alert>
        )}
        {!canEdit && <Alert type="info">Only the hospital admin can change these settings.</Alert>}

        {/* Centres */}
        <section className="card appt-section" aria-labelledby="ref-centres">
          <h2 id="ref-centres">
            <Building2 aria-hidden="true" /> Centres
          </h2>
          <p className="hint">Where a referred patient can be seen. Each referral records its centre, so a centre that has referrals stays on the list: untick In use when it is no longer used.</p>
          {!form.centres.length && <p className="muted">No centres yet.</p>}
          <ul className="opd-leave-list">
            {form.centres.map((c, i) => (
              <li key={c.isNew ? `new-${i}` : c.key}>
                {canEdit ? (
                  <div className="opd-leave">
                    <label className="opd-leave-note">
                      <span className="field-label">Name</span>
                      <input
                        value={c.name}
                        maxLength={60}
                        aria-invalid={rowErr('centres', i) ? true : undefined}
                        aria-describedby={rowErr('centres', i) ? `ref-centre-${i}-error` : undefined}
                        onChange={(e) => setRow('centres', i, 'name', e.target.value)}
                      />
                    </label>
                    <label className="check">
                      <input type="checkbox" checked={c.active} onChange={(e) => setRow('centres', i, 'active', e.target.checked)} /> In use
                    </label>
                    <button type="button" className="icon-btn" onClick={() => removeRow('centres', i)} aria-label={`Remove centre ${i + 1}`}>
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <span>
                    {c.name}
                    {c.active ? '' : ' · not in use'}
                  </span>
                )}
                <FieldError id={`ref-centre-${i}-error`}>{rowErr('centres', i)}</FieldError>
              </li>
            ))}
          </ul>
          {canEdit && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addRow('centres', { key: '', name: '', active: true, isNew: true })}>
              <Plus aria-hidden="true" /> Add a centre
            </button>
          )}
          <FieldError>{err('centres')}</FieldError>
        </section>

        {/* The desk's own number */}
        <section className="card appt-section" aria-labelledby="ref-desk">
          <h2 id="ref-desk">
            <Phone aria-hidden="true" /> Referral desk number
          </h2>
          <p className="hint">The number referring doctors call or message (WhatsApp). Printed on the referral slip.</p>
          {canEdit ? (
            <div className="opd-lengths">
              <label className="opd-length">
                <span className="field-label">Desk number</span>
                <input
                  type="tel"
                  value={form.deskNumber}
                  maxLength={30}
                  aria-invalid={err('deskNumber') ? true : undefined}
                  aria-describedby={err('deskNumber') ? 'ref-desk-error' : undefined}
                  onChange={(e) => change({ ...form, deskNumber: e.target.value })}
                />
              </label>
            </div>
          ) : (
            <p>{form.deskNumber || <span className="muted">Not set</span>}</p>
          )}
          <FieldError id="ref-desk-error">{err('deskNumber')}</FieldError>
        </section>

        {/* Consultants' direct lines */}
        <section className="card appt-section" aria-labelledby="ref-lines">
          <h2 id="ref-lines">
            <PhoneCall aria-hidden="true" /> Consultants' direct lines
          </h2>
          <p className="hint">The number a referring doctor can call to speak to the consultant. Shown to the referral desk and printed on the referral slip.</p>
          {!form.consultantLines.length && <p className="muted">No direct lines yet.</p>}
          <ul className="opd-leave-list">
            {form.consultantLines.map((l, i) => {
              const lineError = rowErr('consultantLines', i);
              return (
                <li key={i}>
                  {canEdit ? (
                    <div className="opd-leave">
                      <label>
                        <span className="field-label">Consultant</span>
                        <select value={l.userId} aria-invalid={err(`consultantLines.${i}.userId`) ? true : undefined} onChange={(e) => setRow('consultantLines', i, 'userId', e.target.value)}>
                          <option value="">Choose a doctor</option>
                          {l.userId && !doctors.some((d) => d.id === l.userId) && <option value={l.userId}>A doctor no longer working here</option>}
                          {doctors.map((d) => (
                            <option key={d.id} value={d.id} disabled={d.id !== l.userId && form.consultantLines.some((x) => x.userId === d.id)}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className="field-label">Phone</span>
                        <input type="tel" value={l.phone} maxLength={30} aria-invalid={err(`consultantLines.${i}.phone`) ? true : undefined} onChange={(e) => setRow('consultantLines', i, 'phone', e.target.value)} />
                      </label>
                      <label className="opd-leave-note">
                        <span className="field-label">Note (optional)</span>
                        <input value={l.note ?? ''} maxLength={100} placeholder="e.g. after 2 pm" onChange={(e) => setRow('consultantLines', i, 'note', e.target.value)} />
                      </label>
                      <button type="button" className="icon-btn" onClick={() => removeRow('consultantLines', i)} aria-label={`Remove direct line ${i + 1}`}>
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  ) : (
                    <span>
                      {doctorName(l.userId)} · {l.phone}
                      {l.note ? ` · ${l.note}` : ''}
                    </span>
                  )}
                  <FieldError>{lineError}</FieldError>
                </li>
              );
            })}
          </ul>
          {canEdit && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addRow('consultantLines', { userId: freeDoctor?.id ?? '', phone: '', note: '' })} disabled={!freeDoctor}>
              <Plus aria-hidden="true" /> Add a direct line
            </button>
          )}
          {canEdit && !doctors.length && <p className="hint">No doctors in this hospital yet: add them under Staff first.</p>}
          <FieldError>{err('consultantLines')}</FieldError>
        </section>

        {/* Working hours: the 2-hour reply clock */}
        <section className="card appt-section" aria-labelledby="ref-hours">
          <h2 id="ref-hours">
            <CalendarClock aria-hidden="true" /> Working hours
          </h2>
          <p className="hint">The reply to a referring doctor is due within 2 working hours. The clock runs only on these days and between these times, and stops on the holidays below.</p>
          {canEdit ? (
            <>
              <fieldset className="fieldset">
                <legend>Working days</legend>
                <div className="check-grid">
                  {WEEK_ORDER.map((day) => (
                    <label key={day} className="check">
                      <input type="checkbox" checked={form.workingHours.days.includes(day)} onChange={() => toggleDay(day)} /> {WEEKDAYS[day]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <FieldError>{err('workingHours.days')}</FieldError>
              <div className="opd-lengths">
                <label className="opd-length">
                  <span className="field-label">From</span>
                  <input type="time" value={form.workingHours.from} aria-invalid={err('workingHours.from') ? true : undefined} onChange={(e) => setHours('from', e.target.value)} />
                </label>
                <label className="opd-length">
                  <span className="field-label">To</span>
                  <input type="time" value={form.workingHours.to} aria-invalid={err('workingHours.to') ? true : undefined} onChange={(e) => setHours('to', e.target.value)} />
                </label>
              </div>
              <FieldError>{err('workingHours.from') ?? err('workingHours.to') ?? err('workingHours')}</FieldError>
            </>
          ) : (
            <p>
              {WEEK_ORDER.filter((day) => form.workingHours.days.includes(day))
                .map((day) => WEEKDAYS[day])
                .join(', ') || 'No working days'}
              {' · '}
              {timeLabel(form.workingHours.from)} – {timeLabel(form.workingHours.to)}
            </p>
          )}
        </section>

        {/* Holidays: the reply clock does not run */}
        <section className="card appt-section" aria-labelledby="ref-holidays">
          <h2 id="ref-holidays">
            <CalendarOff aria-hidden="true" /> Holidays
          </h2>
          <p className="hint">Days the reply clock does not count. Urgent and routine referrals are still to be seen in time on these days.</p>
          {!form.holidays.length && <p className="muted">No holidays entered.</p>}
          <ul className="opd-leave-list">
            {form.holidays.map((h, i) => (
              <li key={i}>
                {canEdit ? (
                  <div className="opd-leave">
                    <label>
                      <span className="field-label">Date</span>
                      <input type="date" value={h.on} aria-invalid={err(`holidays.${i}.on`) ? true : undefined} onChange={(e) => setRow('holidays', i, 'on', e.target.value)} />
                    </label>
                    <label className="opd-leave-note">
                      <span className="field-label">Note (optional)</span>
                      <input value={h.note ?? ''} maxLength={100} placeholder="e.g. Diwali" onChange={(e) => setRow('holidays', i, 'note', e.target.value)} />
                    </label>
                    <button type="button" className="icon-btn" onClick={() => removeRow('holidays', i)} aria-label={`Remove holiday ${i + 1}`}>
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <span>
                    {formatDate(h.on)}
                    {h.note ? ` · ${h.note}` : ''}
                  </span>
                )}
                <FieldError>{rowErr('holidays', i)}</FieldError>
              </li>
            ))}
          </ul>
          {canEdit && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addRow('holidays', { on: todayIso(), note: '' })}>
              <Plus aria-hidden="true" /> Add a holiday
            </button>
          )}
          <FieldError>{err('holidays')}</FieldError>
        </section>

        {/* Urgent referrals: seen the same day */}
        <section className="card appt-section" aria-labelledby="ref-urgent">
          <h2 id="ref-urgent">
            <AlarmClock aria-hidden="true" /> Urgent referrals
          </h2>
          <p className="hint">
            An urgent referral is to be seen before midnight of the day it came. One that comes at or after the cut-off time is to be seen by the next-morning time instead. A
            routine referral is to be seen within 48 hours.
          </p>
          {canEdit ? (
            <div className="opd-lengths">
              <label className="opd-length">
                <span className="field-label">Cut-off time</span>
                <input type="time" value={form.urgentCutoff} aria-invalid={err('urgentCutoff') ? true : undefined} onChange={(e) => change({ ...form, urgentCutoff: e.target.value })} />
              </label>
              <label className="opd-length">
                <span className="field-label">Next morning, seen by</span>
                <input type="time" value={form.urgentNextMorning} aria-invalid={err('urgentNextMorning') ? true : undefined} onChange={(e) => change({ ...form, urgentNextMorning: e.target.value })} />
              </label>
            </div>
          ) : (
            <p>
              Cut-off {timeLabel(form.urgentCutoff)} · next morning by {timeLabel(form.urgentNextMorning)}
            </p>
          )}
          <FieldError>{err('urgentCutoff') ?? err('urgentNextMorning')}</FieldError>
        </section>
      </form>
    </>
  );
}
