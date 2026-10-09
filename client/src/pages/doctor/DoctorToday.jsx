// Today for doctors and RMOs (owner, 9 Oct 2026), clinical-task first: four numbers (patients under care, reviews due,
// reports to review, pending tasks); My patients (in hospital: ward, bed, diagnosis) and Clinical alerts side by side;
// then Ward rounds (a round note – examination, plan, follow-up, handover – started in one click) and Pending reviews;
// then today's OPD. Cards in a row share one height and scroll inside, so the page has no empty gaps.
import { AlertTriangle, ArrowRight, BedDouble, CalendarClock, ClipboardCheck, ClipboardList, FileCheck2, FlaskConical, HeartPulse, ListTodo, NotebookPen, Siren, Stethoscope, TriangleAlert, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { admissionsApi, doctorDeskApi, todayApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { FloorTag, wardParts } from '../../components/FloorTag.jsx';

import { whenText, whoText } from '../appointments/appointmentFormat.js';
import { requestId } from '../visits/visitFormat.js';

function Tile({ icon: Icon, label, value, hint, tone, href }) {
  return (
    <a href={href} className={`nt-tile tone-${tone}`}>
      <span className="nt-tile-icon"><Icon size={18} aria-hidden /></span>
      <span className="nt-tile-value">{value}</span>
      <span className="nt-tile-label">{label}</span>
      {hint && <span className="nt-tile-hint">{hint}</span>}
    </a>
  );
}

const ALERT_LOOKS = {
  urgent: { tone: 'danger', icon: Siren, word: 'Urgent' },
  watch: { tone: 'pending', icon: TriangleAlert, word: 'Watch' },
};
const ALERT_ICONS = { flag: HeartPulse, dose: ClipboardList, lab: FlaskConical };
const sinceText = (d) => {
  if (!d) return 'No round yet';
  const today = new Date().toDateString() === new Date(d).toDateString();
  return `Last round ${today ? 'today' : formatDateTime(d)}`;
};

export function DoctorToday() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [desk, setDesk] = useState(null);
  const [today, setToday] = useState(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(null);

  const load = useCallback(() => {
    doctorDeskApi.get().then((d) => { setDesk(d); setError(''); }).catch((err) => setError(err.message));
    todayApi.get().then(setToday).catch(() => setToday(null));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [load]);

  // Start a round note for a patient and open it for writing.
  const startRound = async (stayId) => {
    setStarting(stayId);
    setError('');
    try {
      const r = await admissionsApi.newDocument(stayId, 'round', requestId());
      const draft = [...r.documents].reverse().find((d) => d.kind === 'round' && d.status === 'draft');
      navigate(`/hospital/inpatients/${stayId}?tab=documents${draft ? `&open=${draft.id}` : ''}`);
    } catch (err) {
      setError(err.message);
      setStarting(null);
    }
  };

  if (error && !desk) return <Alert type="error">{error}</Alert>;
  if (!desk) return <Loader />;
  const c = desk.counts;
  const unsigned = today?.unsignedVisits ?? 0;
  const pendingTasks = c.roundsDue + c.reviewsDue + c.reportsToReview + unsigned;
  const firstName = user.name.replace(/^Dr\.?\s*/i, '').split(' ')[0];
  const dateText = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const appts = today?.appointments;

  return (
    <div className="nurse-today doctor-today">
      <section className="card nt-hero">
        <div>
          <p className="muted small nt-date">{dateText}</p>
          <h1>Good to see you, Dr {firstName}</h1>
          <p className="muted">{c.inHospital} of your patients in hospital · {c.alerts} clinical alert{c.alerts === 1 ? '' : 's'}{c.urgentAlerts ? ` (${c.urgentAlerts} urgent)` : ''}</p>
        </div>
        <nav className="nt-hero-actions" aria-label="Quick actions">
          <a href="#my-patients" className="btn btn-primary"><Users size={16} aria-hidden /> My patients</a>
          <a href="#clinical-alerts" className="btn btn-ghost"><Siren size={16} aria-hidden /> Clinical alerts</a>
          <a href="#ward-rounds" className="btn btn-ghost"><Stethoscope size={16} aria-hidden /> Ward rounds</a>
          <Link to="/hospital/lab?view=review" className="btn btn-ghost"><FlaskConical size={16} aria-hidden /> Lab reports</Link>
        </nav>
      </section>
      <Alert type="error">{error}</Alert>

      <div className="nt-tiles lab-tiles">
        <Tile icon={Users} label="Patients under care" value={c.underCare} hint={`${c.inHospital} in hospital now`} tone="primary" href="#my-patients" />
        <Tile icon={ClipboardCheck} label="Reviews due" value={c.reviewsDue + unsigned} hint={`${c.reviewsDue} ward document${c.reviewsDue === 1 ? '' : 's'} · ${unsigned} visit${unsigned === 1 ? '' : 's'} to sign`} tone="amber" href="#pending-reviews" />
        <Tile icon={FileCheck2} label="Reports to review" value={c.reportsToReview} hint="Lab results to verify" tone={c.reportsToReview ? 'danger' : 'grey'} href="#pending-reviews" />
        <Tile icon={ListTodo} label="Pending tasks" value={pendingTasks} hint={`${c.roundsDue} round${c.roundsDue === 1 ? '' : 's'} due today`} tone="blue" href="#ward-rounds" />
      </div>

      <div className="desk-row">
        <section className="card desk-card desk-wide" id="my-patients">
          <div className="card-head">
            <h2><BedDouble size={18} aria-hidden /> My patients <span className="muted small">{desk.seesAll ? 'everyone in hospital' : 'in hospital'}</span></h2>
            <Link to="/hospital/patients" className="small">All patients <ArrowRight size={12} aria-hidden /></Link>
          </div>
          {desk.myPatients.length === 0 ? (
            <p className="muted desk-empty">None of your patients is in hospital.</p>
          ) : (
            <div className="desk-scroll">
              <table className="table desk-table">
                <thead><tr><th>Bed</th><th>Patient</th><th>Diagnosis</th><th>Status</th></tr></thead>
                <tbody>
                  {desk.myPatients.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => navigate(`/hospital/inpatients/${p.id}`)}>
                      <td className="desk-bed"><strong>{p.bed || '—'}</strong><span className="muted small block">{wardParts(p.ward).name}</span><FloorTag floor={wardParts(p.ward).floor} /></td>
                      <td><Link to={`/hospital/inpatients/${p.id}`} onClick={(e) => e.stopPropagation()}><strong>{p.patient.name}</strong></Link><span className="muted small block">{[p.patient.patientNumber, p.patient.age != null && `${p.patient.age} y`].filter(Boolean).join(' · ')}</span>{p.patient.allergies && <span className="small block danger-text">Allergies: {p.patient.allergies}</span>}</td>
                      <td className="small">{p.diagnosis || '—'}</td>
                      <td>
                        <span className="ns-badges">
                          {p.urgent && <StateBadge look={ALERT_LOOKS.urgent} small />}
                          {p.alerts > 0 && !p.urgent && <StateBadge look={{ ...ALERT_LOOKS.watch, word: `${p.alerts} alert${p.alerts === 1 ? '' : 's'}` }} small />}
                          {p.roundDue && <StateBadge look={{ tone: 'info', icon: Stethoscope, word: 'Round due' }} small />}
                          {p.drafts > 0 && <StateBadge look={{ tone: 'pending', icon: NotebookPen, word: `${p.drafts} to sign` }} small />}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card desk-card" id="clinical-alerts">
          <div className="card-head">
            <h2><Siren size={18} aria-hidden /> Clinical alerts <span className="muted small">{desk.alerts.length}</span></h2>
          </div>
          {!desk.rulesApproved && <p className="muted small">Vital-sign alerts are off until a doctor approves the red-flag rules in the Clinic library.</p>}
          {desk.alerts.length === 0 ? (
            <p className="muted desk-empty">No alerts. Abnormal vital signs, results outside range and nurse escalations appear here.</p>
          ) : (
            <ul className="plain-list desk-scroll desk-alerts">
              {desk.alerts.map((a, i) => {
                const Icon = ALERT_ICONS[a.kind] ?? AlertTriangle;
                return (
                  <li key={`${a.link}${i}`} className={`desk-alert ${a.level}`}>
                    <Link to={a.link}>
                      <Icon size={16} aria-hidden className="desk-alert-icon" />
                      <span className="desk-alert-text">
                        <strong>{a.title}</strong>
                        <span className="small block">{a.patient.name} · {a.patient.patientNumber}{a.where ? ` · ${a.where}` : ''}</span>
                        {a.detail && <span className="muted small block">{a.detail}</span>}
                      </span>
                      <StateBadge look={ALERT_LOOKS[a.level]} small />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="desk-row desk-even">
        <section className="card desk-card" id="ward-rounds">
          <div className="card-head">
            <h2><Stethoscope size={18} aria-hidden /> Ward rounds <span className="muted small">{c.roundsDue} due today</span></h2>
          </div>
          <p className="muted small">A round note holds the examination, assessment, plan and orders, follow-up plan and the handover.</p>
          {desk.myPatients.length === 0 ? (
            <p className="muted desk-empty">No rounds: none of your patients is in hospital.</p>
          ) : (
            <ul className="plain-list rows desk-scroll">
              {desk.myPatients.map((p) => (
                <li key={p.id}>
                  <span><strong>{p.bed || '—'} · {p.patient.name}</strong> <FloorTag floor={wardParts(p.ward).floor} /><span className="muted small block">{sinceText(p.lastRoundAt)}</span></span>
                  <button type="button" className={`btn btn-sm ${p.roundDue ? 'btn-primary' : 'btn-ghost'}`} disabled={starting === p.id} onClick={() => startRound(p.id)}>
                    <NotebookPen size={14} aria-hidden /> {starting === p.id ? 'Opening…' : p.roundDue ? 'Write round note' : 'Add a note'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card desk-card" id="pending-reviews">
          <div className="card-head">
            <h2><ClipboardCheck size={18} aria-hidden /> Pending reviews <span className="muted small">{desk.reviews.length + (unsigned ? 1 : 0)}</span></h2>
            <Link to="/hospital/lab?view=review" className="small">Lab reports <ArrowRight size={12} aria-hidden /></Link>
          </div>
          {desk.reviews.length === 0 && !unsigned ? (
            <p className="muted desk-empty">Nothing waiting for your review.</p>
          ) : (
            <ul className="plain-list rows desk-scroll">
              {unsigned > 0 && (
                <li>
                  <span><strong>{unsigned} OPD visit{unsigned === 1 ? '' : 's'} of today not signed</strong><span className="muted small block">Sign them once the findings and prescription are complete</span></span>
                  <Link to="/hospital/appointments" className="btn btn-ghost btn-sm">Open</Link>
                </li>
              )}
              {desk.reviews.map((r, i) => (
                <li key={`${r.link}${i}`}>
                  <span>
                    <strong>{r.title}</strong>
                    <span className="small block">{r.patient.name} · {r.patient.patientNumber}{r.detail ? ` · ${r.detail}` : ''}</span>
                    <span className="muted small block">{r.at ? formatDateTime(r.at) : ''}</span>
                  </span>
                  <span className="row-actions">
                    {r.outside > 0 && <StateBadge look={{ tone: 'danger', icon: TriangleAlert, word: `${r.outside} outside range` }} small />}
                    <Link to={r.link} className="btn btn-ghost btn-sm">Review</Link>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {appts && (
        <section className="card">
          <div className="card-head">
            <h2><CalendarClock size={18} aria-hidden /> OPD today <span className="muted small">{appts.total} booked · {appts.seen} seen · {appts.arrived} waiting</span></h2>
            <Link to="/hospital/appointments" className="small">My day <ArrowRight size={12} aria-hidden /></Link>
          </div>
          {appts.waiting.length === 0 && appts.next.length === 0 ? (
            <p className="muted">Nobody waiting and no more appointments today.</p>
          ) : (
            <ul className="plain-list desk-opd">
              {[...appts.waiting.map((a) => ({ ...a, now: true })), ...appts.next].slice(0, 8).map((a) => (
                <li key={a.id}>
                  <strong>{whenText(a)}</strong>
                  <span>{whoText(a)}</span>
                  <StateBadge look={a.now ? { tone: 'pending', icon: Users, word: 'Waiting' } : { tone: 'info', icon: CalendarClock, word: 'Booked' }} small />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
