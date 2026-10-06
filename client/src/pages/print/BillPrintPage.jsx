// A bill (with its receipts) for printing.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { billingSettingsApi, billsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { formatDateTime, formatMoney, labelOf } from '../../utils/format.js';
import { Letterhead, PrintFrame } from './PrintFrame.jsx';

export function BillPrintPage() {
  const { id } = useParams();
  const { billing } = useAppConfig();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([billsApi.get(id), billingSettingsApi.letterhead()])
      .then(([b, l]) => setData({ ...b, ...l }))
      .catch((err) => setError(err.message));
  }, [id]);

  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  const { bill, payments } = data;

  return (
    <PrintFrame ready title={`Bill ${bill.billNumber}`} footer={data.letterhead?.footer}>
      <Letterhead letterhead={data.letterhead} hospitalName={data.hospitalName} extra={<div className="print-doc">BILL<br /><strong>{bill.billNumber}</strong><br />{formatDateTime(bill.createdAt)}</div>} />
      <p><strong>{bill.patient?.name}</strong> · {bill.patient?.patientNumber}{bill.status === 'cancelled' && <strong> · CANCELLED</strong>}</p>
      <table className="print-table">
        <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {bill.lines.map((l) => (
            <tr key={l.id}><td>{l.name}</td><td className="num">{l.qty}</td><td className="num">{formatMoney(l.unitPrice)}</td><td className="num">{formatMoney(l.amount)}</td></tr>
          ))}
        </tbody>
      </table>
      <dl className="totals">
        <dt>Subtotal</dt><dd>{formatMoney(bill.subtotal)}</dd>
        {bill.discount.amount > 0 && (<><dt>Discount</dt><dd>−{formatMoney(bill.discount.amount)}</dd></>)}
        <dt><strong>Total</strong></dt><dd><strong>{formatMoney(bill.total)}</strong></dd>
        <dt>Paid</dt><dd>{formatMoney(bill.paid - bill.refunded)}</dd>
        <dt><strong>Balance</strong></dt><dd><strong>{formatMoney(bill.balance)}</strong></dd>
      </dl>
      {payments.length > 0 && (
        <>
          <h3>Receipts</h3>
          <table className="print-table">
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{p.receiptNumber}</td>
                  <td>{formatDateTime(p.createdAt)}</td>
                  <td>{p.kind === 'refund' ? 'Refund' : 'Paid'} · {labelOf(billing.paymentModes, p.mode)}{p.reference ? ` · ${p.reference}` : ''}</td>
                  <td className="num">{formatMoney(p.kind === 'refund' ? -p.amount : p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </PrintFrame>
  );
}
