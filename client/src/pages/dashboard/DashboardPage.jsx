// Overview: the whole platform at a glance – four numbers, staff by role, the largest hospitals, the latest activity.
import { ArrowRight, Building2, Clock, ShieldCheck, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dashboardApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { BarList } from '../../components/BarList.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { timeAgo } from '../../utils/format.js';

const RECENT = 5;

export function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    dashboardApi.summary().then(setData).catch((err) => setError(err.message));
  }, []);

  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  const firstName = user.name.split(' ')[0];

  return (
    <>
      <PageHeader title={`Hello, ${firstName}`} subtitle="The whole platform at a glance" />

      <div className="stat-grid">
        <StatCard icon={Building2} to="/hospitals" label="Hospitals" value={data.hospitals.total} hint={`${data.hospitals.active} active · ${data.hospitals.inactive} inactive`} />
        <StatCard icon={Users} to="/users" label="Active accounts" value={data.users.active} hint={`${data.users.total} accounts in all`} tone="info" />
        <StatCard icon={Clock} to="/users/pending" label="First login pending" value={data.users.pendingFirstLogin} hint="Still on a temporary password" tone="warning" />
        <StatCard icon={ShieldCheck} to="/users/super-admins" label="Super admins" value={data.users.superAdmins} hint="Platform admins" tone="neutral" />
      </div>

      <div className="grid-3">
        <section className="card">
          <h2>Staff by role</h2>
          <BarList rows={data.staffByRole.filter((r) => r.count > 0).map((r) => ({ key: r.role, label: r.label, value: r.count }))} />
          {data.staffByRole.every((r) => r.count === 0) && <p className="muted">No hospital staff yet.</p>}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Largest hospitals</h2>
            <Link to="/hospitals" className="small">All <ArrowRight size={12} aria-hidden /></Link>
          </div>
          {data.topHospitals.length === 0 ? (
            <p className="muted">No hospital has staff yet.</p>
          ) : (
            <ul className="plain-list rows">
              {data.topHospitals.map((h) => (
                <li key={h.hospital.id}>
                  <Link to={`/hospitals/${h.hospital.id}`}>{h.hospital.name}</Link>
                  <span className="pill">{h.staff} staff</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Latest activity</h2>
            <Link to="/audit" className="small">All <ArrowRight size={12} aria-hidden /></Link>
          </div>
          <ul className="activity">
            {data.recentActivity.slice(0, RECENT).map((a) => (
              <li key={a.id}>
                <span className="activity-dot" aria-hidden />
                <span className="activity-text">
                  <strong>{a.label}</strong>
                  <span className="muted small block">{a.actorEmail ?? 'System'}</span>
                </span>
                <span className="muted small nowrap" title={new Date(a.createdAt).toLocaleString()}>{timeAgo(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
