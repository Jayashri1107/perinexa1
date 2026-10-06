// Super admin → Billing: every hospital's billing side by side; "Open" goes into that hospital's Billing pages.
import { LogIn } from 'lucide-react';
import { useEffect, useState } from 'react';
import { platformBillingApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useOpenInHospital } from '../../hooks/useOpenInHospital.js';
import { activeStatus, formatMoney } from '../../utils/format.js';

export function PlatformBillingPage() {
  const { superAdmin } = useAppConfig();
  const { open, error: openError } = useOpenInHospital();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    platformBillingApi.get().then(setData).catch((err) => setError(err.message));
  }, []);

  return (
    <>
      <PageHeader title="Billing" subtitle="Every hospital's billing. Open a hospital to see its bills, price list and reports." />
      <Alert type="error">{error || openError}</Alert>
      {!data && !error && <Loader />}
      {data && (
        <section className="card list-panel">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Hospital</th><th>Status</th><th className="num">Bills this month</th><th className="num">Billed this month</th>
                  <th className="num">Received this month</th><th className="num">Received today</th><th className="num">Unpaid bills</th><th className="num">Owed</th><th />
                </tr>
              </thead>
              <tbody>
                {data.hospitals.map((h) => (
                  <tr key={h.id}>
                    <td><strong>{h.name}</strong> <span className="muted small">{h.code}</span></td>
                    <td><StatusBadge status={activeStatus(h)} /></td>
                    <td className="num">{h.billsThisMonth}</td>
                    <td className="num">{formatMoney(h.billedThisMonth)}</td>
                    <td className="num">{formatMoney(h.receivedThisMonth)}</td>
                    <td className="num">{formatMoney(h.receivedToday)}</td>
                    <td className="num">{h.unpaidBills}</td>
                    <td className="num">{formatMoney(h.owed)}</td>
                    <td className="actions">
                      {superAdmin.inHospitals && h.isActive && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => open(h.id, '/hospital/billing')}>
                          <LogIn size={14} aria-hidden /> Open
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td><strong>All hospitals</strong></td><td />
                  <td className="num">{data.totals.billsThisMonth}</td>
                  <td className="num">{formatMoney(data.totals.billedThisMonth)}</td>
                  <td className="num">{formatMoney(data.totals.receivedThisMonth)}</td>
                  <td className="num">{formatMoney(data.totals.receivedToday)}</td>
                  <td className="num">{data.totals.unpaidBills}</td>
                  <td className="num">{formatMoney(data.totals.owed)}</td>
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
