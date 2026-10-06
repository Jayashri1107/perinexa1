// One sale: its invoice lines, print, and returns (unopened, before expiry).
import { ArrowLeft, Printer, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { salesApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate, formatDateTime, formatMoney, labelOf } from '../../utils/format.js';
import { SaleStatus } from './SaleStatus.jsx';

export function SaleDetailPage() {
  const { id } = useParams();
  const { billing } = useAppConfig();
  const { canAccess } = useAuth();
  const [sale, setSale] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [returning, setReturning] = useState(false);
  const [qty, setQty] = useState({});
  const [reason, setReason] = useState('');
  const [refundMode, setRefundMode] = useState(billing.paymentModes[0].key);

  useEffect(() => {
    salesApi.get(id).then((r) => setSale(r.sale)).catch((err) => setError(err.message));
  }, [id]);

  if (!sale) return error ? <Alert type="error">{error}</Alert> : <Loader />;

  const canReturn = canAccess('pharmacyCounter') && sale.status !== 'returned';
  const submitReturn = async () => {
    setError('');
    const lines = Object.entries(qty).filter(([, q]) => Number(q) > 0).map(([lineId, q]) => ({ lineId, qty: Number(q) }));
    try {
      const result = await salesApi.returnItems(id, { lines, reason, ...(sale.payment.to === 'counter' && { refundMode }) });
      setSale(result.sale);
      setReturning(false);
      setQty({});
      setNotice(sale.payment.to === 'bill' ? `Returned. ${formatMoney(result.refund)} taken off bill ${sale.payment.billNumber}.` : `Returned. Give back ${formatMoney(result.refund)}.`);
    } catch (err) {
      setError(Object.values(err.fields ?? {})[0] ?? err.message);
    }
  };

  return (
    <>
      <PageHeader
        back={<Link to="/hospital/pharmacy/sales" className="back-link"><ArrowLeft size={16} aria-hidden /> Sales</Link>}
        title={`Invoice ${sale.invoiceNumber}`}
        subtitle={`${sale.patient?.name ? `${sale.patient.name} (${sale.patient.patientNumber})` : sale.customerName || 'Walk-in'} · ${formatDateTime(sale.createdAt)}${sale.doctorName ? ` · Dr ${sale.doctorName}` : ''}`}
        actions={
          <>
            <SaleStatus sale={sale} />
            <Link to={`/hospital/print/sale/${sale.id}`} target="_blank" className="btn btn-ghost"><Printer size={16} aria-hidden /> Print invoice</Link>
            {canReturn && <button type="button" className="btn btn-ghost" onClick={() => setReturning(true)}><Undo2 size={16} aria-hidden /> Return</button>}
          </>
        }
      />
      <Alert type="error">{error}</Alert>
      <Alert type="success">{notice}</Alert>
      <section className="card list-panel">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th className="num">Qty</th><th className="num">Returned</th><th className="num">MRP</th><th className="num">GST</th><th className="num">Amount</th></tr>
            </thead>
            <tbody>
              {sale.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td>{l.batch}</td>
                  <td className="nowrap">{formatDate(l.expiry)}</td>
                  <td className="num">{l.qty}</td>
                  <td className="num">{l.returnedQty || '—'}</td>
                  <td className="num">{formatMoney(l.mrp)}</td>
                  <td className="num">{l.gstRate}%</td>
                  <td className="num">{formatMoney(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="totals">
          <dt>Subtotal</dt><dd>{formatMoney(sale.subtotal)}</dd>
          {sale.discount.amount > 0 && (<><dt>Discount ({sale.discount.reason})</dt><dd>−{formatMoney(sale.discount.amount)}</dd></>)}
          <dt>Taxable value</dt><dd>{formatMoney(sale.taxable)}</dd>
          <dt>GST included</dt><dd>{formatMoney(sale.gst)}</dd>
          <dt><strong>Total</strong></dt><dd><strong>{formatMoney(sale.total)}</strong></dd>
          {sale.returnedAmount > 0 && (<><dt>Returned</dt><dd>−{formatMoney(sale.returnedAmount)}</dd></>)}
          <dt>Paid</dt><dd>{sale.payment.to === 'bill' ? `On hospital bill ${sale.payment.billNumber}` : `${labelOf(billing.paymentModes, sale.payment.mode)} at the counter`}</dd>
        </dl>
      </section>

      {returning && (
        <Modal
          title="Return medicines"
          onClose={() => setReturning(false)}
          footer={<><button type="button" className="btn btn-ghost" onClick={() => setReturning(false)}>Cancel</button><button type="button" className="btn btn-primary" onClick={submitReturn}>Take back</button></>}
        >
          <p className="muted small">Only unopened medicines before their expiry date.</p>
          {sale.lines.filter((l) => l.qty > l.returnedQty).map((l) => (
            <div key={l.id} className="form-field">
              <label htmlFor={`ret-${l.id}`}>{l.name} · batch {l.batch} (up to {l.qty - l.returnedQty})</label>
              <input id={`ret-${l.id}`} type="number" min="0" max={l.qty - l.returnedQty} value={qty[l.id] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} />
            </div>
          ))}
          <div className="form-field">
            <label htmlFor="ret-reason">Reason</label>
            <input id="ret-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {sale.payment.to === 'counter' && (
            <div className="form-field">
              <label htmlFor="ret-mode">Money given back by</label>
              <select id="ret-mode" value={refundMode} onChange={(e) => setRefundMode(e.target.value)}>
                {billing.paymentModes.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
