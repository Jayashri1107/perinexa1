// Hospital analytics – numbers only, never a patient's name. In sections a person can read top to bottom: at a
// glance (this month against last month), OPD, patients, wards, lab and money. Every chart says in words what it
// shows (the total of the period and the busiest month) and can be read as a table.
// Doctors see exact numbers and can look at only their own patients; for the hospital admin, numbers from 1 to 4 are
// shown as "fewer than 5" so no single patient can be recognised.
import { Baby, Banknote, BedDouble, FlaskConical, HeartPulse, Minus, Pill, Stethoscope, TrendingDown, TrendingUp } from 'lucide-react';
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
const total = (rows, key) => rows.reduce((n, r) => n + countValue(r[key]), 0);
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : null);

// This month against last month: "up 20% from Sep" (with an icon, never colour alone).
function Trend({ rows, k, money = false }) {
  const now = rows.at(-1);
  const before = rows.at(-2);
  if (!now || !before || isHidden(now[k]) || isHidden(before[k])) return null;
  const a = now[k];
  const b = before[k];
  if (a === b) return <span className="trend"><Minus size={13} aria-hidden /> same as {shortMonth(before.month)}</span>;
  if (b === 0) return <span className="trend up"><TrendingUp size={13} aria-hidden /> up from none in {shortMonth(before.month)}</span>;
  const change = Math.round(((a - b) / b) * 100);
  const Icon = change > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`trend ${change > 0 ? 'up' : 'down'}`}>
      <Icon size={13} aria-hidden /> {change > 0 ? 'up' : 'down'} {Math.abs(change)}% from {shortMonth(before.month)}
      {money && ` (${formatMoney(b)})`}
    </span>
  );
}

// "48 visits in 12 months · busiest: Aug 2026 (9)"
function summary(rows, k, unit, format = (n) => n) {
  const sum = total(rows, k);
  if (!sum) return `No ${unit} in this period`;
  const busiest = rows.reduce((best, r) => (countValue(r[k]) > countValue(best[k]) ? r : best), rows[0]);
  return `${format(sum)} ${unit} in ${rows.length} months · busiest: ${monthText(busiest.month)} (${format(countValue(busiest[k]))})`;
}

const monthTable = (columns, rows, pick) => ({ columns: ['Month', ...columns], rows: [...rows].reverse().map((m) => [monthText(m.month), ...pick(m)]) });
const chartRows = (rows, keys) =>
  rows.map((m) => ({
    label: shortMonth(m.month),
    values: keys.map((k) => countValue(m[k])),
    texts: keys.some((k) => isHidden(m[k])) ? keys.map((k) => (isHidden(m[k]) ? countText(m[k]) : undefined)) : undefined,
  }));

function Section({ title, icon: Icon, children }) {
  return (
    <section className="analytics-section">
      <h2 className="section-title"><Icon size={18} aria-hidden /> {title}</h2>
      <div className="grid-2">{children}</div>
    </section>
  );
}

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
  const { patients, clinical, finance, pharmacy } = data;
  const c = clinical.byMonth;
  const thisMonth = c.at(-1);
  const careBars = toBars(patients.byCareType);
  const ageBars = toBars(patients.byAge);
  const kept = total(c, 'seen');
  const missed = total(c, 'noShow');
  const attendance = pct(kept, kept + missed);
  const deliveries = total(c, 'deliveries');
  const caesareanShare = pct(total(c, 'caesarean'), deliveries);
  const abnormalShare = pct(total(c, 'labAbnormal'), total(c, 'labOrders'));

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle={`${data.mine ? 'My patients' : activeMembership?.hospital.name} · last ${c.length} months, this month compared with the one before`}
        actions={data.canFilterMine && (
          <div className="segmented" role="radiogroup" aria-label="Whose patients">
            <button type="button" role="radio" aria-checked={!mine} className={!mine ? 'on' : ''} onClick={() => setMine(false)}>Whole hospital</button>
            <button type="button" role="radio" aria-checked={mine} className={mine ? 'on' : ''} onClick={() => setMine(true)}>My patients</button>
          </div>
        )}
      />
      {!data.exact && (
        <Alert type="info">Small numbers (1 to {data.smallNumberBelow - 1}) are shown as “fewer than {data.smallNumberBelow}” so that no patient can be recognised.</Alert>
      )}

      <h2 className="section-title">This month at a glance</h2>
      <div className="stat-grid">
        <StatCard icon={HeartPulse} label="Patients under care" value={countText(patients.active)} hint={<><span className="block">{countText(patients.byMonth.at(-1).count)} new this month</span><Trend rows={patients.byMonth} k="count" /></>} />
        <StatCard icon={Stethoscope} label="OPD visits this month" value={countText(thisMonth.visits)} hint={<Trend rows={c} k="visits" />} tone="info" />
        <StatCard icon={BedDouble} label="In hospital now" value={countText(clinical.admittedNow)} hint={clinical.averageStayDays != null ? `Average stay ${clinical.averageStayDays} days` : 'No discharges yet'} tone="neutral" />
        <StatCard icon={Baby} label="Deliveries this month" value={countText(thisMonth.deliveries)} hint={<Trend rows={c} k="deliveries" />} tone="warning" />
        <StatCard icon={FlaskConical} label="Lab orders this month" value={countText(thisMonth.labOrders)} hint={<Trend rows={c} k="labOrders" />} tone="info" />
        {finance && <StatCard icon={Banknote} label="Received this month" value={formatMoney(finance.at(-1).collected)} hint={<Trend rows={finance} k="collected" money />} tone="neutral" />}
        {!finance && pharmacy && <StatCard icon={Pill} label="Pharmacy this month" value={formatMoney(pharmacy.at(-1).net)} hint={<Trend rows={pharmacy} k="net" money />} tone="neutral" />}
      </div>

      <Section title="OPD" icon={Stethoscope}>
        <ChartCard title="Visits" subtitle={summary(c, 'visits', 'visits')} table={monthTable(['Visits'], c, (m) => [countText(m.visits)])}>
          <ColumnChart title="OPD visits per month" data={chartRows(c, ['visits'])} series={[{ label: 'Visits', color: CHART_COLORS[0] }]} integer empty="No visits recorded in this period." />
        </ChartCard>
        <ChartCard
          title="Appointments kept"
          subtitle={attendance == null ? 'No past appointments in this period' : `${attendance}% of booked patients came (${kept} seen, ${missed} did not come)`}
          table={monthTable(['Seen', 'Did not come', 'Cancelled'], c, (m) => [countText(m.seen), countText(m.noShow), countText(m.cancelled)])}
        >
          <ColumnChart title="Appointments seen and missed per month" data={chartRows(c, ['seen', 'noShow'])} series={[{ label: 'Seen', color: CHART_COLORS[0] }, { label: 'Did not come', color: CHART_COLORS[1] }]} integer empty="No past appointments in this period." />
        </ChartCard>
      </Section>

      <Section title="Patients" icon={HeartPulse}>
        <ChartCard title="New patients" subtitle={summary(patients.byMonth, 'count', 'registered')} table={monthTable(['New patients'], patients.byMonth, (m) => [countText(m.count)])} className="span-2">
          <ColumnChart title="New patients per month" data={chartRows(patients.byMonth, ['count'])} series={[{ label: 'New patients', color: CHART_COLORS[0] }]} integer empty="No patients registered in this period." />
        </ChartCard>
        <ChartCard title="Type of care" subtitle={`Patients under care now · due in ${patients.dueSoonDays} days: ${countText(patients.dueSoon)}`}>
          {careBars.length ? <BarList rows={careBars} /> : <p className="chart-empty muted">No patients under care yet.</p>}
        </ChartCard>
        <ChartCard title="Age" subtitle="Patients under care now, in years">
          {ageBars.length ? <BarList rows={ageBars} /> : <p className="chart-empty muted">No patients under care yet.</p>}
        </ChartCard>
      </Section>

      <Section title="Wards" icon={BedDouble}>
        <ChartCard title="Admissions" subtitle={`${summary(c, 'admissions', 'admissions')}${clinical.averageStayDays != null ? ` · average stay ${clinical.averageStayDays} days` : ''}`} table={monthTable(['Admissions'], c, (m) => [countText(m.admissions)])}>
          <ColumnChart title="Admissions per month" data={chartRows(c, ['admissions'])} series={[{ label: 'Admissions', color: CHART_COLORS[0] }]} integer empty="No admissions in this period." />
        </ChartCard>
        <ChartCard title="Deliveries" subtitle={deliveries ? `${deliveries} signed delivery notes · ${caesareanShare}% by caesarean section` : 'No signed delivery notes in this period'} table={monthTable(['Deliveries', 'Caesarean'], c, (m) => [countText(m.deliveries), countText(m.caesarean)])}>
          <ColumnChart title="Deliveries per month" data={chartRows(c, ['deliveries', 'caesarean'])} series={[{ label: 'Deliveries', color: CHART_COLORS[0] }, { label: 'Of them caesarean', color: CHART_COLORS[1] }]} integer empty="No deliveries in this period." />
        </ChartCard>
      </Section>

      <Section title="Lab" icon={FlaskConical}>
        <ChartCard title="Lab orders" subtitle={abnormalShare == null ? 'No lab orders in this period' : `${summary(c, 'labOrders', 'orders')} · ${abnormalShare}% had a result outside its range`} table={monthTable(['Orders', 'With a result outside range'], c, (m) => [countText(m.labOrders), countText(m.labAbnormal)])} className="span-2">
          <ColumnChart title="Lab orders per month" data={chartRows(c, ['labOrders', 'labAbnormal'])} series={[{ label: 'Orders', color: CHART_COLORS[0] }, { label: 'Result outside range', color: CHART_COLORS[1] }]} integer empty="No lab orders in this period." />
        </ChartCard>
      </Section>

      {(finance || pharmacy) && (
        <Section title="Money" icon={Banknote}>
          {finance && (
            <ChartCard title="Billed and received" subtitle={`${formatMoney(total(finance, 'billed'))} billed · ${formatMoney(total(finance, 'collected'))} received in this period`} table={monthTable(['Billed', 'Received'], finance, (m) => [formatMoney(m.billed), formatMoney(m.collected)])}>
              <ColumnChart title="Billed and received per month" data={finance.map((m) => ({ label: shortMonth(m.month), values: [m.billed, m.collected] }))} series={[{ label: 'Billed', color: CHART_COLORS[0] }, { label: 'Received', color: CHART_COLORS[1] }]} format={formatMoney} empty="No bills in this period." />
            </ChartCard>
          )}
          {pharmacy && (
            <ChartCard title="Pharmacy sales" subtitle={summary(pharmacy, 'net', 'in sales', formatMoney)} table={monthTable(['Sales', 'Net'], pharmacy, (m) => [m.sales, formatMoney(m.net)])}>
              <ColumnChart title="Pharmacy sales per month" data={pharmacy.map((m) => ({ label: shortMonth(m.month), values: [m.net] }))} series={[{ label: 'Pharmacy sales', color: CHART_COLORS[0] }]} format={formatMoney} empty="No pharmacy sales in this period." />
            </ChartCard>
          )}
        </Section>
      )}
    </>
  );
}
