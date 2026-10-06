// The super admin's analytics: the platform in four numbers, month-by-month charts, and every hospital compared.
import { Banknote, HeartPulse, Pill, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { platformAnalyticsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { BarList } from '../../components/BarList.jsx';
import { ChartCard } from '../../components/ChartCard.jsx';
import { CHART_COLORS, ColumnChart } from '../../components/charts/ColumnChart.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { formatMoney, monthText } from '../../utils/format.js';

const shortMonth = (ym) => new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(`${ym}-01T00:00:00`));

export function PlatformAnalyticsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    platformAnalyticsApi.get().then(setData).catch((err) => setError(err.message));
  }, []);

  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  const { totals, trend, hospitals } = data;
  const monthTable = (columns, pick) => ({ columns: ['Month', ...columns], rows: [...trend].reverse().map((m) => [monthText(m.month), ...pick(m)]) });

  return (
    <>
      <PageHeader title="Analytics" subtitle="All hospitals together · money figures are this month" />

      <div className="stat-grid">
        <StatCard icon={HeartPulse} label="Patients" value={totals.patients.toLocaleString('en-IN')} hint={`${totals.active} open records`} />
        <StatCard icon={UserPlus} label="New this month" value={totals.newThisMonth} hint={`${totals.pregnancies} ongoing pregnancies`} tone="info" />
        <StatCard icon={Banknote} label="Received" value={formatMoney(totals.collectedThisMonth)} hint={`${formatMoney(totals.billedThisMonth)} billed`} tone="neutral" />
        <StatCard icon={Pill} label="Pharmacy sales" value={formatMoney(totals.pharmacyThisMonth)} hint="Net of returns" tone="warning" />
      </div>

      <div className="grid-2">
        <ChartCard title="New patients" subtitle="Registered per month, all hospitals" table={monthTable(['New patients'], (m) => [m.newPatients])}>
          <ColumnChart title="New patients per month" data={trend.map((m) => ({ label: shortMonth(m.month), values: [m.newPatients] }))} series={[{ label: 'New patients', color: CHART_COLORS[0] }]} integer empty="No patients registered in this period." />
        </ChartCard>

        <ChartCard title="Billed and received" subtitle="Per month, all hospitals" table={monthTable(['Billed', 'Received'], (m) => [formatMoney(m.billed), formatMoney(m.received)])}>
          <ColumnChart
            title="Billed and received per month"
            data={trend.map((m) => ({ label: shortMonth(m.month), values: [m.billed, m.received] }))}
            series={[{ label: 'Billed', color: CHART_COLORS[0] }, { label: 'Received', color: CHART_COLORS[1] }]}
            format={formatMoney}
            empty="No bills in this period."
          />
        </ChartCard>

        <ChartCard title="Pharmacy sales" subtitle="Per month, net of returns" table={monthTable(['Sales'], (m) => [formatMoney(m.pharmacy)])}>
          <ColumnChart title="Pharmacy sales per month" data={trend.map((m) => ({ label: shortMonth(m.month), values: [m.pharmacy] }))} series={[{ label: 'Pharmacy sales', color: CHART_COLORS[0] }]} format={formatMoney} empty="No pharmacy sales in this period." />
        </ChartCard>

        <ChartCard title="Patients by hospital" subtitle="All patients registered">
          <BarList rows={[...hospitals].sort((a, b) => b.patients - a.patients).map((h) => ({ key: h.id, label: h.name, value: h.patients }))} />
        </ChartCard>
      </div>

      <h2 className="top-gap">Every hospital</h2>
      <section className="card list-panel">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Hospital</th><th className="num">Patients</th><th className="num">New</th><th className="num">Pregnancies</th><th className="num">Staff</th>
                <th className="num">Billed</th><th className="num">Received</th><th className="num">Pharmacy</th>
              </tr>
            </thead>
            <tbody>
              {hospitals.map((h) => (
                <tr key={h.id}>
                  <td><Link to={`/hospitals/${h.id}`}>{h.name}</Link></td>
                  <td className="num">{h.patients}</td><td className="num">{h.newThisMonth}</td><td className="num">{h.pregnancies}</td><td className="num">{h.staff}</td>
                  <td className="num">{formatMoney(h.billedThisMonth)}</td><td className="num">{formatMoney(h.collectedThisMonth)}</td><td className="num">{formatMoney(h.pharmacyThisMonth)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
