// Who owes how much, since when – with the phone number to call. Oldest first.
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { billingReportsApi } from '../../api/index.js';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { usePagedList } from '../../hooks/usePagedList.js';
import { formatDate, formatMoney } from '../../utils/format.js';
import { BillingFrame } from './BillingFrame.jsx';

const DAY = 86400000;

export function UnpaidPage() {
  const navigate = useNavigate();
  const [totals, setTotals] = useState(null);
  const fetchPage = useCallback(async (q) => {
    const result = await billingReportsApi.unpaid(q);
    setTotals(result.totals);
    return result;
  }, []);
  const list = usePagedList(fetchPage);

  const columns = [
    { key: 'billNumber', label: 'Bill', className: 'nowrap', render: (b) => <strong>{b.billNumber}</strong> },
    { key: 'patient', label: 'Patient', render: (b) => (<>{b.patient?.name}<span className="muted block small">{b.patient?.patientNumber}</span></>) },
    { key: 'phone', label: 'Phone', render: (b) => (b.phone ? <a href={`tel:${b.phone}`}>{b.phone}</a> : '—') },
    { key: 'since', label: 'Since', className: 'nowrap', render: (b) => `${formatDate(b.createdAt)} (${Math.floor((Date.now() - new Date(b.createdAt)) / DAY)} days)` },
    { key: 'total', label: 'Total', className: 'num', render: (b) => formatMoney(b.total) },
    { key: 'balance', label: 'Owed', className: 'num', render: (b) => <strong>{formatMoney(b.balance)}</strong> },
  ];

  return (
    <BillingFrame subtitle={totals ? `${totals.bills} bills · ${formatMoney(totals.owed)} owed in all` : 'Bills with money still owed'}>
      <ListPanel list={list} columns={columns} searchPlaceholder="Patient or bill number" emptyText="Nothing is owed." onRowClick={(b) => navigate(`/hospital/billing/bills/${b.id}`)} />
    </BillingFrame>
  );
}
