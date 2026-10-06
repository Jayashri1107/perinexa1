// Hospital analytics – numbers only, never a patient's name.
// Doctors see exact numbers and can look at only their own patients; for the hospital admin, numbers from 1 to 4
// are shown as "fewer than 5" so no single patient can be recognised.
import { Baby, Banknote, HeartPulse, Pill, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { analyticsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { BarList } from '../../components/BarList.jsx';
import { ChartCard } from '../../components/ChartCard.jsx';
import { CHART_COLORS, ColumnChart } from '../../components/charts/ColumnChart.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { countText, countValue, formatMoney, monthText } from '../../utils/format.js';

const shortMonth = (ym) => new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(`${ym}-01T00:00:00`));
const isHidden = (v) => v && typeof v === 'object';
const toBars = (rows) => rows.filter((r) => isHidden(r.count) || r.count > 0).map((r, i) => ({ key: r.key ?? r.label ?? i, label: r.label, value: countValue(r.count), text: countText(r.count) }));
const sum = (rows, key) => rows.reduce((n, r) => n + r[key], 0);

export function AnalyticsPage() {
  const { activeMembership } = useAuth();
  const [mine, setMine] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    analyticsApi.get(mine).then(setData).catch((err) => setError(err.message));
  }, [mine]);

  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  const { patients, finance, pharmacy } = data;
  const thisMonth = patients.byMonth.at(-1);
  const monthTable = (columns, rows, pick) => ({ columns: ['Month', ...columns], rows: [...rows].reverse().map((m) => [monthText(m.month), ...pick(m)]) });
  const careBars = toBars(patients.byCareType);
  const ageBars = toBars(patients.byAge);

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle={`${data.mine ? 'My patients' : activeMembership?.hospital.name} · last ${patients.byMonth.length} months`}
        actions={data.canFilterMine && (
          <div className="segmented" role="radiogroup" aria-label="Whose patients">
            <button type="button" role="radio" aria-checked={!mine} className={!mine ? 'on' : ''} onClick={() => setMine(false)}>Whole hospital</button>
            <button type="button" role="radio" aria-checked={mine} className={mine ? 'on' : ''} onClick={() => setMine(true)}>My patients</button>
          </div>
        )}
      />
      {!data.exact && (
        <Alert type="info">
          Small numbers (1 to {data.smallNumberBelow - 1}) are shown as “fewer than {data.smallNumberBelow}” so that no patient can be recognised.
        </Alert>
      )}

      <div className="stat-grid">
        <StatCard icon={HeartPulse} label="Patients under care" value={countText(patients.active)} hint={`${countText(patients.total)} registered in all`} />
        <StatCard icon={UserPlus} label="New this month" value={countText(thisMonth?.count)} hint={monthText(thisMonth.month)} tone="info" />
        <StatCard icon={Baby} label={`Due in ${patients.dueSoonDays} days`} value={countText(patients.dueSoon)} hint="Pregnancies by their due date" tone="warning" />
        {finance ? (
          <StatCard icon={Banknote} label="Received this month" value={formatMoney(finance.at(-1).collected)} hint={`${formatMoney(finance.at(-1).billed)} billed`} tone="neutral" />
        ) : pharmacy ? (
          <StatCard icon={Pill} label="Pharmacy this month" value={formatMoney(pharmacy.at(-1).net)} hint={`${pharmacy.at(-1).sales} sales`} tone="neutral" />
        ) : null}
      </div>

      <div className="grid-2">
        <ChartCard title="New patients" subtitle="Registered each month" table={monthTable(['New patients'], patients.byMonth, (m) => [countText(m.count)])} className="span-2">
          <ColumnChart
            title="New patients per month"
            data={patients.byMonth.map((m) => ({ label: shortMonth(m.month), values: [countValue(m.count)], texts: isHidden(m.count) ? [countText(m.count)] : undefined }))}
            series={[{ label: 'New patients', color: CHART_COLORS[0] }]}
            integer
            empty="No patients registered in this period."
          />
        </ChartCard>

        <ChartCard title="Type of care" subtitle="Patients under care now">
          {careBars.length ? <BarList rows={careBars} /> : <p className="chart-empty muted">No patients under care yet.</p>}
        </ChartCard>

        <ChartCard title="Age" subtitle="Patients under care now, in years">
          {ageBars.length ? <BarList rows={ageBars} /> : <p className="chart-empty muted">No patients under care yet.</p>}
        </ChartCard>

        {finance && (
          <ChartCard
            title="Billed and received"
            subtitle={`${formatMoney(sum(finance, 'billed'))} billed · ${formatMoney(sum(finance, 'collected'))} received in this period`}
            table={monthTable(['Billed', 'Received'], finance, (m) => [formatMoney(m.billed), formatMoney(m.collected)])}
          >
            <ColumnChart
              title="Billed and received per month"
              data={finance.map((m) => ({ label: shortMonth(m.month), values: [m.billed, m.collected] }))}
              series={[{ label: 'Billed', color: CHART_COLORS[0] }, { label: 'Received', color: CHART_COLORS[1] }]}
              format={formatMoney}
              empty="No bills in this period."
            />
          </ChartCard>
        )}

        {pharmacy && (
          <ChartCard
            title="Pharmacy sales"
            subtitle={`${formatMoney(sum(pharmacy, 'net'))} in this period, after returns`}
            table={monthTable(['Sales', 'Net'], pharmacy, (m) => [m.sales, formatMoney(m.net)])}
          >
            <ColumnChart
              title="Pharmacy sales per month"
              data={pharmacy.map((m) => ({ label: shortMonth(m.month), values: [m.net] }))}
              series={[{ label: 'Pharmacy sales', color: CHART_COLORS[0] }]}
              format={formatMoney}
              empty="No pharmacy sales in this period."
            />
          </ChartCard>
        )}
      </div>
    </>
  );
}
