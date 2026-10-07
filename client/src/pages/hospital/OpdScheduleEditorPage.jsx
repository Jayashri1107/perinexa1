// One doctor's OPD timings: sessions for each day of the week, how long each type of visit takes, and leave.
// Used by the hospital admin (Hospital admin → OPD timings) and by doctors for their own timings (Appointments →
// OPD timings): api, backTo and backLabel say which. Others see the timings read-only (canEdit false).
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { opdTimingsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { WEEK_ORDER, dayName } from '../../utils/weekdays.js';
import { dayText } from '../appointments/appointmentFormat.js';

const NEW_SESSION = { from: '10:00', to: '13:00' };
const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');

// The server's field names ("week.2.sessions", "leave.0.to", "lengths.scan") in plain words.
function describeErrors(fields, payload, visitTypes) {
  return Object.entries(fields ?? {}).map(([key, message]) => {
    const [part, index] = key.split('.');
    if (part === 'week' && payload.week[index]) return `${dayName(payload.week[index].day)}: ${message}`;
    if (part === 'leave') return `Leave ${Number(index) + 1}: ${message}`;
    if (part === 'lengths') return `${visitTypes.find((v) => v.key === index)?.label ?? index}: ${message}`;
    return message;
  });
}

const ADMIN_API = { get: (id) => opdTimingsApi.get(id), save: (id, data) => opdTimingsApi.save(id, data) };

export function OpdScheduleEditorPage({ api = ADMIN_API, backTo = '/hospital/opd-timings', backLabel = 'OPD timings' }) {
  const { doctorId } = useParams();
  const { opd } = useAppConfig();
  const navigate = useNavigate();
  const [schedule, setSchedule] = useState(null);
  const [days, setDays] = useState({}); // day number → sessions
  const [lengths, setLengths] = useState({});
  const [leave, setLeave] = useState([]);
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [canEdit, setCanEdit] = useState(true);
  // bookings from today on that no longer fit the saved timings (reception moves them)
  const [affected, setAffected] = useState(null);

  useEffect(() => {
    api
      .get(doctorId)
      .then(({ schedule: s, canEdit: editable = true }) => {
        setSchedule(s);
        setCanEdit(editable);
        setDays(Object.fromEntries(s.week.map((d) => [d.day, d.sessions])));
        setLengths(s.lengths);
        setLeave(s.leave.map((l) => ({ from: toDateInput(l.from), to: toDateInput(l.to), note: l.note })));
      })
      .catch((err) => setLoadError(err.message));
  }, [doctorId, api]);

  if (loadError) return <Alert type="error">{loadError}</Alert>;
  if (!schedule) return <Loader />;

  const sessionsOf = (day) => days[day] ?? [];
  const setSessions = (day, sessions) => setDays((d) => ({ ...d, [day]: sessions }));
  const updateSession = (day, i, key, value) => setSessions(day, sessionsOf(day).map((s, j) => (j === i ? { ...s, [key]: value } : s)));
  const copyToAll = (day) => {
    const source = sessionsOf(day);
    const weekdays = WEEK_ORDER.filter((d) => d !== 0); // Monday to Saturday; Sunday is left as it is
    setDays((all) => ({ ...all, ...Object.fromEntries(weekdays.map((d) => [d, source.map((s) => ({ ...s }))])) }));
  };
  const updateLeave = (i, key, value) => setLeave((all) => all.map((l, j) => (j === i ? { ...l, [key]: value } : l)));

  const save = async (e) => {
    e.preventDefault();
    const payload = {
      week: WEEK_ORDER.filter((d) => sessionsOf(d).length).map((d) => ({ day: d, sessions: sessionsOf(d) })),
      lengths: Object.fromEntries(Object.entries(lengths).map(([k, v]) => [k, Number(v)])),
      leave,
    };
    setSaving(true);
    setErrors([]);
    try {
      const result = await api.save(doctorId, payload);
      if (result?.affected?.length) setAffected(result.affected);
      else navigate(backTo);
    } catch (err) {
      const details = describeErrors(err.fields, payload, opd.visitTypes);
      setErrors(details.length ? details : [err.message]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} noValidate>
      <PageHeader
        back={<Link to={backTo} className="back-link"><ArrowLeft size={16} aria-hidden /> {backLabel}</Link>}
        title={schedule.doctor.name}
        subtitle={schedule.updatedAt ? `Last changed ${formatDateTime(schedule.updatedAt)} by ${schedule.updatedByName ?? 'an admin'}` : 'No timings yet'}
        actions={
          canEdit && (
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save timings'}
            </button>
          )
        }
      />
      {errors.length > 0 && (
        <Alert type="error">
          {errors.map((m) => <div key={m}>{m}</div>)}
        </Alert>
      )}

      {!canEdit && <Alert type="info">Each doctor sets their own OPD timings (or the hospital admin does). You can look at them here.</Alert>}
      {affected && (
        <Alert type="info">
          Saved. {affected.length} booking{affected.length === 1 ? ' does' : 's do'} not fit the new timings – move {affected.length === 1 ? 'it' : 'them'} from the Day page:
          <ul className="plain-list tight">
            {affected.slice(0, 20).map((a) => (
              <li key={a.id}>{dayText(a.date)} {a.start} – {a.patient?.name ?? a.guest?.name}</li>
            ))}
          </ul>
          <Link to={backTo}>Done</Link>
        </Alert>
      )}

      <fieldset className="plain-fieldset" disabled={!canEdit}>
        <section className="card">
          <h2>Weekly OPD sessions</h2>
          <p className="muted small">A day with no sessions is a day off. At most {opd.maxSessionsPerDay} sessions a day; sessions must not overlap.</p>
          <div className="week-grid">
            {WEEK_ORDER.map((day) => (
              <div key={day} className="week-row">
                <div className="week-day">{dayName(day)}</div>
                <div className="week-sessions">
                  {sessionsOf(day).length === 0 && <span className="muted small">Day off</span>}
                  {sessionsOf(day).map((s, i) => (
                    <span key={i} className="session">
                      <input type="time" value={s.from} step={opd.slotMinutes * 60} aria-label={`${dayName(day)} session ${i + 1} from`} onChange={(e) => updateSession(day, i, 'from', e.target.value)} />
                      <span aria-hidden>–</span>
                      <input type="time" value={s.to} step={opd.slotMinutes * 60} aria-label={`${dayName(day)} session ${i + 1} to`} onChange={(e) => updateSession(day, i, 'to', e.target.value)} />
                      <button type="button" className="icon-btn" aria-label={`Remove ${dayName(day)} session ${i + 1}`} onClick={() => setSessions(day, sessionsOf(day).filter((_, j) => j !== i))}>
                        <Trash2 size={15} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="week-actions">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={sessionsOf(day).length >= opd.maxSessionsPerDay} onClick={() => setSessions(day, [...sessionsOf(day), { ...NEW_SESSION }])}>
                    <Plus size={14} aria-hidden /> Session
                  </button>
                  {day === WEEK_ORDER[0] && sessionsOf(day).length > 0 && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyToAll(day)}>Copy to Mon–Sat</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
  
        <div className="grid-2 top-gap">
          <section className="card">
            <h2>Visit lengths</h2>
            <p className="muted small">Minutes per visit, in steps of {opd.slotMinutes}.</p>
            <div className="form-grid">
              {opd.visitTypes.map((v) => (
                <div key={v.key} className="form-field width-half">
                  <label htmlFor={`length-${v.key}`}>{v.label}</label>
                  <input id={`length-${v.key}`} type="number" min={opd.slotMinutes} step={opd.slotMinutes} value={lengths[v.key] ?? ''} onChange={(e) => setLengths((l) => ({ ...l, [v.key]: e.target.value }))} />
                </div>
              ))}
            </div>
          </section>
  
          <section className="card">
            <h2>Leave</h2>
            <p className="muted small">No appointments are booked on these days (first and last day included).</p>
            {leave.length === 0 && <p className="muted">No leave planned.</p>}
            {leave.map((l, i) => (
              <div key={i} className="leave-row">
                <input type="date" value={l.from} aria-label={`Leave ${i + 1} from`} onChange={(e) => updateLeave(i, 'from', e.target.value)} />
                <span aria-hidden>to</span>
                <input type="date" value={l.to} aria-label={`Leave ${i + 1} to`} onChange={(e) => updateLeave(i, 'to', e.target.value)} />
                <input type="text" value={l.note} placeholder="Note (optional)" maxLength={100} aria-label={`Leave ${i + 1} note`} onChange={(e) => updateLeave(i, 'note', e.target.value)} />
                <button type="button" className="icon-btn" aria-label={`Remove leave ${i + 1}`} onClick={() => setLeave((all) => all.filter((_, j) => j !== i))}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLeave((all) => [...all, { from: '', to: '', note: '' }])} disabled={leave.length >= opd.maxLeavePeriods}>
              <Plus size={14} aria-hidden /> Add leave
            </button>
          </section>
        </div>
      </fieldset>
    </form>
  );
}
