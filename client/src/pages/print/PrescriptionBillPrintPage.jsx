// The bill of a given prescription (owner, 8 Oct 2026), for printing or saving as PDF: the letterhead; bill number and
// date; the patient, the doctor and the prescription's date; each medicine (batch and expiry, quantity, rate, amount);
// the other charges; the discount and the grand total (in words too); the payments; space to sign and stamp.
// PrescriptionBill is the bill itself – also shown in a pop-up ("View bill" on the pharmacy's Prescriptions tab).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { dispensingApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { amountInWords } from '../../utils/amountInWords.js';
import { ageText, formatDate, formatDateTime, formatMoney, labelOf } from '../../utils/format.js';
import { Signatures } from './billPrintParts.jsx';
import { Letterhead, PrintFrame } from './PrintFrame.jsx';

export function PrescriptionBill({ data, signatures = true }) {
  const { patients: settings } = useAppConfig();
  const { bill, patient, prescription, medicines, payments } = data;
  const rows = [
    ...medicines.map((m) => ({ name: m.name, detail: m.batch ? `${m.batch}${m.expiry ? ` · ${formatDate(m.expiry)}` : ''}` : '—', qty: m.qty, rate: m.mrp, amount: m.amount })),
    ...bill.charges.map((c) => ({ name: c.name, detail: '—', qty: c.qty, rate: c.unitPrice, amount: c.amount })),
  ];
  const discount = data.medicineDiscount + bill.discount;
  return (
    <>
      <Letterhead letterhead={data.hospital.letterhead} hospitalName={data.hospital.name} extra={<div className="print-doc">{bill.status === 'cancelled' ? 'CANCELLED BILL' : 'BILL / INVOICE'}</div>} />
      <table className="print-info">
        <tbody>
          <tr><th>Bill no.</th><td>{bill.billNumber}</td><th>Date</th><td>{formatDateTime(bill.createdAt)}</td></tr>
          <tr>
            <th>Patient</th><td>{patient.name} ({patient.patientNumber})</td>
            <th>Age · sex</th><td>{patient.birthDate ? ageText(patient.birthDate, patient.birthDateApprox) : '—'}{patient.sex ? ` · ${labelOf(settings.sexes, patient.sex)}` : ''}</td>
          </tr>
          {prescription && <tr><th>Doctor</th><td>{prescription.doctor || '—'}</td><th>Prescription</th><td>{formatDate(prescription.visitOn)}</td></tr>}
        </tbody>
      </table>

      <table className="print-table">
        <thead>
          <tr><th className="num">No.</th><th>Particulars</th><th>Batch · expiry</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="num">{i + 1}</td>
              <td>{r.name}</td>
              <td>{r.detail}</td>
              <td className="num">{r.qty}</td>
              <td className="num">{formatMoney(r.rate)}</td>
              <td className="num">{formatMoney(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="totals">
        {medicines.length > 0 && <><dt>Medicines</dt><dd>{formatMoney(medicines.reduce((s, m) => s + m.amount, 0))}</dd></>}
        {bill.charges.length > 0 && <><dt>Other charges</dt><dd>{formatMoney(bill.charges.reduce((s, c) => s + c.amount, 0))}</dd></>}
        {discount > 0 && <><dt>Discount</dt><dd>−{formatMoney(discount)}</dd></>}
        <dt><strong>Grand total</strong></dt><dd><strong>{formatMoney(bill.total)}</strong></dd>
        <dt>Paid</dt><dd>{formatMoney(bill.paid)}</dd>
        <dt><strong>Balance due</strong></dt><dd><strong>{formatMoney(Math.max(0, bill.balance))}</strong></dd>
      </dl>
      <p className="small"><strong>Grand total in words:</strong> {amountInWords(bill.total)}</p>
      {payments.length > 0 && (
        <p className="small">
          <strong>Payment:</strong> {payments.map((p) => `${labelOf(data.modes, p.mode)} ${formatMoney(p.amount)} (receipt ${p.receiptNumber})`).join(' · ')} ·{' '}
          <strong>{bill.balance <= 0 ? 'PAID' : 'PART PAID'}</strong>
        </p>
      )}
      {signatures && <Signatures />}
    </>
  );
}

export function PrescriptionBillPrintPage() {
  const { billId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    dispensingApi.bill(billId).then(setData).catch((err) => setError(err.message));
  }, [billId]);

  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  return (
    <PrintFrame ready title={`Bill_${data.bill.billNumber}`} footer={data.hospital.letterhead?.footer}>
      <PrescriptionBill data={data} />
    </PrintFrame>
  );
}
