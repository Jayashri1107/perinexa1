// The super admin's analytics: every hospital side by side, numbers only.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { platformAnalyticsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { activeStatus, formatMoney } from '../../utils/format.js';

export function PlatformAnalyticsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    platformAnalyticsApi.get().then(setData).catch((err) => setError(err.message));
  }, []);

  return (
    <>
      <PageHeader title="Analytics" subtitle="Every hospital side by side (money: this month)" />
      <Alert type="error">{error}</Alert>
      {!data && !error && <Loader />}
      {data && (
        <section className="card list-panel">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Hospital</th><th>Status</th><th className="num">Patients</th><th className="num">Open</th><th className="num">New this month</th>
                  <th className="num">Pregnancies</th><th className="num">Staff</th><th className="num">Billed</th><th className="num">Received</th><th className="num">Pharmacy</th>
                </tr>
              </thead>
              <tbody>
                {data.hospitals.map((h) => (
                  <tr key={h.id}>
                    <td><Link to={`/hospitals/${h.id}`}>{h.name}</Link> <span className="muted small">{h.code}</span></td>
                    <td><StatusBadge status={activeStatus(h)} /></td>
                    <td className="num">{h.patients}</td><td className="num">{h.active}</td><td className="num">{h.newThisMonth}</td>
                    <td className="num">{h.pregnancies}</td><td className="num">{h.staff}</td>
                    <td className="num">{formatMoney(h.billedThisMonth)}</td><td className="num">{formatMoney(h.collectedThisMonth)}</td><td className="num">{formatMoney(h.pharmacyThisMonth)}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td><strong>All hospitals</strong></td><td />
                  <td className="num">{data.totals.patients}</td><td className="num">{data.totals.active}</td><td className="num">{data.totals.newThisMonth}</td>
                  <td className="num">{data.totals.pregnancies}</td><td className="num">{data.totals.staff}</td>
                  <td className="num">{formatMoney(data.totals.billedThisMonth)}</td><td className="num">{formatMoney(data.totals.collectedThisMonth)}</td><td className="num">{formatMoney(data.totals.pharmacyThisMonth)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
