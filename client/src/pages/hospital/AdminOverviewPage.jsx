// Hospital admin → Overview: the consolidated view of the hospital (staff, setup checklist, recent activity).
import { CalendarClock, CircleCheck, CircleDashed, Clock, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { hospitalOverviewApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { SectionTabs } from '../../components/SectionTabs.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { HOSPITAL_ADMIN_TABS } from '../../config/navigation.js';
import { formatDateTime } from '../../utils/format.js';

// Where each setup item is done.
const SETUP_LINKS = {
  letterhead: '/hospital/settings/letterhead',
  registration: '/hospital/settings/letterhead',
  opd: '/hospital/opd-timings',
  abdm: '/hospital/settings/abdm',
};

export function AdminOverviewPage() {
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
      <PageHeader title="Hospital overview" subtitle={`${hospital.name} · code ${hospital.code}${address ? ` · ${address}` : ''}`} />
      <SectionTabs tabs={HOSPITAL_ADMIN_TABS} label="Hospital admin" />

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
