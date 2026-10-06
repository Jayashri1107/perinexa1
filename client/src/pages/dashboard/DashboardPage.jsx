// The consolidated view: platform totals, staff per role, the largest hospitals, master data and recent activity.
import { Building2, Clock, ShieldCheck, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dashboardApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { formatDateTime } from '../../utils/format.js';

export function DashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    dashboardApi.summary().then(setData).catch((err) => setError(err.message));
  }, []);

  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;

  const maxRole = Math.max(1, ...data.staffByRole.map((r) => r.count));

  return (
    <>
      <PageHeader title="Overview" subtitle="The whole platform at a glance" />

      <div className="stat-grid">
        <StatCard icon={Building2} label="Hospitals" value={data.hospitals.total} hint={`${data.hospitals.active} active · ${data.hospitals.inactive} inactive`} />
        <StatCard icon={Users} label="Active accounts" value={data.users.active} hint={`${data.users.total} accounts in total`} tone="info" />
        <StatCard icon={Clock} label="First login pending" value={data.users.pendingFirstLogin} hint="Still on a temporary password" tone="warning" />
        <StatCard icon={ShieldCheck} label="Super admins" value={data.users.superAdmins} hint="Active platform admins" tone="neutral" />
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>Staff by role</h2>
          <ul className="bar-list">
            {data.staffByRole.map((r) => (
              <li key={r.role}>
                <span className="bar-label">{r.label}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${(r.count / maxRole) * 100}%` }} />
                </span>
                <span className="bar-value">{r.count}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>Largest hospitals</h2>
          {data.topHospitals.length === 0 ? (
            <p className="muted">No hospital has staff yet. <Link to="/hospitals">Add a hospital</Link>.</p>
          ) : (
            <ul className="plain-list rows">
              {data.topHospitals.map((h) => (
                <li key={h.hospital.id}>
                  <Link to={`/hospitals/${h.hospital.id}`}>{h.hospital.name}</Link>
                  <span className="muted">{h.staff} staff</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>Master data</h2>
          <ul className="plain-list rows">
            {data.masterData.map((m) => (
              <li key={m.type}>
                <Link to={`/master-data/${m.type}`}>{m.label}</Link>
                <span className="muted">{m.active} active of {m.total}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>Recent activity</h2>
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
          <Link to="/audit" className="small">Open the audit log</Link>
        </section>
      </div>
    </>
  );
}
