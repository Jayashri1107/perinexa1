// Pharmacy → Expiring (owner, 8 Oct 2026): the medicines whose stock runs out of date within the alert days
// (config.pharmacy.expiryAlertDays, 30) – soonest first, with the days left (red within a week), the units and their
// value – and the stock already expired (to write off or return). Opened from Today's alert.
import { CalendarClock, CalendarX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { pharmacyReportsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { formatDate, formatMoney } from '../../utils/format.js';
import { PharmacyFrame } from './PharmacyFrame.jsx';

const daysWord = (d) => (d <= 0 ? 'today' : d === 1 ? 'in 1 day' : `in ${d} days`);

function BatchTable({ rows, expired }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th>{expired ? 'Expired' : 'Expires'}</th><th className="num">Units</th><th className="num">Value (MRP)</th></tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id}>
              <td><strong>{b.medicine?.name}</strong> {b.medicine?.strength}</td>
              <td>{b.batch}</td>
              <td className="nowrap">{formatDate(b.expiry)}</td>
              <td>
                {expired ? (
                  <span className="badge badge-danger small"><CalendarX size={12} aria-hidden /> Expired</span>
                ) : (
                  <span className={`badge small ${b.daysLeft <= 7 ? 'badge-danger' : 'badge-pending'}`}><CalendarClock size={12} aria-hidden /> {daysWord(b.daysLeft)}</span>
                )}
              </td>
              <td className="num">{b.qty}</td>
              <td className="num">{formatMoney(b.qty * b.mrp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExpiringPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    pharmacyReportsApi.expiry().then(setData).catch((err) => setError(err.message));
  }, []);

  return (
    <PharmacyFrame subtitle={data ? `Medicines expiring within ${data.alertDays} days, soonest first` : 'Medicines expiring soon'}>
      <Alert type="error">{error}</Alert>
      {!data && !error && <Loader />}
      {data && (
        <>
          <section className="card">
            <div className="card-head">
              <h2><CalendarClock size={18} aria-hidden /> Expiring in the next {data.alertDays} days <span className="rxq-count">{data.expiringSoon.length}</span></h2>
              <span className="muted small">Sell these first, or return them to the supplier in time.</span>
            </div>
            {data.expiringSoon.length === 0 ? <p className="muted">Nothing expires in the next {data.alertDays} days.</p> : <BatchTable rows={data.expiringSoon} />}
          </section>
          <section className="card top-gap">
            <div className="card-head">
              <h2><CalendarX size={18} aria-hidden /> Already expired, still in stock <span className="rxq-count">{data.expired.length}</span></h2>
              <span className="muted small">Expired stock cannot be sold – write it off or return it.</span>
            </div>
            {data.expired.length === 0 ? <p className="muted">No expired stock.</p> : <BatchTable rows={data.expired} expired />}
          </section>
        </>
      )}
    </PharmacyFrame>
  );
}
