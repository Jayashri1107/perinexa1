// One payment (or refund) receipt for printing or saving as PDF – separate from the bill: what was received, when,
// how, and the bill it was paid against (its net amount, what was paid up to this receipt and the balance after it).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { billingSettingsApi, billsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { amountInWords } from '../../utils/amountInWords.js';
import { formatMoney, labelOf } from '../../utils/format.js';
import { BillInfo, GeneratedBy } from './billPrintParts.jsx';
import { DocTitle, Letterhead, PrintFrame } from './PrintFrame.jsx';

export function ReceiptPrintPage() {
  const { billId, paymentId } = useParams();
  const { billing } = useAppConfig();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([billsApi.get(billId), billingSettingsApi.letterhead()])
      .then(([b, l]) => setData({ ...b, ...l }))
      .catch((err) => setError(err.message));
  }, [billId]);

  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  const { bill, payments, context } = data;
  const x = payments.find((p) => p.id === paymentId);
  if (!x) return <Alert type="error">Receipt not found.</Alert>;
  const refund = x.kind === 'refund';
  // Paid up to and including this receipt (refunds taken off), and the balance left after it.
  const upto = payments.slice(0, payments.indexOf(x) + 1).reduce((n, p) => n + (p.kind === 'refund' ? -p.amount : p.amount), 0);

  return (
    <PrintFrame ready title={`Receipt_${x.receiptNumber}`} footer={data.letterhead?.footer}>
      <Letterhead letterhead={data.letterhead} hospitalName={data.hospitalName} />
      <DocTitle right={<>Receipt no. <strong>{x.receiptNumber}</strong></>}>{refund ? 'REFUND RECEIPT' : 'PAYMENT RECEIPT'}</DocTitle>
      <BillInfo bill={bill} context={context} numberLabel="Receipt no." number={x.receiptNumber} date={x.createdAt} />
      <dl className="totals receipt-totals">
        <dt>Against bill</dt><dd>{bill.billNumber}</dd>
        <dt>Bill net amount</dt><dd>{formatMoney(bill.total)}</dd>
        <dt>Payment mode</dt><dd>{labelOf(billing.paymentModes, x.mode)}</dd>
        {x.reference && (<><dt>Reference</dt><dd>{x.reference}</dd></>)}
        {refund && x.reason && (<><dt>Reason</dt><dd>{x.reason}</dd></>)}
        <dt><strong>{refund ? 'Amount refunded' : 'Amount received'}</strong></dt><dd><strong>{formatMoney(x.amount)}</strong></dd>
        <dt>Paid so far on this bill</dt><dd>{formatMoney(upto)}</dd>
        <dt>Balance after this receipt</dt><dd>{formatMoney(Math.max(0, bill.total - upto))}</dd>
      </dl>
      <p className="small"><strong>{refund ? 'Refunded' : 'Received with thanks'}:</strong> {amountInWords(x.amount)}{x.byName ? ` · by ${x.byName}` : ''}</p>
      <div className="print-sign-row">
        <p className="print-sign">&nbsp;<br />Patient / attendant</p>
        <p className="print-sign">&nbsp;<br />Authorised signatory</p>
      </div>
      <GeneratedBy />
    </PrintFrame>
  );
}
