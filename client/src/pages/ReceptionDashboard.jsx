import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarDays, CalendarPlus, ChevronRight, Eye, IndianRupee, MoreVertical, PenLine, RefreshCw, Search, Siren, UserCheck, UserPlus, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { MenuButton } from '../components/MenuButton.jsx';
import { Alert, StatusPill, formatTime } from '../components/ui.jsx';
import { EditPatientDialog } from './appointments/RegisterAndBook.jsx';
import { PURPOSE_LABELS, VISIT_TYPE_LABELS, timeLabel } from './appointments/appointmentFormat.js';
import { AddFollowUpDialog } from './followups/FollowUpDialogs.jsx';
import { missingText } from './DetailsMissing.jsx';
import { doctorToday } from './appointments/DeskToday.jsx';
import { rupees } from './billing/billingFormat.js';
import { useFetch } from '../hooks/useFetch.js';
import { bookingTime, comingUpGroups, visitTypeLabel } from './followups/followUpsFormat.js';
import { QUEUE_LOOK, QUEUE_ORDER, RegisterBookingDialog, RegisterDialog, queueCounts, queueWhen } from './ReceptionDesk.jsx';

// Reception's dashboard (26 Oct 2026, the owner's sketch, made simpler the same day): three number cards; the
// day's patients as a table – tabs by state, a search box, a doctor filter, one row each with Check in or View and a
// menu of the rest; beside it To do, Doctors today and the next appointments. The brand's colours (tokens.css), every
// state in colour + icon + word, one primary button on the screen (New patient, in the page header).

/** "Good morning" / "Good afternoon" / "Good evening" by the hour. */
export function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Up to two initials ("Priya Patil" → "PP"). */
const initials = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

export function Greeting({ name }) {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return (
    <div className="rd-greeting">
      <h2>
        {greeting()}
        {first ? `, ${first}` : ''}
      </h2>
      <p className="muted">Here is what is happening at the clinic today.</p>
    </div>
  );
}

/** The three numbers: today's patients, appointments, the money collected today. */
export function DeskNumbers({ rows = [], collected = null }) {
  const n = queueCounts(rows);
  const booked = rows.filter((r) => r.appointment || r.booked);
  const bookedDone = booked.filter((r) => r.queue === 'done').length;
  const upcoming = booked.filter((r) => (r.queue ?? 'expected') === 'expected').length;
  const cards = [
    { key: 'patients', icon: Users, tone: 'indigo', label: "Today's patients", value: n.all, sub: `${n.all - n.expected} arrived · ${n.waiting} waiting`, to: '/#td-patients' },
    { key: 'appts', icon: CalendarCheck, tone: 'teal', label: 'Appointments', value: booked.length, sub: `${bookedDone} completed · ${upcoming} upcoming`, to: '/appointments' },
    collected && { key: 'money', icon: IndianRupee, tone: 'stable', label: 'Collection today', value: rupees(collected.totals.net), sub: `${collected.payments?.length ?? 0} payment${collected.payments?.length === 1 ? '' : 's'}`, to: '/billing/daily' },
  ].filter(Boolean);
  return (
    <div className="rd-numbers">
      {cards.map((c) => (
        <Link key={c.key} to={c.to} className="card rd-number">
          <span className={`rd-icon is-${c.tone}`} aria-hidden="true">
            <c.icon />
          </span>
          <span className="rd-number-text">
            <span className="rd-number-label">{c.label}</span>
            <strong className="rd-number-value tabular">{c.value}</strong>
            <span className="muted">{c.sub}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}


/**
 * A booking made by name and phone (GET /api/today: guests) as a row of the table: expected, "Details missing", with
 * Fill info instead of Check in – so the table, the numbers and Doctors today count the same people.
 */
export const guestRow = (g) => ({
  patient: { id: `guest-${g.id}`, fullName: g.guest?.name ?? 'Patient', mrn: '', phone: g.guest?.phone ?? '', doctorName: g.doctorName ?? null },
  appointment: g,
  booked: true,
  guest: true,
  queue: 'expected',
  arrivedAt: null,
  arrivalMarked: false,
  visitStarted: false,
  emergency: false,
  leftMarked: false,
  age: null,
  baby: false,
  purpose: null,
  followUp: null,
});

const TABS = [['', 'All'], ...QUEUE_ORDER.map((k) => [k, QUEUE_LOOK[k].label])];
const digitsOf = (s) => String(s ?? '').replace(/\D/g, '');

/** Does a row of today's list match the search box (name, patient number, phone)? */
export function rowMatches(r, text) {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  const p = r.patient;
  if ([p.fullName, p.mrn].some((w) => (w ?? '').toLowerCase().includes(t))) return true;
  const d = digitsOf(t);
  return d.length >= 3 && digitsOf(p.phone).includes(d);
}

/** Her age, or "Baby" for a newborn record. */
const ageText = (r) => (r.baby ? 'Baby' : r.age != null ? `${r.age} yrs` : '–');
/** Her visit today: why she came (marked at check-in), else the booking's visit type. */
const visitText = (r) =>
  r.purpose?.kind
    ? PURPOSE_LABELS[r.purpose.kind]
    : (r.appointment?.kind === 'token' ? 'Walk-in' : (VISIT_TYPE_LABELS[r.appointment?.visitType] ?? (r.appointment || r.booked ? 'Booked' : 'No booking')));

/**
 * Today's patients as a table (the live queue): tabs by state with their counts, a search box (today's list first;
 * anyone else found is offered below, with Register new patient), a doctor filter, and one row each – Check in for
 * those expected, View for the others, and the rest in the row's menu (Emergency, Mark done, the undos, Edit info,
 * Book, Slip). Emergencies first, in red with the word.
 */
export function PatientsTable({ rows = [], incomplete = [], canMark = true, onMark, onUndo, onFlag, onSlip, busy = null, updatedAt = null, onRefresh, onSaved }) {
  const [tab, setTab] = useState('');
  const [text, setText] = useState('');
  const [doctor, setDoctor] = useState('');
  const [editing, setEditing] = useState(null);
  const [addingFor, setAddingFor] = useState(null); // Add follow-up
  const [registering, setRegistering] = useState(null); // a booking made by name and phone
  // Registered patients whose details are not all filled in (GET /api/today: incomplete): Fill info, until they are
  const missingOf = new Map(incomplete.map((m) => [m.patient.id, m.missing]));
  const [filling, setFilling] = useState(null); // { patient, missing }
  const n = queueCounts(rows);
  const doctors = useMemo(() => [...new Set(rows.map((r) => r.appointment?.doctorName ?? r.patient.doctorName).filter(Boolean))].sort(), [rows]);
  const shown = rows.filter((r) => (!tab || (r.queue ?? 'expected') === tab) && (!doctor || (r.appointment?.doctorName ?? r.patient.doctorName) === doctor) && rowMatches(r, text));
  const todayIds = new Set(rows.map((r) => r.patient.id));

  return (
    <section className="card rd-patients" id="td-patients" aria-labelledby="rd-patients-title" tabIndex={-1}>
      <div className="rd-card-head">
        <h2 id="rd-patients-title">
          <Users aria-hidden="true" /> Today&apos;s patients
        </h2>
        {n.emergency > 0 && (
          <StatusPill tone="high" icon={Siren}>
            {n.emergency} emergency
          </StatusPill>
        )}
        <span className="rd-updated muted">
          {updatedAt ? `Updated ${updatedAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} · ` : ''}every 30 seconds
          <button type="button" className="btn btn-link btn-sm" onClick={onRefresh}>
            <RefreshCw aria-hidden="true" /> Refresh
          </button>
        </span>
      </div>
      <div className="rd-tabs" role="tablist" aria-label="Show">
        {TABS.map(([k, label]) => (
          <button key={label} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label} <span className="tabular">({k ? n[k] : n.all})</span>
          </button>
        ))}
      </div>
      <div className="rd-filters">
        <label className="rd-search">
          <Search aria-hidden="true" />
          <span className="sr-only">Search today&apos;s patients</span>
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by name, phone or patient number" autoComplete="off" />
        </label>
        {doctors.length > 1 && (
          <label className="rd-filter">
            <span className="sr-only">Doctor</span>
            <select value={doctor} onChange={(e) => setDoctor(e.target.value)}>
              <option value="">All doctors</option>
              {doctors.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="dt-wrap rd-table-wrap">
        <table className="rd-table">
          <caption className="sr-only">Today&apos;s patients</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Patient</th>
              <th scope="col">Age</th>
              <th scope="col">Time</th>
              <th scope="col">Visit type</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const state = r.queue ?? (r.arrivedAt ? 'waiting' : 'expected');
              const look = QUEUE_LOOK[state];
              const p = r.patient;
              const urgent = r.emergency && state !== 'done';
              const inQueue = state === 'waiting' || state === 'with_doctor';
              const saving = busy === p.id;
              const menu = [
                canMark && inQueue && r.arrivalMarked && { label: r.emergency ? 'Not an emergency' : 'Emergency – see first', icon: Siren, onSelect: () => onFlag(p, 'emergency', !r.emergency) },
                canMark && inQueue && r.arrivalMarked && { label: 'Mark done – she left', onSelect: () => onFlag(p, 'left', true) },
                canMark && state === 'waiting' && r.arrivalMarked && !r.visitStarted && { label: 'Undo arrival', onSelect: () => onUndo(p) },
                canMark && state === 'done' && r.leftMarked && { label: 'Undo done', onSelect: () => onFlag(p, 'left', false) },
                { label: 'Edit info', onSelect: () => setEditing(p) },
                { label: 'Add follow-up', onSelect: () => setAddingFor(p) },
                { label: 'Book an appointment', to: `/patients/${p.id}/appointments` },
                r.appointment?.kind === 'token' && { label: 'Print token slip', onSelect: () => onSlip({ ...r.appointment, doctor: { name: r.appointment.doctorName } }) },
              ].filter(Boolean);
              return (
                <tr key={p.id} className={`rd-row is-${state}${urgent ? ' is-emergency' : ''}${r.guest ? ' is-guest' : ''}`}>
                  <td className="tabular muted">{i + 1}</td>
                  <td>
                    <span className="rd-person">
                      <span className="rd-avatar" aria-hidden="true">
                        {initials(p.fullName)}
                      </span>
                      <span className="rd-person-text">
                        {r.guest ? <strong>{p.fullName}</strong> : <Link to={`/patients/${p.id}`}>{p.fullName}</Link>}
                        <span className="muted tabular">
                          {r.guest ? <span className="rd-missing">Details missing</span> : p.mrn}
                          {!r.guest && missingOf.has(p.id) ? <span className="rd-missing"> · Details missing</span> : null}
                          {r.guest && p.phone ? ` · ${p.phone}` : ''}
                          {r.appointment?.doctorName ?? p.doctorName ? ` · ${r.appointment?.doctorName ?? p.doctorName}` : ''}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="tabular">{ageText(r)}</td>
                  <td className="tabular">
                    {queueWhen(r)}
                    {r.arrivedAt && <span className="muted rd-sub">arrived {formatTime(r.arrivedAt)}</span>}
                  </td>
                  <td>
                    <span className="rd-visit">{visitText(r)}</span>
                    {/* Her open follow-up (added by hand): with which doctor and what for */}
                    {r.followUp && !r.purpose && (
                      <span className="rd-sub rd-followup" title={r.followUp.note || undefined}>
                        Follow-up: {PURPOSE_LABELS[r.followUp.purpose]}
                      </span>
                    )}
                    {r.purpose?.note && <span className="rd-sub muted">{r.purpose.note}</span>}
                  </td>
                  <td>
                    <span className="rd-status">
                      {urgent && (
                        <StatusPill tone="high" icon={Siren}>
                          Emergency
                        </StatusPill>
                      )}
                      <StatusPill tone={look.tone} icon={look.icon}>
                        {look.label}
                      </StatusPill>
                    </span>
                  </td>
                  <td>
                    <span className="rd-actions">
                      {r.guest ? (
                        // Booked by name and phone, details still missing: fill them in (her record is made and the
                        // booking joins it), then Check in
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRegistering(r.appointment)}>
                          <PenLine aria-hidden="true" /> Fill info
                        </button>
                      ) : canMark && state === 'expected' ? (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onMark(p, r)} disabled={saving}>
                          <UserCheck aria-hidden="true" /> Check in
                        </button>
                      ) : (
                        <Link to={r.visitId ? `/patients/${p.id}/visits/${r.visitId}` : `/patients/${p.id}`} className="btn btn-secondary btn-sm">
                          <Eye aria-hidden="true" /> View
                        </Link>
                      )}
                      {!r.guest && missingOf.has(p.id) && (
                        <button type="button" className="btn btn-link btn-sm" onClick={() => setFilling({ patient: p, missing: missingOf.get(p.id) })}>
                          <PenLine aria-hidden="true" /> Fill info
                        </button>
                      )}
                      {!r.guest && <MenuButton label="" icon={MoreVertical} className="icon-btn rd-more" align="end" ariaLabel={`More for ${p.fullName}`} items={menu} />}
                    </span>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="dt-empty">
                  {rows.length === 0 ? 'Nobody is booked for today, and nobody has arrived yet.' : text ? 'Nobody on today’s list matches.' : 'Nobody in this state right now.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {text.trim().length >= 2 && <OtherPatients term={text} skip={todayIds} onArrive={onMark} busy={busy} onSaved={onSaved} onEdit={setEditing} />}
      {editing && (
        <EditPatientDialog
          patientId={editing.id}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            onSaved(`Saved: the details of ${saved?.fullName ?? editing.fullName}.`);
          }}
        />
      )}
      {filling && (
        <EditPatientDialog
          patientId={filling.patient.id}
          missing={missingText(filling.missing)}
          onClose={() => setFilling(null)}
          onSaved={() => {
            const who = filling.patient.fullName;
            setFilling(null);
            onSaved(`Saved: ${who}'s details.`);
          }}
        />
      )}
      {registering && (
        <RegisterBookingDialog
          appointment={registering}
          onClose={() => setRegistering(null)}
          onRegistered={(p) => {
            setRegistering(null);
            onSaved(`Saved: ${p.fullName}'s details (${p.mrn}); her booking is on her record. Press Check in when she is here.`);
          }}
        />
      )}
      {addingFor && (
        <AddFollowUpDialog
          patient={addingFor}
          onClose={() => setAddingFor(null)}
          onAdded={(f) => {
            setAddingFor(null);
            onSaved(`Follow-up added for ${addingFor.fullName}: ${PURPOSE_LABELS[f.purpose]} with ${f.doctor.name}${f.from ? ` from ${f.from}` : ''}.`);
          }}
        />
      )}
    </section>
  );
}

/** Patients found by the search box who are not on today's list: Check in or Book; nobody right: Register new. */
function OtherPatients({ term, skip, onArrive, busy, onSaved, onEdit }) {
  const [result, setResult] = useState(null);
  const [registering, setRegistering] = useState(false);
  const t = term.trim();
  useEffect(() => {
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const res = await api('/patients', { query: { search: t, doctor: 'all', limit: 6, sort: 'fullName' } });
        if (current) setResult({ patients: res.patients.filter((p) => !skip.has(p.id)) });
      } catch (err) {
        if (current) setResult({ error: err.message });
      }
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // (skip changes with every refresh; the search runs again only when the words change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);
  return (
    <div className="rd-others">
      <h3>Not on today&apos;s list</h3>
      {result?.error && <Alert type="error">{result.error}</Alert>}
      {result?.patients?.map((p) => {
        const usable = !p.closed && !p.duplicateOf;
        return (
          <div key={p.id} className="rd-other">
            <span className="rd-person-text">
              <Link to={`/patients/${p.id}`}>{p.fullName}</Link>
              <span className="muted tabular">{[p.mrn, p.phone, p.assignedDoctorName].filter(Boolean).join(' · ')}</span>
              {p.duplicateOf && <span className="hint">Duplicate of {p.duplicateOf.mrn} – use {p.duplicateOf.mrn}</span>}
              {p.closed && <span className="hint">Record closed – takes no appointment</span>}
            </span>
            {usable && (
              <span className="rd-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onArrive(p, null)} disabled={busy === p.id}>
                  <UserCheck aria-hidden="true" /> Check in
                </button>
                <Link to={`/patients/${p.id}/appointments`} className="btn btn-link btn-sm">
                  <CalendarPlus aria-hidden="true" /> Book
                </Link>
                <button type="button" className="btn btn-link btn-sm" onClick={() => onEdit(p)}>
                  Edit info
                </button>
              </span>
            )}
          </div>
        );
      })}
      {result && (
        <div className="rd-other">
          <span className="muted">{result.patients?.length ? 'Not the right person?' : 'Nobody else found.'}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRegistering(true)}>
            <UserPlus aria-hidden="true" /> Register new patient
          </button>
        </div>
      )}
      {registering && (
        <RegisterDialog
          text={t}
          onClose={() => setRegistering(false)}
          onRegistered={(p) => {
            setRegistering(false);
            onSaved(`${p.fullName} is registered as ${p.mrn}. Press Check in when she is here.`);
          }}
        />
      )}
    </div>
  );
}

/** Doctors today: initials, name, state and hours, and how many are expected, waiting and seen. */
export function DoctorsPanel({ doctors = [] }) {
  if (!doctors.length) return null;
  return (
    <section className="card rd-side-card" aria-labelledby="rd-doctors-title">
      <div className="rd-card-head">
        <h2 id="rd-doctors-title">Doctors today</h2>
        <Link to="/appointments" className="rd-view-all">
          View all <ChevronRight aria-hidden="true" />
        </Link>
      </div>
      <ul className="rd-doctors">
        {doctors.map((d) => {
          const s = doctorToday(d);
          return (
            <li key={d.id}>
              <span className="rd-avatar is-doctor" aria-hidden="true">
                {initials(d.name)}
              </span>
              <span className="rd-person-text">
                <Link to={`/appointments?doctor=${d.id}`}>{d.name}</Link>
                <StatusPill tone={s.tone} icon={s.icon}>
                  {s.word}
                </StatusPill>
                {s.line && <span className="muted">{s.line}</span>}
              </span>
              <span className="rd-doctor-counts tabular">
                <span>
                  <strong>{d.expected}</strong> Expected
                </span>
                <span>
                  <strong>{d.waiting}</strong> Waiting
                </span>
                <span>
                  <strong>{d.seen}</strong> Seen
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The days after today, grouped, at most `max` rows (Upcoming visits): { groups, total, shown }. */
export function upcomingVisits(comingUp = [], today, max = 10) {
  const later = comingUp.filter((r) => r.date > today);
  const groups = comingUpGroups(later.slice(0, max), today);
  return { groups, total: later.length, shown: Math.min(later.length, max) };
}

/**
 * Upcoming visits (26 Oct 2026, under Today's patients): everyone booked for the next days after today – an
 * appointment, or a next visit the doctor wrote – by day: time, patient, phone, doctor, New or Follow-up. From the
 * Follow-ups page's answer (GET /api/follow-ups, reception only); all of them under Follow-ups. refreshKey: reloads
 * with the desk.
 */
export function UpcomingVisits({ refreshKey = 0, max = 10 }) {
  const res = useFetch('/follow-ups');
  const { reload } = res;
  useEffect(() => {
    if (refreshKey) reload();
  }, [refreshKey, reload]);
  if (res.error) return <Alert type="error">{res.error}</Alert>;
  if (!res.data) return null;
  const { groups, total, shown } = upcomingVisits(res.data.comingUp, res.data.today, max);
  // Nothing booked for the coming days: no card (only what is needed)
  if (total === 0) return null;
  return (
    <section className="card rd-coming" aria-labelledby="rd-coming-title">
      <div className="rd-card-head">
        <h2 id="rd-coming-title">
          <CalendarDays aria-hidden="true" /> Upcoming visits <span className="muted tabular">({total})</span>
        </h2>
        <span className="muted rd-coming-days">Next {res.data.days - 1} days</span>
        <Link to="/follow-ups#fu-coming" className="rd-view-all">
          View all <ChevronRight aria-hidden="true" />
        </Link>
      </div>
      {groups.map((g) => (
        <div key={g.date} className="rd-coming-day">
          <h3>
            {g.label} <span className="muted tabular">({g.rows.length})</span>
          </h3>
          <ul className="rd-coming-list">
            {g.rows.map((r, i) => (
              <li key={`${r.patient.id}-${i}`}>
                <span className="tabular rd-coming-time">{r.needsTime ? <Link to="/appointments/needs-time">Needs a time</Link> : bookingTime(r)}</span>
                <span className="rd-person-text">
                  <Link to={`/patients/${r.patient.id}`}>{r.patient.fullName}</Link>
                  <span className="muted tabular">{[r.patient.mrn, r.patient.phone, r.doctorName ?? r.patient.doctorName].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="rd-visit">{visitTypeLabel(r)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {total > shown && (
        <Link to="/follow-ups#fu-coming" className="btn btn-link btn-sm">
          Show all {total} upcoming visits
        </Link>
      )}
    </section>
  );
}
