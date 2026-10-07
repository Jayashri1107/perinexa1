// The super admin's overview of the whole platform – numbers only, never a patient's name:
//  1. today at a glance across all hospitals (each number opens its page);
//  2. what needs attention (accounts still on a temporary password, hospitals without an admin, inactive ones);
//  3. activity month by month (new patients and OPD visits, all hospitals);
//  4. every hospital side by side (staff, patients, visits, in hospital, today's appointments, money this month);
//  5. staff by role and the latest activity in the audit log.
import { AlertTriangle, ArrowRight, Banknote, BedDouble, Building2, CircleCheck, HeartPulse, KeyRound, Stethoscope, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dashboardApi, platformAnalyticsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { BarList } from '../../components/BarList.jsx';
import { ChartCard } from '../../components/ChartCard.jsx';
import { CHART_COLORS, ColumnChart } from '../../components/charts/ColumnChart.jsx';
import { Loader } from '../../components/Loader.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatMoney, monthText, timeAgo } from '../../utils/format.js';

const RECENT = 6;
const shortMonth = (ym) => new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(`${ym}-01T00:00:00`));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [platform, setPlatform] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([dashboardApi.summary(), platformAnalyticsApi.get()])
      .then(([d, p]) => {
        setData(d);
        setPlatform(p);
      })
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <Alert type="error">{error}</Alert>;
  if (!data || !platform) return <Loader />;
  const t = platform.totals;
  const dateText = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

  const attention = [
    data.users.pendingFirstLogin > 0 && { icon: KeyRound, text: `${plural(data.users.pendingFirstLogin, 'account')} still on a temporary password`, hint: 'They have not signed in yet.', to: '/users/pending', action: 'See them' },
    data.hospitalsWithoutAdmin.length > 0 && { icon: AlertTriangle, text: `${plural(data.hospitalsWithoutAdmin.length, 'hospital')} without a hospital admin`, hint: data.hospitalsWithoutAdmin.map((h) => h.name).join(', '), to: `/hospitals/${data.hospitalsWithoutAdmin[0].id}`, action: 'Add an admin' },
    data.hospitals.inactive > 0 && { icon: Building2, text: `${plural(data.hospitals.inactive, 'hospital')} deactivated`, hint: 'Their staff cannot sign in to them.', to: '/hospitals', action: 'See hospitals' },
  ].filter(Boolean);

  return (
    <>
      <header className="today-hero">
        <div>
          <h1>{greeting()}, {user.name.split(' ')[0]}</h1>
          <p className="muted">The whole platform · {dateText}</p>
        </div>
        <div className="today-roles"><span className="pill pill-strong">{user.isPrimary ? 'Main super admin' : 'Super admin'}</span></div>
      </header>

      <h2 className="section-title">All hospitals at a glance</h2>
      <div className="stat-grid">
        <StatCard icon={Building2} to="/hospitals" label="Hospitals" value={data.hospitals.active} hint={`${data.hospitals.total} in all · ${data.hospitals.inactive} inactive`} />
        <StatCard icon={Users} to="/users/staff" label="Active staff" value={t.staff} hint={`${data.users.active} active accounts`} tone="info" />
        <StatCard icon={HeartPulse} to="/analytics" label="Patients under care" value={t.active} hint={`${t.newThisMonth} new this month`} />
        <StatCard icon={Stethoscope} to="/analytics" label="OPD visits this month" value={t.visitsThisMonth} hint={`${t.appointmentsToday} appointments today`} tone="info" />
        <StatCard icon={BedDouble} to="/analytics" label="In hospital now" value={t.admittedNow} hint="Admitted patients" tone="neutral" />
        <StatCard icon={Banknote} to="/billing" label="Received this month" value={formatMoney(t.collectedThisMonth)} hint={`${formatMoney(t.billedThisMonth)} billed`} tone="warning" />
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>Needs your attention</h2>
          {attention.length === 0 ? (
            <p className="all-clear"><CircleCheck size={18} aria-hidden /> All clear – nothing needs you right now.</p>
          ) : (
            <ul className="attention">
              {attention.map((a) => (
                <li key={a.text}>
                  <span className="attention-icon" aria-hidden><a.icon size={18} /></span>
                  <span className="attention-text">
                    <strong className="block">{a.text}</strong>
                    <span className="muted small">{a.hint}</span>
                  </span>
                  <Link to={a.to} className="btn btn-ghost btn-sm">{a.action} <ArrowRight size={14} aria-hidden /></Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <ChartCard
          title="Activity per month"
          subtitle={`New patients and OPD visits, all hospitals · ${platform.trend.reduce((n, m) => n + m.visits, 0)} visits in ${platform.trend.length} months`}
          table={{ columns: ['Month', 'New patients', 'OPD visits'], rows: [...platform.trend].reverse().map((m) => [monthText(m.month), m.newPatients, m.visits]) }}
        >
          <ColumnChart
            title="New patients and OPD visits per month"
            data={platform.trend.map((m) => ({ label: shortMonth(m.month), values: [m.newPatients, m.visits] }))}
            series={[{ label: 'New patients', color: CHART_COLORS[0] }, { label: 'OPD visits', color: CHART_COLORS[1] }]}
            integer
            height={180}
            empty="No patients or visits yet."
          />
        </ChartCard>
      </div>

      <section className="card list-panel top-gap">
        <div className="card-head pad">
          <h2>Hospitals side by side</h2>
          <Link to="/analytics" className="small">Platform analytics <ArrowRight size={12} aria-hidden /></Link>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Hospital</th><th className="num">Staff</th><th className="num">Patients under care</th><th className="num">Visits this month</th><th className="num">In hospital</th><th className="num">Appointments today</th><th className="num">Received this month</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {platform.hospitals.length === 0 && <tr><td colSpan={8} className="empty">No hospitals yet. <Link to="/hospitals/new">Add the first one</Link>.</td></tr>}
              {platform.hospitals.map((h) => (
                <tr key={h.id}>
                  <td><Link to={`/hospitals/${h.id}`}><strong>{h.name}</strong></Link><span className="muted block small">{h.code}</span></td>
                  <td className="num">{h.staff}</td>
                  <td className="num">{h.active}</td>
                  <td className="num">{h.visitsThisMonth}</td>
                  <td className="num">{h.admittedNow}</td>
                  <td className="num">{h.appointmentsToday}</td>
                  <td className="num">{formatMoney(h.collectedThisMonth)}</td>
                  <td><StatusBadge status={h.isActive ? 'active' : 'inactive'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid-2 top-gap">
        <section className="card">
          <h2>Staff by role</h2>
          {data.staffByRole.every((r) => r.count === 0) ? (
            <p className="muted">No hospital staff yet.</p>
          ) : (
            <BarList rows={data.staffByRole.filter((r) => r.count > 0).map((r) => ({ key: r.role, label: r.label, value: r.count }))} />
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Latest activity</h2>
            <Link to="/audit" className="small">All <ArrowRight size={12} aria-hidden /></Link>
          </div>
          {data.recentActivity.length === 0 && <p className="muted">Nothing yet.</p>}
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
