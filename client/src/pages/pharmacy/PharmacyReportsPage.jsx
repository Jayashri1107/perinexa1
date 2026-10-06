// Pharmacy reports: alerts, expiry, stock value, sales and GST for a period, and the H1 / X / narcotic registers.
import { AlertTriangle, CalendarX, PackageMinus, Wallet } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { pharmacyReportsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { DataTable } from '../../components/list/DataTable.jsx';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { usePagedList } from '../../hooks/usePagedList.js';
import { formatDate, formatDateTime, formatMoney, todayInput } from '../../utils/format.js';
import { PharmacyFrame } from './PharmacyFrame.jsx';

const monthStartInput = () => `${todayInput().slice(0, 8)}01`;

function Period({ value, onChange }) {
  return (
    <div className="toolbar">
      <label className="filter"><span>From</span><input type="date" value={value.from} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} /></label>
      <label className="filter"><span>To</span><input type="date" value={value.to} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} /></label>
    </div>
  );
}

function Register({ period }) {
  const { pharmacy } = useAppConfig();
  const registers = pharmacy.schedules.filter((s) => s.register);
  const [schedule, setSchedule] = useState(registers[0]?.key);
  const fetchPage = useCallback((q) => pharmacyReportsApi.register({ ...q, schedule, ...period }), [schedule, period]);
  const list = usePagedList(fetchPage);
  const KIND = { purchase: 'Received', sale: 'Sold', return: 'Returned', writeoff: 'Written off', count: 'Count correction' };
  return (
    <>
      <div className="section-head">
        <h2>Registers</h2>
        <label className="filter">
          <span>Register</span>
          <select value={schedule} onChange={(e) => setSchedule(e.target.value)}>
            {registers.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>
      </div>
      <ListPanel
        list={list}
        columns={[
          { key: 'createdAt', label: 'Date', className: 'nowrap', render: (m) => formatDateTime(m.createdAt) },
          { key: 'medicineName', label: 'Medicine' },
          { key: 'batch', label: 'Batch' },
          { key: 'kind', label: 'Entry', render: (m) => KIND[m.kind] ?? m.kind },
          { key: 'qty', label: 'Units', className: 'num', render: (m) => (m.qty > 0 ? `+${m.qty}` : m.qty) },
          { key: 'party', label: 'Supplier / patient', render: (m) => m.party || '—' },
          { key: 'doctorName', label: 'Doctor', render: (m) => m.doctorName || '—' },
          { key: 'ref', label: 'Invoice', render: (m) => m.ref || m.reason || '—' },
          { key: 'byName', label: 'By' },
        ]}
        emptyText="No entries in this period."
      />
    </>
  );
}

export function PharmacyReportsPage() {
  const [period, setPeriod] = useState({ from: monthStartInput(), to: todayInput() });
  const [alerts, setAlerts] = useState(null);
  const [value, setValue] = useState(null);
  const [expiry, setExpiry] = useState(null);
  const [sales, setSales] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([pharmacyReportsApi.alerts(), pharmacyReportsApi.value(), pharmacyReportsApi.expiry()])
      .then(([a, v, e]) => {
        setAlerts(a);
        setValue(v);
        setExpiry(e);
      })
      .catch((err) => setError(err.message));
  }, []);
  useEffect(() => {
    if (period.from > period.to) return;
    pharmacyReportsApi.sales(period.from, period.to).then(setSales).catch((err) => setError(err.message));
  }, [period]);

  const batchColumns = [
    { key: 'medicine', label: 'Medicine', render: (b) => `${b.medicine?.name ?? ''} ${b.medicine?.strength ?? ''}` },
    { key: 'batch', label: 'Batch' },
    { key: 'expiry', label: 'Expiry', className: 'nowrap', render: (b) => formatDate(b.expiry) },
    { key: 'qty', label: 'Units', className: 'num' },
    { key: 'value', label: 'Value at cost', className: 'num', render: (b) => formatMoney(b.qty * b.purchasePrice) },
  ];

  return (
    <PharmacyFrame subtitle="Alerts, stock value, sales, GST and the legal registers">
      <Alert type="error">{error}</Alert>
      {alerts && value && (
        <div className="stat-grid">
          <StatCard icon={PackageMinus} label="Low stock" value={alerts.lowStock} hint="At or below the reorder level" tone="warning" />
          <StatCard icon={AlertTriangle} label="Expiring soon" value={alerts.expiringSoon} hint={`Batches within ${expiry?.alertDays ?? ''} days`} tone="warning" />
          <StatCard icon={CalendarX} label="Expired with stock" value={alerts.expired} hint="Write off or return" tone="neutral" />
          <StatCard icon={Wallet} label="Stock value" value={formatMoney(value.atCost)} hint={`${formatMoney(value.atMrp)} at MRP`} />
        </div>
      )}

      {expiry && (
        <div className="grid-2">
          <section className="card list-panel">
            <h2 className="pad">Expiring soon</h2>
            <DataTable columns={batchColumns} rows={expiry.expiringSoon} emptyText="Nothing expires soon." />
          </section>
          <section className="card list-panel">
            <h2 className="pad">Expired, still in stock</h2>
            <DataTable columns={batchColumns} rows={expiry.expired} emptyText="No expired stock." />
          </section>
        </div>
      )}

      <div className="section-head">
        <h2>Sales and GST</h2>
        <Period value={period} onChange={setPeriod} />
      </div>
      {sales && (
        <div className="grid-2">
          <section className="card list-panel">
            <h2 className="pad">By day · {sales.totals.sales} sales · {formatMoney(sales.totals.net)} net</h2>
            <DataTable
              rowKey="date"
              columns={[
                { key: 'date', label: 'Day', className: 'nowrap', render: (d) => formatDate(d.date) },
                { key: 'sales', label: 'Sales', className: 'num' },
                { key: 'total', label: 'Sold', className: 'num', render: (d) => formatMoney(d.total) },
                { key: 'returned', label: 'Returned', className: 'num', render: (d) => formatMoney(d.returned) },
                { key: 'toBill', label: 'On bills', className: 'num', render: (d) => formatMoney(d.toBill) },
                { key: 'net', label: 'Net', className: 'num', render: (d) => formatMoney(d.net) },
              ]}
              rows={sales.byDay}
              emptyText="No sales in this period."
            />
          </section>
          <section className="card list-panel">
            <h2 className="pad">GST summary (before returns)</h2>
            <DataTable
              rowKey="rate"
              columns={[
                { key: 'rate', label: 'GST rate', render: (g) => `${g.rate}%` },
                { key: 'taxable', label: 'Taxable value', className: 'num', render: (g) => formatMoney(g.taxable) },
                { key: 'gst', label: 'GST', className: 'num', render: (g) => formatMoney(g.gst) },
                { key: 'gross', label: 'Total', className: 'num', render: (g) => formatMoney(g.gross) },
              ]}
              rows={sales.gstByRate}
              emptyText="No sales in this period."
            />
          </section>
        </div>
      )}

      {period.from <= period.to && <Register period={period} />}
    </PharmacyFrame>
  );
}
