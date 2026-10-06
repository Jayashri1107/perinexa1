// Stock per medicine (sellable, expired, value); click a medicine to see its batches and write off or correct one.
import { useState } from 'react';
import { stockApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { FormModal } from '../../components/form/FormModal.jsx';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { Modal } from '../../components/Modal.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { adjustFields } from '../../forms/pharmacyForms.js';
import { useForm } from '../../hooks/useForm.js';
import { usePagedList } from '../../hooks/usePagedList.js';
import { formatDate, formatMoney } from '../../utils/format.js';
import { PharmacyFrame } from './PharmacyFrame.jsx';

export function StockPage() {
  const { pharmacy } = useAppConfig();
  const { canAccess } = useAuth();
  const list = usePagedList(stockApi.list);
  const [batches, setBatches] = useState(null);
  const [adjusting, setAdjusting] = useState(null);
  const [error, setError] = useState('');
  const form = useForm({});

  const openBatches = async (m) => {
    setError('');
    try {
      setBatches(await stockApi.batches(m.id));
    } catch (err) {
      setError(err.message);
    }
  };
  const adjust = async (values) => {
    await stockApi.adjust(adjusting.id, values);
    setAdjusting(null);
    setBatches(await stockApi.batches(batches.medicine.id));
    list.reload();
  };

  const columns = [
    { key: 'name', label: 'Medicine', render: (m) => (<><strong>{m.name}</strong> {m.strength}</>) },
    { key: 'sellable', label: 'In stock', className: 'num', render: (m) => (m.isLow ? <span className="badge badge-pending">{m.sellable} · low</span> : m.sellable) },
    { key: 'reorderLevel', label: 'Reorder at', className: 'num' },
    { key: 'expired', label: 'Expired', className: 'num', render: (m) => (m.expired ? <span className="badge badge-inactive">{m.expired}</span> : '—') },
    { key: 'nearestExpiry', label: 'Next expiry', className: 'nowrap', render: (m) => formatDate(m.nearestExpiry) },
    { key: 'valueAtCost', label: 'Value at cost', className: 'num', render: (m) => formatMoney(m.valueAtCost) },
  ];

  return (
    <PharmacyFrame subtitle="What is on the shelf. Click a medicine for its batches.">
      <Alert type="error">{error}</Alert>
      <ListPanel
        list={list}
        columns={columns}
        filters={[{ name: 'lowStock', label: 'Show', options: [{ value: 'true', label: 'Low stock only' }] }]}
        searchPlaceholder="Medicine"
        emptyText="No medicines yet."
        onRowClick={openBatches}
      />
      {batches && !adjusting && (
        <Modal title={`${batches.medicine.name} ${batches.medicine.strength ?? ''} – batches`} size="lg" onClose={() => setBatches(null)}>
          {batches.batches.length === 0 && <p className="muted">No stock.</p>}
          {batches.batches.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Batch</th><th>Expiry</th><th className="num">Units</th><th className="num">Cost</th><th className="num">MRP</th><th /></tr></thead>
                <tbody>
                  {batches.batches.map((b) => (
                    <tr key={b.id}>
                      <td>{b.batch}</td>
                      <td className="nowrap">{formatDate(b.expiry)} {b.isExpired && <span className="badge badge-inactive">Expired</span>}</td>
                      <td className="num">{b.qty}</td>
                      <td className="num">{formatMoney(b.purchasePrice)}</td>
                      <td className="num">{formatMoney(b.mrp)}</td>
                      <td className="actions">
                        {canAccess('pharmacyCounter') && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { form.reset({ kind: b.isExpired ? 'writeoff' : 'count', qty: b.qty, reason: b.isExpired ? 'expired' : 'count', note: '' }); setAdjusting(b); }}>
                            Write off / correct
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
      {adjusting && (
        <FormModal title={`Batch ${adjusting.batch} (${adjusting.qty} units)`} fields={adjustFields({ pharmacy })} form={form} submitLabel="Save" onSubmit={adjust} onClose={() => setAdjusting(null)} />
      )}
    </PharmacyFrame>
  );
}
