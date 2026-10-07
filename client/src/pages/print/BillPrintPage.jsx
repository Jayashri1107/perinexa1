// A bill (with its receipts) for printing or saving as PDF: the letterhead, the bill and patient details, every
// service with quantity, rate and amount, the totals worked out by the server (subtotal, discount, total, paid,
// balance) with the total in words, a summary by group, the receipts, and space to sign and stamp.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { billingSettingsApi, billsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { amountInWords } from '../../utils/amountInWords.js';
import { ageText, formatDateTime, formatMoney, labelOf } from '../../utils/format.js';
import { Letterhead, PrintFrame } from './PrintFrame.jsx';

const STATUS_WORDS = { open: 'Unpaid / part paid', paid: 'Paid', cancelled: 'CANCELLED' };

export function BillPrintPage() {
  const { id } = useParams();
  const { billing, patients: patientSettings } = useAppConfig();
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
  const p = bill.patient ?? {};
  const paid = bill.paid - bill.refunded;
  // The summary by group: what each kind of service came to (the lines' amounts, before the discount).
  const groups = billing.priceGroups
    .map((g) => ({ ...g, amount: bill.lines.filter((l) => l.group === g.key).reduce((n, l) => n + l.amount, 0) }))
    .filter((g) => g.amount > 0);

  return (
    <PrintFrame ready title={`Bill_${bill.billNumber}`} footer={data.letterhead?.footer}>
      <Letterhead
        letterhead={data.letterhead}
        hospitalName={data.hospitalName}
        extra={<div className="print-doc">{bill.status === 'cancelled' ? 'CANCELLED BILL' : 'BILL / INVOICE'}</div>}
      />

      <table className="print-info">
        <tbody>
          <tr>
            <th>Bill no.</th><td><strong>{bill.billNumber}</strong></td>
            <th>Date</th><td>{formatDateTime(bill.createdAt)}</td>
          </tr>
          <tr>
            <th>Patient</th><td><strong>{p.name}</strong></td>
            <th>Patient no.</th><td>{p.patientNumber}</td>
          </tr>
          <tr>
            <th>Age / sex</th><td>{[p.birthDate && ageText(p.birthDate, p.birthDateApprox), p.sex && labelOf(patientSettings.sexes, p.sex)].filter(Boolean).join(' / ') || '—'}</td>
            <th>Phone</th><td>{p.phone || '—'}</td>
          </tr>
          <tr>
            <th>Doctor</th><td>{bill.doctorName || '—'}</td>
            <th>Status</th><td>{STATUS_WORDS[bill.status] ?? bill.status}</td>
          </tr>
        </tbody>
      </table>

      <table className="print-table">
        <thead>
          <tr><th className="num">#</th><th>Service</th><th>Group</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr>
        </thead>
        <tbody>
          {bill.lines.map((l, i) => (
            <tr key={l.id}>
              <td className="num">{i + 1}</td>
              <td>{l.name}</td>
              <td>{labelOf(billing.priceGroups, l.group)}</td>
              <td className="num">{l.qty}</td>
              <td className="num">{formatMoney(l.unitPrice)}</td>
              <td className="num">{formatMoney(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="print-columns">
        {groups.length > 1 ? (
          <table className="print-table print-groups">
            <thead><tr><th>Summary</th><th className="num">Amount</th></tr></thead>
            <tbody>{groups.map((g) => <tr key={g.key}><td>{g.label}</td><td className="num">{formatMoney(g.amount)}</td></tr>)}</tbody>
          </table>
        ) : <span />}
        <dl className="totals">
          <dt>Subtotal</dt><dd>{formatMoney(bill.subtotal)}</dd>
          {bill.discount.amount > 0 && (<><dt>Discount{bill.discount.reason ? ` (${bill.discount.reason})` : ''}</dt><dd>−{formatMoney(bill.discount.amount)}</dd></>)}
          <dt><strong>Total amount</strong></dt><dd><strong>{formatMoney(bill.total)}</strong></dd>
          <dt>Paid</dt><dd>{formatMoney(paid)}</dd>
          <dt><strong>{bill.balance < 0 ? 'To refund' : 'Balance due'}</strong></dt><dd><strong>{formatMoney(Math.abs(bill.balance))}</strong></dd>
        </dl>
      </div>
      <p className="small"><strong>Amount in words:</strong> {amountInWords(bill.total)}</p>

      {payments.length > 0 && (
        <>
          <h3>Payments received</h3>
          <table className="print-table">
            <thead><tr><th>Receipt</th><th>Date</th><th>Mode</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {payments.map((x) => (
                <tr key={x.id}>
                  <td>{x.receiptNumber}</td>
                  <td>{formatDateTime(x.createdAt)}</td>
                  <td>{x.kind === 'refund' ? 'Refund · ' : ''}{labelOf(billing.paymentModes, x.mode)}{x.reference ? ` · ${x.reference}` : ''}</td>
                  <td className="num">{formatMoney(x.kind === 'refund' ? -x.amount : x.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="print-sign-row">
        <p className="print-sign">&nbsp;<br />Patient / attendant</p>
        <p className="print-sign">&nbsp;<br />Billing department</p>
        <p className="print-sign">&nbsp;<br />Hospital stamp</p>
      </div>
      <p className="small muted">This is a computer-generated bill.</p>
    </PrintFrame>
  );
}
