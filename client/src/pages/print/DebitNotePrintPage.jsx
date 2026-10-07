// The debit note of a return to a supplier, for printing: the pharmacy's details, the supplier, each batch returned at
// its purchase rate, and the GST (IGST for a supplier in another state, else CGST + SGST).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { pharmacySettingsApi, supplierReturnsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { formatDate, formatDateTime, formatMoney, labelOf } from '../../utils/format.js';
import { Letterhead, PrintFrame } from './PrintFrame.jsx';

export function DebitNotePrintPage() {
  const { id } = useParams();
  const { pharmacy: settings } = useAppConfig();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([supplierReturnsApi.get(id), pharmacySettingsApi.get()])
      .then(([r, p]) => setData({ ret: r.supplierReturn, ...p }))
      .catch((err) => setError(err.message));
  }, [id]);

  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  const { ret, pharmacy } = data;
  const letterhead = { ...data.letterhead, name: pharmacy.name || data.letterhead?.name };
  const half = Math.round((ret.gst / 2) * 100) / 100;

  return (
    <PrintFrame ready title={`Debit note ${ret.returnNumber}`} footer={pharmacy.pharmacistName ? `Pharmacist: ${pharmacy.pharmacistName}` : ''}>
      <Letterhead
        letterhead={letterhead}
        hospitalName={data.hospitalName}
        extra={<div className="print-doc">DEBIT NOTE<br /><strong>{ret.returnNumber}</strong><br />{formatDateTime(ret.created.at)}</div>}
      />
      <p className="small">
        {pharmacy.gstin && <>GSTIN {pharmacy.gstin} · </>}
        {pharmacy.licence20 && <>DL 20: {pharmacy.licence20} · </>}
        {pharmacy.licence21 && <>DL 21: {pharmacy.licence21}</>}
      </p>
      {ret.status === 'cancelled' && <p><strong>CANCELLED</strong> {formatDateTime(ret.cancelled.at)}: {ret.cancelled.reason}</p>}
      <p>
        To: <strong>{ret.supplierName}</strong>{ret.supplierGstin && ` · GSTIN ${ret.supplierGstin}`}
        <br />
        Reason: {labelOf(settings.supplierReturnReasons, ret.reason)}{ret.note && ` – ${ret.note}`}
      </p>
      <table className="print-table">
        <thead>
          <tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">GST</th><th className="num">Amount</th></tr>
        </thead>
        <tbody>
          {ret.lines.map((l) => (
            <tr key={l.batchId}>
              <td>{l.medicineName}</td><td>{l.batch}</td><td>{formatDate(l.expiry)}</td>
              <td className="num">{l.qty}</td><td className="num">{formatMoney(l.rate)}</td><td className="num">{l.gstRate}%</td><td className="num">{formatMoney(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="totals">
        <dt>Value of goods</dt><dd>{formatMoney(ret.amount)}</dd>
        {ret.interState ? (
          <><dt>IGST</dt><dd>{formatMoney(ret.gst)}</dd></>
        ) : (
          <><dt>CGST</dt><dd>{formatMoney(half)}</dd><dt>SGST</dt><dd>{formatMoney(Math.round((ret.gst - half) * 100) / 100)}</dd></>
        )}
        <dt><strong>Total</strong></dt><dd><strong>{formatMoney(ret.total)}</strong></dd>
      </dl>
      {ret.witness && <p className="small">Witness (Schedule X / narcotic): {ret.witness}</p>}
      <p className="small top-gap">Returned by {ret.created.byName}. Received by (supplier): ______________________</p>
    </PrintFrame>
  );
}
