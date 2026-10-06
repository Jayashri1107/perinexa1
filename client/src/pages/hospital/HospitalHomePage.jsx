// The start page in a hospital. Hospital admins see the consolidated overview; other roles see their access until
// their own modules (patients, appointments, lab …) are built.
import { CalendarClock, CircleCheck, CircleDashed, Clock, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { hospitalOverviewApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDateTime } from '../../utils/format.js';

// Where each setup item is done.
const SETUP_LINKS = {
  letterhead: '/hospital/settings/letterhead',
  registration: '/hospital/settings/letterhead',
  opd: '/hospital/opd-timings',
  abdm: '/hospital/settings/abdm',
};

function HospitalOverview() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    hospitalOverviewApi.get().then(setData).catch((err) => setError(err.message));
  }, []);

  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;

  const { hospital, staff, opd, setup, messaging } = data;
  const maxRole = Math.max(1, ...staff.byRole.map((r) => r.count));
  const address = [hospital.address?.line, hospital.address?.city].filter(Boolean).join(', ');

  return (
    <>
      <PageHeader title={hospital.name} subtitle={`Code ${hospital.code}${address ? ` · ${address}` : ''}`} />

      <div className="stat-grid">
        <StatCard icon={Users} label="Active staff" value={staff.active} hint={`${staff.admins} admin${staff.admins === 1 ? '' : 's'} · ${staff.inactive} without access`} />
        <StatCard icon={Clock} label="First login pending" value={staff.pendingFirstLogin} hint="Still on a temporary password" tone="warning" />
        <StatCard icon={CalendarClock} label="Doctors" value={opd.doctors} hint={`${opd.withoutTimings} without OPD timings`} tone="info" />
        <StatCard
          icon={CircleCheck}
          label="Setup done"
          value={`${setup.filter((s) => s.done).length} of ${setup.length}`}
          hint="See the checklist below"
          tone="neutral"
        />
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>Setup checklist</h2>
          <ul className="plain-list rows">
            {setup.map((s) => (
              <li key={s.key}>
                <span className="checklist-item">
                  {s.done ? <CircleCheck size={18} className="ok" aria-hidden /> : <CircleDashed size={18} className="todo" aria-hidden />}
                  {s.label}
                </span>
                {s.done ? <span className="muted small">Done</span> : <Link to={SETUP_LINKS[s.key]} className="small">Set up</Link>}
              </li>
            ))}
            <li>
              <span>Patient messages</span>
              <Link to="/hospital/settings/messaging" className="small">
                Reminders {messaging.remindersEnabled ? 'on' : 'off'} · Portal {messaging.portalEnabled ? 'on' : 'off'}
              </Link>
            </li>
          </ul>
        </section>

        <section className="card">
          <h2>Staff by role</h2>
          <ul className="bar-list">
            {staff.byRole.map((r) => (
              <li key={r.role}>
                <span className="bar-label">{r.label}</span>
                <span className="bar-track"><span className="bar-fill" style={{ width: `${(r.count / maxRole) * 100}%` }} /></span>
                <span className="bar-value">{r.count}</span>
              </li>
            ))}
          </ul>
          <Link to="/hospital/staff" className="small">Manage staff</Link>
        </section>

        <section className="card span-2">
          <h2>Recent activity in this hospital</h2>
          {data.recentActivity.length === 0 && <p className="muted">Nothing yet.</p>}
          <ul className="plain-list rows">
            {data.recentActivity.map((a) => (
              <li key={a.id}>
                <span>
                  <strong>{a.label}</strong>
                  <span className="muted block">{a.actorEmail ?? 'System'}{a.targetEmail && a.targetEmail !== a.actorEmail ? ` → ${a.targetEmail}` : ''}</span>
                </span>
                <span className="muted small">{formatDateTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
          <Link to="/hospital/audit" className="small">Open the audit log</Link>
        </section>
      </div>
    </>
  );
}

function StaffWelcome() {
  const { user, activeMembership, roles } = useAuth();
  const { roleLabel } = useAppConfig();
  return (
    <>
      <PageHeader title={`Welcome, ${user.name}`} subtitle={activeMembership?.hospital.name} />
      <section className="card">
        <h2>Your access here</h2>
        <p>{roles.map(roleLabel).join(', ')}</p>
        <p className="muted">
          The pages for your work (patients, appointments, lab …) are the next modules to be built. You can already set up
          your details under <Link to="/account">My settings</Link>.
        </p>
      </section>
    </>
  );
}

export function HospitalHomePage() {
  const { isHospitalAdmin } = useAuth();
  return isHospitalAdmin ? <HospitalOverview /> : <StaffWelcome />;
}
