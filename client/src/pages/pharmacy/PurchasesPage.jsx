// Supplier invoices received; each line became a stock batch.
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { purchasesApi } from '../../api/index.js';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { Modal } from '../../components/Modal.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { usePagedList } from '../../hooks/usePagedList.js';
import { formatDate, formatMoney } from '../../utils/format.js';
import { PharmacyFrame } from './PharmacyFrame.jsx';

export function PurchasesPage() {
  const navigate = useNavigate();
  const { canAccess } = useAuth();
  const list = usePagedList(purchasesApi.list);
  const [shown, setShown] = useState(null);

  const columns = [
    { key: 'invoiceDate', label: 'Invoice date', className: 'nowrap', render: (p) => formatDate(p.invoiceDate) },
    { key: 'invoiceNumber', label: 'Invoice', render: (p) => <strong>{p.invoiceNumber}</strong> },
    { key: 'supplierName', label: 'Supplier' },
    { key: 'lineCount', label: 'Lines', className: 'num' },
    { key: 'total', label: 'Cost', className: 'num', render: (p) => formatMoney(p.total) },
    { key: 'byName', label: 'Recorded by' },
  ];

  return (
    <PharmacyFrame
      subtitle="Medicines received from suppliers"
      actions={canAccess('pharmacyCounter') && (
        <button type="button" className="btn btn-primary" onClick={() => navigate('/hospital/pharmacy/purchases/new')}>
          <Plus size={16} aria-hidden /> Record purchase
        </button>
      )}
    >
      <ListPanel list={list} columns={columns} searchPlaceholder="Invoice or supplier" emptyText="No purchases yet." onRowClick={async (p) => setShown((await purchasesApi.get(p.id)).purchase)} />
      {shown && (
        <Modal title={`${shown.supplierName} · ${shown.invoiceNumber}`} size="lg" onClose={() => setShown(null)}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th className="num">Qty</th><th className="num">Free</th><th className="num">Cost</th><th className="num">MRP</th><th className="num">GST</th></tr></thead>
              <tbody>
                {shown.lines.map((l) => (
                  <tr key={`${l.medicineId}-${l.batch}`}>
                    <td>{l.medicineName}</td><td>{l.batch}</td><td className="nowrap">{formatDate(l.expiry)}</td>
                    <td className="num">{l.qty}</td><td className="num">{l.freeQty || '—'}</td>
                    <td className="num">{formatMoney(l.purchasePrice)}</td><td className="num">{formatMoney(l.mrp)}</td><td className="num">{l.gstRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </PharmacyFrame>
  );
}
