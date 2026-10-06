// Super admin → Pharmacy: every hospital's pharmacy side by side; "Open" goes into that hospital's Pharmacy pages.
import { LogIn } from 'lucide-react';
import { useEffect, useState } from 'react';
import { platformPharmacyApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useOpenInHospital } from '../../hooks/useOpenInHospital.js';
import { activeStatus, formatMoney } from '../../utils/format.js';

const alertCell = (n) => (n > 0 ? <span className="badge badge-pending">{n}</span> : '—');

export function PlatformPharmacyPage() {
  const { superAdmin } = useAppConfig();
  const { open, error: openError } = useOpenInHospital();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    platformPharmacyApi.get().then(setData).catch((err) => setError(err.message));
  }, []);

  return (
    <>
      <PageHeader title="Pharmacy" subtitle="Every hospital's pharmacy: sales, stock and alerts. Open a hospital to see its stock, sales and registers." />
      <Alert type="error">{error || openError}</Alert>
      {!data && !error && <Loader />}
      {data && (
        <section className="card list-panel">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Hospital</th><th>Status</th><th className="num">Sold this month</th><th className="num">Sales today</th><th className="num">Stock value</th>
                  <th className="num">Low stock</th><th className="num">Expiring ({data.expiryAlertDays} days)</th><th className="num">Expired</th><th />
                </tr>
              </thead>
              <tbody>
                {data.hospitals.map((h) => (
                  <tr key={h.id}>
                    <td><strong>{h.name}</strong> <span className="muted small">{h.code}</span></td>
                    <td><StatusBadge status={activeStatus(h)} /></td>
                    <td className="num">{formatMoney(h.soldThisMonth)}</td>
                    <td className="num">{h.salesToday}</td>
                    <td className="num">{formatMoney(h.valueAtCost)}</td>
                    <td className="num">{alertCell(h.lowStock)}</td>
                    <td className="num">{alertCell(h.expiringSoon)}</td>
                    <td className="num">{alertCell(h.expired)}</td>
                    <td className="actions">
                      {superAdmin.inHospitals && h.isActive && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => open(h.id, '/hospital/pharmacy/stock')}>
                          <LogIn size={14} aria-hidden /> Open
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td><strong>All hospitals</strong></td><td />
                  <td className="num">{formatMoney(data.totals.soldThisMonth)}</td>
                  <td className="num">{data.totals.salesToday}</td>
                  <td className="num">{formatMoney(data.totals.valueAtCost)}</td>
                  <td className="num">{data.totals.lowStock}</td>
                  <td className="num">{data.totals.expiringSoon}</td>
                  <td className="num">{data.totals.expired}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
