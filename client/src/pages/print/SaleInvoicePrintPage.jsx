// The pharmacy's GST tax invoice for printing.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { pharmacySettingsApi, salesApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { formatDate, formatDateTime, formatMoney, labelOf } from '../../utils/format.js';
import { Letterhead, PrintFrame } from './PrintFrame.jsx';

export function SaleInvoicePrintPage() {
  const { id } = useParams();
  const { billing } = useAppConfig();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([salesApi.get(id), pharmacySettingsApi.get()])
      .then(([s, p]) => setData({ sale: s.sale, ...p }))
      .catch((err) => setError(err.message));
  }, [id]);

  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  const { sale, pharmacy } = data;
  const letterhead = { ...data.letterhead, name: pharmacy.name || data.letterhead?.name };

  return (
    <PrintFrame ready title={`Invoice ${sale.invoiceNumber}`} footer={pharmacy.pharmacistName ? `Pharmacist: ${pharmacy.pharmacistName}` : ''}>
      <Letterhead
        letterhead={letterhead}
        hospitalName={data.hospitalName}
        extra={<div className="print-doc">TAX INVOICE<br /><strong>{sale.invoiceNumber}</strong><br />{formatDateTime(sale.createdAt)}</div>}
      />
      <p className="small">
        {pharmacy.gstin && <>GSTIN {pharmacy.gstin} · </>}
        {pharmacy.licence20 && <>DL 20: {pharmacy.licence20} · </>}
        {pharmacy.licence21 && <>DL 21: {pharmacy.licence21}</>}
      </p>
      <p>
        <strong>{sale.patient?.name || sale.customerName || 'Walk-in'}</strong>
        {sale.patient?.patientNumber && ` · ${sale.patient.patientNumber}`}
        {sale.doctorName && ` · Prescribed by Dr ${sale.doctorName}`}
      </p>
      <table className="print-table">
        <thead><tr><th>Medicine</th><th>HSN</th><th>Batch</th><th>Exp.</th><th className="num">Qty</th><th className="num">MRP</th><th className="num">GST</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {sale.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.name}</td><td>{l.hsn}</td><td>{l.batch}</td><td>{formatDate(l.expiry)}</td>
              <td className="num">{l.qty}</td><td className="num">{formatMoney(l.mrp)}</td><td className="num">{l.gstRate}%</td><td className="num">{formatMoney(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="totals">
        <dt>Subtotal</dt><dd>{formatMoney(sale.subtotal)}</dd>
        {sale.discount.amount > 0 && (<><dt>Discount</dt><dd>−{formatMoney(sale.discount.amount)}</dd></>)}
        <dt>Taxable value</dt><dd>{formatMoney(sale.taxable)}</dd>
        <dt>GST included</dt><dd>{formatMoney(sale.gst)}</dd>
        <dt><strong>Total</strong></dt><dd><strong>{formatMoney(sale.total)}</strong></dd>
        <dt>Paid</dt><dd>{sale.payment.to === 'bill' ? `On hospital bill ${sale.payment.billNumber}` : labelOf(billing.paymentModes, sale.payment.mode)}</dd>
      </dl>
    </PrintFrame>
  );
}
