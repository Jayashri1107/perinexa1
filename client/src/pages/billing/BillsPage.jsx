import { Plus } from 'lucide-react';
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
    { value: 'paid', label: 'Paid' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
};

export function BillsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const patientId = params.get('patientId');
  const list = usePagedList(billsApi.list, patientId ? { patientId } : {});

  const columns = [
    { key: 'billNumber', label: 'Bill', className: 'nowrap', render: (b) => <strong>{b.billNumber}</strong> },
    { key: 'createdAt', label: 'Date', className: 'nowrap', render: (b) => formatDateTime(b.createdAt) },
    { key: 'patient', label: 'Patient', render: (b) => (<>{b.patient?.name}<span className="muted block small">{b.patient?.patientNumber}</span></>) },
    { key: 'total', label: 'Total', className: 'num', render: (b) => formatMoney(b.total) },
    { key: 'balance', label: 'Balance', className: 'num', render: (b) => formatMoney(b.balance) },
    { key: 'status', label: 'Status', render: (b) => <BillStatus bill={b} /> },
  ];

  return (
    <BillingFrame
      subtitle={patientId ? 'Bills of one patient' : 'All bills, newest first'}
      actions={
        <button type="button" className="btn btn-primary" onClick={() => navigate(`/hospital/billing/new${patientId ? `?patientId=${patientId}` : ''}`)}>
          <Plus size={16} aria-hidden /> New bill
        </button>
      }
    >
      <ListPanel list={list} columns={columns} filters={[STATUS_FILTER]} searchPlaceholder="Bill number or patient" emptyText="No bills yet." onRowClick={(b) => navigate(`/hospital/billing/bills/${b.id}`)} />
    </BillingFrame>
  );
}
