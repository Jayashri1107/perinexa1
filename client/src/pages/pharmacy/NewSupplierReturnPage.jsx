// Return stock to a supplier: choose the supplier, then how many units of each of its batches go back (expired batches
// too – that is the usual reason). Schedule X and narcotic medicines need a witness's name.
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supplierReturnsApi, suppliersApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useOptions } from '../../hooks/useOptions.js';
import { formatDate, formatMoney, labelOf, toOptions } from '../../utils/format.js';

export function NewSupplierReturnPage() {
  const { pharmacy } = useAppConfig();
  const navigate = useNavigate();
  const suppliers = useOptions(suppliersApi.options);
  const [supplierId, setSupplierId] = useState('');
  const [batches, setBatches] = useState(null);
  const [qty, setQty] = useState({}); // batchId → units going back
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [witness, setWitness] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBatches(null);
    setQty({});
    if (!supplierId) return;
    supplierReturnsApi.batches(supplierId).then((r) => setBatches(r.items)).catch((err) => setError(err.message));
  }, [supplierId]);

  const chosen = (batches ?? []).filter((b) => Number(qty[b.batchId]) > 0);
  const needsWitness = chosen.some((b) => b.needsWitness);
  const amount = chosen.reduce((n, b) => n + Number(qty[b.batchId]) * b.rate, 0);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setFields({});
    try {
      const { supplierReturn } = await supplierReturnsApi.create({ supplierId, reason, note, witness, lines: chosen.map((b) => ({ batchId: b.batchId, qty: Number(qty[b.batchId]) })) });
      window.open(`/hospital/print/debit-note/${supplierReturn.id}`, '_blank', 'noopener');
      navigate('/hospital/pharmacy/supplier-returns');
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} noValidate>
      <PageHeader back={<Link to="/hospital/pharmacy/supplier-returns" className="back-link"><ArrowLeft size={16} aria-hidden /> Returns to supplier</Link>} title="Return stock to a supplier" />
      <Alert type="error">{error}</Alert>
      <section className="card">
        <div className="form-grid">
          <div className={`form-field width-third${fields.supplierId ? ' has-error' : ''}`}>
            <label htmlFor="ret-supplier">Supplier</label>
            <select id="ret-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Choose…</option>
              {suppliers.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className={`form-field width-third${fields.reason ? ' has-error' : ''}`}>
            <label htmlFor="ret-reason">Why</label>
            <select id="ret-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Choose…</option>
              {toOptions(pharmacy.supplierReturnReasons).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {fields.reason && <span className="field-error">{fields.reason}</span>}
          </div>
          <div className="form-field width-third">
            <label htmlFor="ret-note">Note (optional)</label>
            <input id="ret-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </div>
          {needsWitness && (
            <div className={`form-field width-half${fields.witness ? ' has-error' : ''}`}>
              <label htmlFor="ret-witness">Witness (Schedule X / narcotic)<span className="required" aria-hidden> *</span></label>
              <input id="ret-witness" value={witness} maxLength={100} onChange={(e) => setWitness(e.target.value)} />
              {fields.witness && <span className="field-error">{fields.witness}</span>}
            </div>
          )}
        </div>
      </section>

      {supplierId && (
        <section className="card top-gap">
          <h2>Batches bought from this supplier</h2>
          {batches && batches.length === 0 && <p className="muted">No stock from this supplier is left.</p>}
          {batches && batches.length > 0 && (
            <div className="table-wrap">
              <table className="table compact-inputs">
                <thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th className="num">In stock</th><th className="num">Rate</th><th className="num">Return</th></tr></thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.batchId}>
                      <td>
                        {b.medicineName}
                        {b.schedule !== pharmacy.schedules[0].key && <span className="badge badge-pending small">{labelOf(pharmacy.schedules, b.schedule)}</span>}
                      </td>
                      <td>{b.batch}</td>
                      <td className={b.isExpired ? 'btn-danger-text' : ''}>{formatDate(b.expiry)}{b.isExpired && ' (expired)'}</td>
                      <td className="num">{b.qty}</td>
                      <td className="num">{formatMoney(b.rate)}</td>
                      <td className="num">
                        <input aria-label={`Units of ${b.medicineName} batch ${b.batch} to return`} type="number" min="0" max={b.qty} value={qty[b.batchId] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [b.batchId]: e.target.value }))} />
                        {chosen.includes(b) && fields[`lines.${chosen.indexOf(b)}.qty`] && <span className="field-error block">{fields[`lines.${chosen.indexOf(b)}.qty`]}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="form-actions">
            <span>Debit note before GST: <strong>{formatMoney(amount)}</strong></span>
            <button type="submit" className="btn btn-primary" disabled={saving || chosen.length === 0 || !reason}>{saving ? 'Saving…' : 'Return and print the debit note'}</button>
          </div>
        </section>
      )}
    </form>
  );
}
