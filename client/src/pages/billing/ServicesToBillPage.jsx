// Billing → Nursing services (owner, 9 Oct 2026): what nurses gave – injections, dressings, IV drips … – waiting to go
// on a bill, oldest first; "Add to bill" puts it on the patient's open bill (or starts one) at the price when it was
// given. Below: those billed today, with their bill.
import { Receipt, Syringe } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { billingServicesApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { SectionTabs } from '../../components/SectionTabs.jsx';
import { BILLING_TABS } from '../../config/navigation.js';
import { formatDateTime, formatMoney } from '../../utils/format.js';

const what = (s) => s.items.map((i) => `${i.name}${i.qty > 1 ? ` × ${i.qty}` : ''}`).join(', ');
const where = (s) => (s.stay ? `${s.stay.ward}${s.stay.bed ? `, bed ${s.stay.bed}` : ''}` : 'Outpatient');

export function ServicesToBillPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    billingServicesApi.queue().then(setData).catch((err) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  const bill = async (s) => {
    setBusy(s.id);
    setError('');
    setNotice(null);
    try {
      const r = await billingServicesApi.bill(s.id);
      setNotice(r.bill);
      load();
    } catch (err) {
      setError(err.message);
      load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Billing" subtitle="Services nurses gave, waiting to go on the patient's bill." />
      <SectionTabs tabs={BILLING_TABS} label="Billing" />
      <Alert type="error">{error}</Alert>
      {notice && <Alert type="success">Added to bill <Link to={`/hospital/billing/bills/${notice.id}`}>{notice.billNumber}</Link> – the bill now comes to {formatMoney(notice.total)}.</Alert>}
      {!data && !error && <Loader />}
      {data && (
        <>
          <section className="card">
            <div className="card-head">
              <h2><Syringe size={18} aria-hidden /> Waiting to be billed <span className="muted small">{data.waiting.length} · {formatMoney(data.total)}</span></h2>
            </div>
            {data.waiting.length === 0 ? (
              <p className="muted">Nothing waiting. Services appear here when a nurse records them.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Given</th><th>Patient</th><th>Service</th><th>Nurse</th><th className="num">Amount</th><th aria-label="Actions" /></tr></thead>
                  <tbody>
                    {data.waiting.map((s) => (
                      <tr key={s.id}>
                        <td className="nowrap">{formatDateTime(s.givenAt)}<span className="muted small block">{s.serviceNumber}</span></td>
                        <td><Link to={`/hospital/patients/${s.patient.id}`}><strong>{s.patient.name}</strong></Link><span className="muted small block">{s.patient.patientNumber} · {where(s)}</span></td>
                        <td>{what(s)}{s.note && <span className="muted small block">{s.note}</span>}</td>
                        <td className="small">{s.givenByName}</td>
                        <td className="num"><strong>{formatMoney(s.amount)}</strong></td>
                        <td className="actions"><button type="button" className="btn btn-primary btn-sm" disabled={busy === s.id} onClick={() => bill(s)}><Receipt size={14} aria-hidden /> {busy === s.id ? 'Adding…' : 'Add to bill'}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small top-gap-sm">“Add to bill” puts it on the patient's open bill, or starts a new bill if she has none open.</p>
          </section>

          <section className="card top-gap">
            <h2>Billed today</h2>
            {data.billedToday.length === 0 ? (
              <p className="muted">None yet today.</p>
            ) : (
              <ul className="plain-list rows">
                {data.billedToday.map((s) => (
                  <li key={s.id}>
                    <span><strong>{s.patient.name}</strong> · {what(s)}<span className="muted block small">{s.serviceNumber} · by {s.billed.byName}, {formatDateTime(s.billed.at)}</span></span>
                    <span className="row-actions"><span>{formatMoney(s.amount)}</span><Link className="btn btn-ghost btn-sm" to={`/hospital/billing/bills/${s.billed.billId}`}>Bill {s.billed.billNumber}</Link></span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
