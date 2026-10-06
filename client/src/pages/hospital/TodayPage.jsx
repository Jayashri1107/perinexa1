// Today: the start page in a hospital, with the sections each person's roles need.
import { Banknote, Baby, CalendarX, HeartPulse, PackageMinus, Pill, Receipt, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { todayApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate, formatMoney } from '../../utils/format.js';

export function TodayPage() {
  const { user, activeMembership, roles, canAccess } = useAuth();
  const { roleLabel } = useAppConfig();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    todayApi.get().then(setData).catch((err) => setError(err.message));
  }, []);

  const nothing = data && !data.patients && !data.doctor && !data.billing && !data.pharmacy;

  return (
    <>
      <PageHeader title={`Today · ${user.name}`} subtitle={`${activeMembership?.hospital.name} · ${roles.map(roleLabel).join(', ')}${data ? ` · ${formatDate(`${data.date}T12:00:00`)}` : ''}`} />
      <Alert type="error">{error}</Alert>
      {!data && !error && <Loader />}

      {data?.doctor && (
        <section className="today-block">
          <h2>My patients</h2>
          <div className="grid-2">
            <StatCard icon={HeartPulse} label="My open records" value={data.doctor.mine} />
            <section className="card">
              <h3><Baby size={16} aria-hidden /> Due in the next {data.doctor.dueSoonDays} days</h3>
              {data.doctor.dueSoon.length === 0 && <p className="muted">None.</p>}
              <ul className="plain-list rows">
                {data.doctor.dueSoon.map((p) => (
                  <li key={p.id}>
                    <Link to={`/hospital/patients/${p.id}`}>{p.name}</Link>
                    <span className="muted small">{p.patientNumber} · EDD {formatDate(p.edd)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </section>
      )}

      {data?.patients && (
        <section className="today-block">
          <h2>Registration</h2>
          <div className="stat-grid">
            <StatCard icon={UserPlus} label="Registered today" value={data.patients.registeredToday} tone="info" />
            <StatCard icon={HeartPulse} label="Open records" value={data.patients.active} tone="neutral" />
          </div>
          {canAccess('registerPatients') && <Link to="/hospital/patients/new" className="btn btn-primary">New patient</Link>}
        </section>
      )}

      {data?.billing && (
        <section className="today-block">
          <h2>Billing</h2>
          <div className="stat-grid">
            <StatCard icon={Receipt} label="Bills today" value={data.billing.billsToday} hint={formatMoney(data.billing.billedToday)} />
            <StatCard icon={Banknote} label="Received today (net)" value={formatMoney(data.billing.collectedToday)} tone="info" />
            <StatCard icon={Receipt} label="Unpaid bills" value={data.billing.unpaidBills} hint={`${formatMoney(data.billing.owed)} owed`} tone="warning" />
          </div>
          <Link to="/hospital/billing/unpaid" className="small">See unpaid bills</Link>
        </section>
      )}

      {data?.pharmacy && (
        <section className="today-block">
          <h2>Pharmacy</h2>
          <div className="stat-grid">
            <StatCard icon={Pill} label="Sales today" value={data.pharmacy.salesToday} hint={formatMoney(data.pharmacy.soldToday)} />
            <StatCard icon={PackageMinus} label="Low stock" value={data.pharmacy.lowStock} tone="warning" />
            <StatCard icon={CalendarX} label="Expiring soon" value={data.pharmacy.expiringSoon} hint={`${data.pharmacy.expired} batches already expired`} tone="warning" />
          </div>
          <Link to="/hospital/pharmacy/reports" className="small">See pharmacy reports</Link>
        </section>
      )}

      {canAccess('admin') && (
        <section className="today-block">
          <h2>Hospital admin</h2>
          <p className="muted">Staff, OPD timings, hospital settings and the audit log.</p>
          <Link to="/hospital/admin" className="btn btn-ghost">Open the hospital overview</Link>
        </section>
      )}

      {nothing && !canAccess('admin') && (
        <section className="card">
          <p>Your pages are in the menu on the left. Set up your details under <Link to="/account">My settings</Link>.</p>
        </section>
      )}
    </>
  );
}
