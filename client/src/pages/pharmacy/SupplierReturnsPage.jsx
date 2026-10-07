// Pharmacy → Returns to supplier: stock sent back to the supplier it was bought from (expired, damaged …), each with a
// debit note to print. A return entered by mistake is cancelled with a reason; its units go back on their batches.
import { Plus, Printer } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supplierReturnsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { Modal } from '../../components/Modal.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { usePagedList } from '../../hooks/usePagedList.js';
import { formatDate, formatDateTime, formatMoney, labelOf } from '../../utils/format.js';
import { PharmacyFrame } from './PharmacyFrame.jsx';
import { RETURN_LOOKS } from './pharmacyExtrasFormat.js';

function ReturnDialog({ ret, onClose, onChanged }) {
  const { pharmacy } = useAppConfig();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [witness, setWitness] = useState('');
  const [error, setError] = useState('');
  const needsWitness = ret.lines.some((l) => pharmacy.schedules.find((s) => s.key === l.schedule)?.witness);

  const cancel = async (e) => {
    e.preventDefault();
    try {
      onChanged((await supplierReturnsApi.cancel(ret.id, { reason, witness })).supplierReturn);
      setCancelling(false);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal title={`${ret.returnNumber} · ${ret.supplierName}`} size="lg" onClose={onClose}>
      <p>
        <StateBadge look={RETURN_LOOKS[ret.status]} /> {labelOf(pharmacy.supplierReturnReasons, ret.reason)}
        {ret.note && ` – ${ret.note}`} · {formatDateTime(ret.created.at)} by {ret.created.byName}
        {ret.witness && ` · witness ${ret.witness}`}
      </p>
      {ret.cancelled && <Alert type="info">Cancelled {formatDateTime(ret.cancelled.at)} by {ret.cancelled.byName}: {ret.cancelled.reason}</Alert>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th><th className="num">GST</th></tr></thead>
          <tbody>
            {ret.lines.map((l) => (
              <tr key={l.batchId}>
                <td>{l.medicineName}</td><td>{l.batch}</td><td>{formatDate(l.expiry)}</td>
                <td className="num">{l.qty}</td><td className="num">{formatMoney(l.rate)}</td><td className="num">{formatMoney(l.amount)}</td><td className="num">{l.gstRate}%</td>
              </tr>
            ))}
            <tr className="total-row"><td colSpan={5}><strong>Total ({ret.interState ? 'IGST' : 'CGST + SGST'} {formatMoney(ret.gst)})</strong></td><td className="num" colSpan={2}><strong>{formatMoney(ret.total)}</strong></td></tr>
          </tbody>
        </table>
      </div>
      <Alert type="error">{error}</Alert>
      {cancelling ? (
        <form onSubmit={cancel} className="form-grid top-gap-sm">
          <div className="form-field width-half">
            <label htmlFor="ret-cancel-reason">Why it is cancelled<span className="required" aria-hidden> *</span></label>
            <input id="ret-cancel-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </div>
          {needsWitness && (
            <div className="form-field width-half">
              <label htmlFor="ret-cancel-witness">Witness (Schedule X / narcotic)<span className="required" aria-hidden> *</span></label>
              <input id="ret-cancel-witness" value={witness} maxLength={100} onChange={(e) => setWitness(e.target.value)} />
            </div>
          )}
          <div className="modal-foot inline span-2">
            <button type="button" className="btn btn-ghost" onClick={() => setCancelling(false)}>Back</button>
            <button type="submit" className="btn btn-primary" disabled={reason.trim().length < 3}>Cancel the return</button>
          </div>
        </form>
      ) : (
        <div className="modal-foot inline">
          {ret.can?.cancel && <button type="button" className="btn btn-link btn-danger-text" onClick={() => setCancelling(true)}>Cancel the return</button>}
          <a className="btn btn-primary" href={`/hospital/print/debit-note/${ret.id}`} target="_blank" rel="noreferrer"><Printer size={16} aria-hidden /> Print debit note</a>
        </div>
      )}
    </Modal>
  );
}

export function SupplierReturnsPage() {
  const navigate = useNavigate();
  const { canAccess } = useAuth();
  const list = usePagedList(supplierReturnsApi.list);
  const [shown, setShown] = useState(null);

  const columns = [
    { key: 'returnNumber', label: 'Return', className: 'nowrap', render: (r) => <strong>{r.returnNumber}</strong> },
    { key: 'supplierName', label: 'Supplier' },
    { key: 'lines', label: 'Medicines', render: (r) => <span className="small">{r.lines.map((l) => `${l.medicineName} × ${l.qty}`).join(', ')}</span> },
    { key: 'total', label: 'Debit note', className: 'num', render: (r) => formatMoney(r.total) },
    { key: 'status', label: 'Status', render: (r) => <StateBadge look={RETURN_LOOKS[r.status]} small /> },
    { key: 'createdAt', label: 'Date', className: 'nowrap', render: (r) => formatDate(r.createdAt) },
  ];

  return (
    <PharmacyFrame
      subtitle="Stock sent back to suppliers, each with a debit note."
      actions={canAccess('pharmacyCounter') && (
        <button type="button" className="btn btn-primary" onClick={() => navigate('/hospital/pharmacy/supplier-returns/new')}>
          <Plus size={16} aria-hidden /> Return stock
        </button>
      )}
    >
      <ListPanel list={list} columns={columns} searchPlaceholder="Return number or supplier" emptyText="Nothing returned yet." onRowClick={async (r) => setShown((await supplierReturnsApi.get(r.id)).supplierReturn)} />
      {shown && <ReturnDialog ret={shown} onClose={() => setShown(null)} onChanged={(r) => { setShown(r); list.reload(); }} />}
    </PharmacyFrame>
  );
}
