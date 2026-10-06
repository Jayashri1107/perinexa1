// Money in and out on one day: by mode, by person, and the bills of the day.
import { useEffect, useState } from 'react';
import { billingReportsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { DataTable } from '../../components/list/DataTable.jsx';
import { Loader } from '../../components/Loader.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { formatMoney, todayInput } from '../../utils/format.js';
import { BillingFrame } from './BillingFrame.jsx';
import { Banknote, Receipt, Undo2 } from 'lucide-react';

export function DailySummaryPage() {
  const [date, setDate] = useState(todayInput());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    billingReportsApi.daily(date).then(setData).catch((err) => setError(err.message));
  }, [date]);

  return (
    <BillingFrame
      subtitle="Cash, UPI, card and insurance received on one day"
      actions={
        <label className="filter">
          <span>Day</span>
          <input type="date" value={date} max={todayInput()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
      }
    >
      <Alert type="error">{error}</Alert>
      {!data && !error && <Loader />}
      {data && (
        <>
          <div className="stat-grid">
            <StatCard icon={Banknote} label="Received" value={formatMoney(data.totals.payments)} tone="primary" />
            <StatCard icon={Undo2} label="Refunded" value={formatMoney(data.totals.refunds)} tone="warning" />
            <StatCard icon={Banknote} label="Net in hand" value={formatMoney(data.totals.net)} tone="info" />
            <StatCard icon={Receipt} label="Bills made" value={data.bills.created} hint={`${formatMoney(data.bills.billed)} billed · ${formatMoney(data.bills.discounts)} discounts`} tone="neutral" />
          </div>
          <div className="grid-2">
            <section className="card list-panel">
              <h2 className="pad">By mode</h2>
              <DataTable
                rowKey="mode"
                columns={[
                  { key: 'label', label: 'Mode' },
                  { key: 'count', label: 'Entries', className: 'num' },
                  { key: 'payments', label: 'Received', className: 'num', render: (m) => formatMoney(m.payments) },
                  { key: 'refunds', label: 'Refunded', className: 'num', render: (m) => formatMoney(m.refunds) },
                ]}
                rows={data.byMode}
              />
            </section>
            <section className="card list-panel">
              <h2 className="pad">By person</h2>
              <DataTable
                rowKey="name"
                columns={[
                  { key: 'name', label: 'Collected by' },
                  { key: 'count', label: 'Entries', className: 'num' },
                  { key: 'net', label: 'Net', className: 'num', render: (p) => formatMoney(p.net) },
                ]}
                rows={data.byPerson}
                emptyText="Nothing received this day."
              />
            </section>
          </div>
        </>
      )}
    </BillingFrame>
  );
}
