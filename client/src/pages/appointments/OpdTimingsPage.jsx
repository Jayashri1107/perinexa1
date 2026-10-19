import { useEffect, useState } from 'react';
import { CalendarClock, Copy, Footprints, Plane, Plus, Save, Timer, Trash2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { AppointmentLine, appointmentTabs } from './AppointmentsPage.jsx';
import { VISIT_TYPES, VISIT_TYPE_LABELS, WEEKDAYS, WEEK_ORDER, timeLabel } from './appointmentFormat.js';

// OPD timings (appointment booking): each doctor's sessions for each day of the week and their leave. A doctor sets
// their own; the hospital admin can set anyone's; everyone else who books can look. The sessions are cut into
// 10-minute slots. After saving, bookings that no longer fit (leave, no OPD that day, outside the hours) are listed
// for reception to move. The doctor also chooses how long a visit of each type takes (one slot or more).


const MAX_SESSIONS = 4;
const emptyWeek = () => [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, sessions: [] }));

/** "10:50 and 11:00 kept, then 12:00 and 12:10" – the first two kept groups from 10:00 with 10-minute slots. */
function walkInExample(every, keep) {
  const time = (i) => {
    const m = 10 * 60 + i * 10;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  const group = (g) => Array.from({ length: keep }, (_, k) => time(g * (every + keep) + every + k));
  const words = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0]);
  return `${words(group(0))} kept, then ${words(group(1))}`;
}

export function OpdTimingsPage({ admin = false }) {
  const [params, setParams] = useSearchParams();
  const doctorsRes = useFetch('/appointments/doctors');
  const info = doctorsRes.data;
  const doctors = info?.doctors ?? [];
  const doctorId = params.get('doctor') || (doctors.some((d) => d.id === info?.me) ? info.me : null) || doctors[0]?.id || null;
  const res = useFetch(doctorId ? `/appointments/timings/${doctorId}` : null);
  const [week, setWeek] = useState(emptyWeek);
  const [leave, setLeave] = useState([]);
  const [lengths, setLengths] = useState({});
  const [walkIn, setWalkIn] = useState({ every: 5, keep: 0 });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null); // { affected }

  useEffect(() => {
    if (!res.data) return;
    setWeek(res.data.timings.week.map((w) => ({ day: w.day, sessions: w.sessions.map((s) => ({ ...s })) })));
    setLeave(res.data.timings.leave.map((l) => ({ ...l })));
    setLengths({ ...res.data.timings.lengths });
    setWalkIn({ every: res.data.timings.walkInEvery ?? 5, keep: res.data.timings.walkInKeep ?? 0 });
    setDirty(false);
  }, [res.data]);

  const canEdit = Boolean(res.data?.canEdit);
  const change = (fn) => {
    fn();
    setDirty(true);
    setSaved(null);
  };
  const setSession = (day, i, key, value) =>
    change(() => setWeek((w) => w.map((d) => (d.day === day ? { ...d, sessions: d.sessions.map((s, j) => (j === i ? { ...s, [key]: value } : s)) } : d))));
  const addSession = (day) =>
    change(() =>
      setWeek((w) =>
        w.map((d) => (d.day === day ? { ...d, sessions: [...d.sessions, d.sessions.length ? { from: '17:00', to: '20:00' } : { from: '10:00', to: '13:00' }] } : d)),
      ),
    );
  const removeSession = (day, i) => change(() => setWeek((w) => w.map((d) => (d.day === day ? { ...d, sessions: d.sessions.filter((_, j) => j !== i) } : d))));
  const copyMonday = () => {
    const monday = week.find((d) => d.day === 1).sessions;
    change(() => setWeek((w) => w.map((d) => (d.day >= 2 && d.day <= 6 ? { ...d, sessions: monday.map((s) => ({ ...s })) } : d))));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = { week: week.map((d) => ({ day: d.day, sessions: d.sessions })), leave: leave.map((l) => ({ from: l.from, to: l.to || l.from, note: l.note ?? '' })), lengths, walkInEvery: walkIn.every, walkInKeep: walkIn.keep };
      const out = await api(`/appointments/timings/${doctorId}`, { method: 'PUT', body });
      setSaved({ affected: out.affected ?? [], placed: out.placed ?? 0 });
      res.reload();
      doctorsRes.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const doctor = doctors.find((d) => d.id === doctorId);
  return (
    <>
      <PageHeader
        breadcrumbs={admin ? [{ label: 'Hospital admin', to: '/admin/staff' }, { label: 'OPD timings' }] : [{ label: 'Appointments', to: '/appointments' }, { label: 'OPD timings' }]}
        title="OPD timings"
        subtitle={doctor?.name}
        tabs={admin ? undefined : appointmentTabs(info?.canBook)}
        actions={
          canEdit && (
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
              <Save aria-hidden="true" /> {saving ? 'Saving…' : 'Save timings'}
            </button>
          )
        }
      />
      <div className="pf-content appt-page">
        {doctorsRes.error && <Alert type="error">{doctorsRes.error}</Alert>}
        {res.error && <Alert type="error">{res.error}</Alert>}
        <Alert type="error" onClose={() => setError(null)}>
          {error}
        </Alert>
        {saved && (
          <Alert type={saved.affected.length ? 'warning' : 'success'} onClose={() => setSaved(null)}>
            {[
              'Timings saved.',
              saved.placed ? `${saved.placed} next visit${saved.placed > 1 ? 's' : ''} waiting for a time now ${saved.placed > 1 ? 'have' : 'has'} one.` : '',
              saved.affected.length
                ? `${saved.affected.length} booking${saved.affected.length > 1 ? 's' : ''} no longer fit${saved.affected.length > 1 ? '' : 's'} – listed below for reception to move.`
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
          </Alert>
        )}
        {saved?.affected.length > 0 && (
          <section className="card appt-section" aria-labelledby="opd-affected">
            <h2 id="opd-affected">Bookings to move</h2>
            <ul className="appt-lines">
              {saved.affected.map((a) => (
                <li key={a.id}>
                  <AppointmentLine a={a} canBook={false} showWhen />
                </li>
              ))}
            </ul>
          </section>
        )}

        {doctors.length > 1 && (
          <div className="card appt-toolbar">
            <label className="appt-toolbar-field">
              <span className="field-label">Doctor</span>
              <select value={doctorId ?? ''} onChange={(e) => setParams({ doctor: e.target.value }, { replace: true })} disabled={dirty}>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.hasTimings ? '' : ' (not set yet)'}
                  </option>
                ))}
              </select>
            </label>
            {dirty && <span className="hint">Save or reload before choosing another doctor.</span>}
          </div>
        )}
        {res.data && !canEdit && <Alert type="info">Only {res.data.doctor.name} (or the hospital admin) can change these timings.</Alert>}

        {res.data && (
          <section className="card appt-section" aria-labelledby="opd-week">
            <div className="row-between">
              <h2 id="opd-week">
                <CalendarClock aria-hidden="true" /> Weekly OPD
              </h2>
              {canEdit && (
                <button type="button" className="btn btn-link btn-sm" onClick={copyMonday}>
                  <Copy aria-hidden="true" /> Copy Monday to Tuesday–Saturday
                </button>
              )}
            </div>
            <p className="hint">Patients are booked in {res.data.slotMinutes}-minute slots within these sessions. A day with no session is a day off.</p>
            <div className="opd-week">
              {WEEK_ORDER.map((dayNo) => {
                const d = week.find((w) => w.day === dayNo);
                return (
                  <div key={dayNo} className="opd-day">
                    <span className="opd-day-name">{WEEKDAYS[dayNo]}</span>
                    <div className="opd-sessions">
                      {!d.sessions.length && <span className="muted">No OPD</span>}
                      {d.sessions.map((s, i) =>
                        canEdit ? (
                          <span key={i} className="opd-session">
                            <input type="time" step={600} value={s.from} aria-label={`${WEEKDAYS[dayNo]} session ${i + 1} from`} onChange={(e) => setSession(dayNo, i, 'from', e.target.value)} />
                            <span aria-hidden="true">–</span>
                            <input type="time" step={600} value={s.to} aria-label={`${WEEKDAYS[dayNo]} session ${i + 1} to`} onChange={(e) => setSession(dayNo, i, 'to', e.target.value)} />
                            <button type="button" className="icon-btn" onClick={() => removeSession(dayNo, i)} aria-label={`Remove ${WEEKDAYS[dayNo]} session ${i + 1}`}>
                              <Trash2 aria-hidden="true" />
                            </button>
                          </span>
                        ) : (
                          <span key={i} className="opd-session">
                            {timeLabel(s.from)} – {timeLabel(s.to)}
                          </span>
                        ),
                      )}
                      {canEdit && d.sessions.length < MAX_SESSIONS && (
                        <button type="button" className="btn btn-link btn-sm" onClick={() => addSession(dayNo)}>
                          <Plus aria-hidden="true" /> Add a session
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {res.data && (
          <section className="card appt-section" aria-labelledby="opd-lengths">
            <h2 id="opd-lengths">
              <Timer aria-hidden="true" /> Length of a visit
            </h2>
            <p className="hint">How long each type of visit takes with {res.data.doctor.name}. A longer visit also takes the slots that follow its time.</p>
            <div className="opd-lengths">
              {VISIT_TYPES.map((t) => (
                <label key={t} className="opd-length">
                  <span className="field-label">{VISIT_TYPE_LABELS[t]}</span>
                  {canEdit ? (
                    <select value={lengths[t] ?? res.data.slotMinutes} onChange={(e) => change(() => setLengths((all) => ({ ...all, [t]: Number(e.target.value) })))}>
                      {(res.data.visitLengths ?? [res.data.slotMinutes]).map((n) => (
                        <option key={n} value={n}>
                          {n} minutes
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span>{lengths[t] ?? res.data.slotMinutes} minutes</span>
                  )}
                </label>
              ))}
            </div>
          </section>
        )}

        {res.data && (
          <section className="card appt-section" aria-labelledby="opd-walkin">
            <h2 id="opd-walkin">
              <Footprints aria-hidden="true" /> Slots kept for walk-ins
            </h2>
            <p className="hint">
              Through the whole day, after every few slots open for booking online, the next ones are kept for patients who walk in. They are never offered
              to patients booking online; reception and doctors see them marked Walk-in and can book them.
            </p>
            {canEdit ? (
              <div className="opd-walkin">
                <label className="opd-length">
                  <span className="field-label">Slots open online in a row</span>
                  <select value={walkIn.every} onChange={(e) => change(() => setWalkIn({ ...walkIn, every: Number(e.target.value) }))}>
                    {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="opd-length">
                  <span className="field-label">Then kept for walk-ins</span>
                  <select value={walkIn.keep} onChange={(e) => change(() => setWalkIn({ ...walkIn, keep: Number(e.target.value) }))}>
                    {Array.from({ length: 11 }, (_, n) => (
                      <option key={n} value={n}>
                        {n === 0 ? 'None – all online' : `${n} slot${n > 1 ? 's' : ''}`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
            <p className="opd-walkin-rule">
              {walkIn.keep
                ? `After every ${walkIn.every} slot${walkIn.every > 1 ? 's' : ''} open online, ${walkIn.keep} ${walkIn.keep > 1 ? 'are' : 'is'} kept for walk-ins – e.g. with 10-minute slots from 10:00: ${walkInExample(walkIn.every, walkIn.keep)}.`
                : 'No slots are kept for walk-ins: every slot can be booked online.'}
            </p>
          </section>
        )}

        {res.data && (
          <section className="card appt-section" aria-labelledby="opd-leave">
            <h2 id="opd-leave">
              <Plane aria-hidden="true" /> Leave
            </h2>
            <p className="hint">No bookings on these days. A next visit set for a leave day goes on reception's "Needs a time" list.</p>
            {!leave.length && <p className="muted">No leave planned.</p>}
            <ul className="opd-leave-list">
              {leave.map((l, i) => (
                <li key={i} className="opd-leave">
                  {canEdit ? (
                    <>
                      <label>
                        <span className="field-label">From</span>
                        <input type="date" value={l.from} onChange={(e) => change(() => setLeave((all) => all.map((x, j) => (j === i ? { ...x, from: e.target.value } : x))))} />
                      </label>
                      <label>
                        <span className="field-label">To</span>
                        <input type="date" value={l.to} min={l.from} onChange={(e) => change(() => setLeave((all) => all.map((x, j) => (j === i ? { ...x, to: e.target.value } : x))))} />
                      </label>
                      <label className="opd-leave-note">
                        <span className="field-label">Note (optional)</span>
                        <input value={l.note} maxLength={100} onChange={(e) => change(() => setLeave((all) => all.map((x, j) => (j === i ? { ...x, note: e.target.value } : x))))} />
                      </label>
                      <button type="button" className="icon-btn" onClick={() => change(() => setLeave((all) => all.filter((_, j) => j !== i)))} aria-label={`Remove leave ${i + 1}`}>
                        <Trash2 aria-hidden="true" />
                      </button>
                    </>
                  ) : (
                    <span>
                      {l.from === l.to ? l.from : `${l.from} to ${l.to}`}
                      {l.note ? ` · ${l.note}` : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => change(() => setLeave((all) => [...all, { from: info.today, to: info.today, note: '' }]))}
              >
                <Plus aria-hidden="true" /> Add leave
              </button>
            )}
          </section>
        )}
      </div>
    </>
  );
}
