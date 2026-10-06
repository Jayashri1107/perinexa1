import { useNavigate } from 'react-router-dom';
import { salesApi } from '../../api/index.js';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { usePagedList } from '../../hooks/usePagedList.js';
import { formatDateTime, formatMoney } from '../../utils/format.js';
import { PharmacyFrame } from './PharmacyFrame.jsx';
import { SaleStatus } from './SaleStatus.jsx';

const STATUS_FILTER = {
  name: 'status',
  label: 'Status',
  options: [
    { value: 'completed', label: 'Completed' },
    { value: 'part_returned', label: 'Part returned' },
    { value: 'returned', label: 'Returned' },
  ],
};

export function SalesPage() {
  const navigate = useNavigate();
  const list = usePagedList(salesApi.list);
  const columns = [
    { key: 'invoiceNumber', label: 'Invoice', className: 'nowrap', render: (s) => <strong>{s.invoiceNumber}</strong> },
    { key: 'createdAt', label: 'When', className: 'nowrap', render: (s) => formatDateTime(s.createdAt) },
    { key: 'buyer', label: 'Buyer', render: (s) => (s.patient?.name ? <>{s.patient.name}<span className="muted block small">{s.patient.patientNumber}</span></> : s.customerName || '—') },
    { key: 'lineCount', label: 'Lines', className: 'num' },
    { key: 'total', label: 'Total', className: 'num', render: (s) => formatMoney(s.total) },
    { key: 'paid', label: 'Paid', render: (s) => (s.payment.to === 'bill' ? `On bill ${s.payment.billNumber}` : 'At the counter') },
    { key: 'status', label: 'Status', render: (s) => <SaleStatus sale={s} /> },
  ];
  return (
    <PharmacyFrame subtitle="Every counter sale, newest first">
      <ListPanel list={list} columns={columns} filters={[STATUS_FILTER]} searchPlaceholder="Invoice, patient or buyer" emptyText="No sales yet." onRowClick={(s) => navigate(`/hospital/pharmacy/sales/${s.id}`)} />
    </PharmacyFrame>
  );
}
