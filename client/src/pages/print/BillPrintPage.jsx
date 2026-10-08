// A bill (invoice) for printing or saving as PDF: the letterhead; the bill, patient, consultant and stay or visit; the
// particulars with quantity, rate and amount; the totals worked out by the server (subtotal, discount, net amount,
// paid, balance) with the net amount in words; the payments received (each also has its own receipt); who made and
// printed it; and space to sign and stamp.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { billingSettingsApi, billsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { amountInWords } from '../../utils/amountInWords.js';
import { formatDateTime, formatMoney, labelOf } from '../../utils/format.js';
import { BillInfo, GeneratedBy, Signatures } from './billPrintParts.jsx';
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
  const { bill, payments, context } = data;
  const paid = bill.paid - bill.refunded;
  const d = bill.discount;
  const discountLabel = `Discount${d.amount > 0 && d.mode === 'percent' ? ` (${d.value}%)` : ''}${d.amount > 0 && d.reason ? ` – ${d.reason}` : ''}`;

  return (
    <PrintFrame ready title={`Bill_${bill.billNumber}`} footer={data.letterhead?.footer}>
      <Letterhead letterhead={data.letterhead} hospitalName={data.hospitalName} extra={<div className="print-doc">{bill.status === 'cancelled' ? 'CANCELLED BILL' : 'BILL / INVOICE'}</div>} />
      <BillInfo bill={bill} context={context} numberLabel="Bill no." number={bill.billNumber} date={bill.createdAt} />

      <table className="print-table">
        <thead>
          <tr><th className="num">No.</th><th>Particulars</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr>
        </thead>
        <tbody>
          {bill.lines.map((l, i) => (
            <tr key={l.id}>
              <td className="num">{i + 1}</td>
              <td>{l.name}</td>
              <td className="num">{l.qty}</td>
              <td className="num">{formatMoney(l.unitPrice)}</td>
              <td className="num">{formatMoney(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="totals">
        <dt>Subtotal</dt><dd>{formatMoney(bill.subtotal)}</dd>
        <dt>{discountLabel}</dt><dd>{d.amount > 0 ? '−' : ''}{formatMoney(d.amount)}</dd>
        <dt><strong>Net amount</strong></dt><dd><strong>{formatMoney(bill.total)}</strong></dd>
        <dt>Paid</dt><dd>{formatMoney(paid)}</dd>
        <dt><strong>{bill.balance < 0 ? 'To refund' : 'Balance due'}</strong></dt><dd><strong>{formatMoney(Math.abs(bill.balance))}</strong></dd>
      </dl>
      <p className="small"><strong>Net amount in words:</strong> {amountInWords(bill.total)}</p>

      {payments.length > 0 && (
        <>
          <h3>Payments received</h3>
          <table className="print-table">
            <thead><tr><th>Receipt no.</th><th>Date</th><th>Mode</th><th>Reference</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {payments.map((x) => (
                <tr key={x.id}>
                  <td>{x.receiptNumber}</td>
                  <td>{formatDateTime(x.createdAt)}</td>
                  <td>{x.kind === 'refund' ? 'Refund · ' : ''}{labelOf(billing.paymentModes, x.mode)}</td>
                  <td>{x.reference || '—'}</td>
                  <td className="num">{formatMoney(x.kind === 'refund' ? -x.amount : x.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <Signatures />
      <GeneratedBy createdByName={context?.createdByName} />
    </PrintFrame>
  );
}
