import { Plus, Printer } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { billsApi } from '../../api/index.js';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { BillStatus } from './BillStatus.jsx';
import { usePagedList } from '../../hooks/usePagedList.js';
import { formatDateTime, formatMoney } from '../../utils/format.js';
import { BillingFrame } from './BillingFrame.jsx';

const STATUS_FILTER = {
  name: 'status',
  label: 'Status',
  options: [
    { value: 'open', label: 'Open' },
    { value: 'unpaid', label: 'Unpaid' },
    { value: 'partial', label: 'Part paid' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'paid', label: 'Paid' },
    { value: 'refund_due', label: 'Refund due' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
};

export function BillsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const patientId = params.get('patientId');
  // ?status=overdue (from Today's "View overdue") opens the list with that filter chosen
  const status = STATUS_FILTER.options.some((o) => o.value === params.get('status')) ? params.get('status') : null;
  const list = usePagedList(billsApi.list, { ...(patientId && { patientId }), ...(status && { status }) });

  const columns = [
    { key: 'billNumber', label: 'Bill', className: 'nowrap', render: (b) => <strong>{b.billNumber}</strong> },
    { key: 'createdAt', label: 'Date', className: 'nowrap', render: (b) => formatDateTime(b.createdAt) },
    { key: 'patient', label: 'Patient', render: (b) => (<>{b.patient?.name}<span className="muted block small">{b.patient?.patientNumber}</span></>) },
    { key: 'total', label: 'Total', className: 'num', render: (b) => formatMoney(b.total) },
    { key: 'paid', label: 'Paid', className: 'num', render: (b) => formatMoney((b.paid ?? 0) - (b.refunded ?? 0)) },
    { key: 'balance', label: 'Balance', className: 'num', render: (b) => formatMoney(b.balance) },
    { key: 'status', label: 'Status', render: (b) => <BillStatus bill={b} /> },
    {
      key: 'print',
      label: '',
      className: 'actions',
      // Opens the printed bill in a new tab (the row itself still opens the bill)
      render: (b) => (
        <a
          href={`/hospital/print/bill/${b.id}`}
          target="_blank"
          rel="noreferrer"
          className="btn btn-ghost btn-sm"
          aria-label={`Print bill ${b.billNumber}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Printer size={14} aria-hidden /> Print
        </a>
      ),
    },
  ];

  return (
    <BillingFrame
      subtitle={patientId ? 'Patient account: all her bills, with what was billed, paid and is still due' : 'All bills, newest first. A patient can have several bills.'}
      actions={
        <button type="button" className="btn btn-primary" onClick={() => navigate(`/hospital/billing/new${patientId ? `?patientId=${patientId}` : ''}`)}>
          <Plus size={16} aria-hidden /> New bill
        </button>
      }
    >
      {list.summary && list.summary.bills > 0 && (
        <dl className="totals bills-summary">
          <dt>{list.summary.bills} {list.summary.bills === 1 ? 'bill' : 'bills'} (cancelled left out)</dt><dd></dd>
          <dt>Total billed</dt><dd>{formatMoney(list.summary.total)}</dd>
          <dt>Paid</dt><dd>{formatMoney(list.summary.paid)}</dd>
          <dt><strong>Balance to collect</strong></dt><dd><strong>{formatMoney(list.summary.balance)}</strong></dd>
        </dl>
      )}
      <ListPanel list={list} columns={columns} filters={[STATUS_FILTER]} searchPlaceholder="Bill number or patient" emptyText="No bills yet." onRowClick={(b) => navigate(`/hospital/billing/bills/${b.id}`)} />
    </BillingFrame>
  );
}
