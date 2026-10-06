// Hospital analytics – numbers only. Doctors see exact numbers and can look at their own patients; for the others,
// small numbers are shown as "fewer than N" so no single patient can be recognised.
import { Baby, CalendarClock, HeartPulse, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { analyticsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { BarList } from '../../components/BarList.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { countText, countValue, formatMoney, monthText } from '../../utils/format.js';

const toBars = (rows, labelKey = 'label') => rows.map((r, i) => ({ key: r.key ?? r.month ?? `${i}`, label: r[labelKey] ?? monthText(r.month), value: countValue(r.count), text: countText(r.count) }));

export function AnalyticsPage() {
  const [mine, setMine] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    analyticsApi.get(mine).then(setData).catch((err) => setError(err.message));
  }, [mine]);

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle={data && !data.exact ? `Numbers from 1 to ${data.smallNumberBelow - 1} are shown as “fewer than ${data.smallNumberBelow}” to protect privacy.` : 'Numbers only – no patient names.'}
        actions={data?.canFilterMine && (
          <div className="checkbox-group">
            <label className={`chip-check${!mine ? ' checked' : ''}`}><input type="radio" name="whose" checked={!mine} onChange={() => setMine(false)} /> Whole hospital</label>
            <label className={`chip-check${mine ? ' checked' : ''}`}><input type="radio" name="whose" checked={mine} onChange={() => setMine(true)} /> My patients</label>
          </div>
        )}
      />
      <Alert type="error">{error}</Alert>
      {!data && !error && <Loader />}
      {data && (
        <>
          <div className="stat-grid">
            <StatCard icon={HeartPulse} label="Open records" value={countText(data.patients.active)} hint={`${countText(data.patients.total)} patients in all`} />
            <StatCard icon={UserPlus} label="New this month" value={countText(data.patients.byMonth.at(-1)?.count)} tone="info" />
            <StatCard icon={Baby} label={`Due in ${data.patients.dueSoonDays} days`} value={countText(data.patients.dueSoon)} hint="Pregnancies by EDD" tone="warning" />
            <StatCard icon={CalendarClock} label="Months shown" value={data.patients.byMonth.length} tone="neutral" />
          </div>
          <div className="grid-2">
            <section className="card"><h2>Open records by type of care</h2><BarList rows={toBars(data.patients.byCareType)} /></section>
            <section className="card"><h2>Age</h2><BarList rows={toBars(data.patients.byAge)} /></section>
            <section className="card span-2"><h2>New patients per month</h2><BarList rows={toBars(data.patients.byMonth)} /></section>
            {data.finance && (
              <section className="card">
                <h2>Billed and received per month</h2>
                <table className="table">
                  <thead><tr><th>Month</th><th className="num">Billed</th><th className="num">Received</th></tr></thead>
                  <tbody>
                    {[...data.finance].reverse().map((m) => (
                      <tr key={m.month}><td>{monthText(m.month)}</td><td className="num">{formatMoney(m.billed)}</td><td className="num">{formatMoney(m.collected)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
            {data.pharmacy && (
              <section className="card">
                <h2>Pharmacy sales per month</h2>
                <table className="table">
                  <thead><tr><th>Month</th><th className="num">Sales</th><th className="num">Net</th></tr></thead>
                  <tbody>
                    {[...data.pharmacy].reverse().map((m) => (
                      <tr key={m.month}><td>{monthText(m.month)}</td><td className="num">{m.sales}</td><td className="num">{formatMoney(m.net)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </div>
        </>
      )}
    </>
  );
}
