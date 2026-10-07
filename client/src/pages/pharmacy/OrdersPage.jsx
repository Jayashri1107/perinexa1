// Pharmacy → Orders: purchase orders to suppliers (as in Perinexa). An order moves no stock; a purchase recorded
// against it does.
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { purchaseOrdersApi } from '../../api/index.js';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { usePagedList } from '../../hooks/usePagedList.js';
import { formatDate } from '../../utils/format.js';
import { PharmacyFrame } from './PharmacyFrame.jsx';
import { ORDER_FILTERS, orderLook } from './pharmacyExtrasFormat.js';

export function OrdersPage() {
  const navigate = useNavigate();
  const { canAccess } = useAuth();
  const list = usePagedList(purchaseOrdersApi.list, { status: 'open' });

  const columns = [
    { key: 'orderNumber', label: 'Order', className: 'nowrap', render: (o) => <strong>{o.orderNumber}</strong> },
    { key: 'supplierName', label: 'Supplier' },
    { key: 'lines', label: 'Medicines', render: (o) => <span className="small">{o.lines.map((l) => `${l.medicineName} × ${l.qty}`).join(', ')}</span> },
    { key: 'status', label: 'Status', render: (o) => <StateBadge look={orderLook(o)} small /> },
    { key: 'createdAt', label: 'Made', className: 'nowrap', render: (o) => (<>{formatDate(o.createdAt)}<span className="muted block small">{o.created?.byName}</span></>) },
  ];

  return (
    <PharmacyFrame
      subtitle="What the pharmacy asked suppliers for. Stock comes in when the supplier's invoice is recorded against the order."
      actions={canAccess('pharmacyCounter') && (
        <button type="button" className="btn btn-primary" onClick={() => navigate('/hospital/pharmacy/orders/new')}>
          <Plus size={16} aria-hidden /> New order
        </button>
      )}
    >
      <ListPanel
        list={list}
        columns={columns}
        filters={[{ name: 'status', label: 'Status', options: ORDER_FILTERS }]}
        searchPlaceholder="Order, supplier or medicine"
        emptyText="No orders here."
        onRowClick={(o) => navigate(`/hospital/pharmacy/orders/${o.id}`)}
      />
    </PharmacyFrame>
  );
}
