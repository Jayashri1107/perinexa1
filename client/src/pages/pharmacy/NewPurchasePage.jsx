// Record one supplier invoice: each line (medicine, batch, expiry, quantity, cost, MRP, GST) becomes a stock batch.
import { ArrowLeft, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { purchasesApi, suppliersApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useOptions } from '../../hooks/useOptions.js';
import { formatMoney, todayInput } from '../../utils/format.js';
import { MedicineSearch } from './MedicineSearch.jsx';

export function NewPurchasePage() {
  const { pharmacy } = useAppConfig();
  const navigate = useNavigate();
  const suppliers = useOptions(suppliersApi.options);
  const [head, setHead] = useState({ supplierId: '', invoiceNumber: '', invoiceDate: todayInput() });
  const [lines, setLines] = useState([]);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const addLine = (m) =>
    setLines((all) => [...all, { medicineId: m.id, name: `${m.name} ${m.strength ?? ''}`.trim(), batch: '', expiry: '', qty: '', freeQty: '', purchasePrice: '', mrp: '', gstRate: m.gstRate }]);
  const update = (i, key, value) => setLines((all) => all.map((l, j) => (j === i ? { ...l, [key]: value } : l)));
  const total = lines.reduce((n, l) => n + (Number(l.purchasePrice) || 0) * (Number(l.qty) || 0), 0);

  const save = async (e) => {
    e.preventDefault();
    setError('');
    setErrors({});
    setSaving(true);
    try {
      await purchasesApi.create({
        ...head,
        lines: lines.map(({ name, ...l }) => ({ ...l, freeQty: l.freeQty || 0 })),
      });
      navigate('/hospital/pharmacy/purchases');
    } catch (err) {
      setErrors(err.fields ?? {});
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const lineError = (i) => Object.entries(errors).filter(([k]) => k.startsWith(`lines.${i}.`)).map(([, m]) => m).join(' ');

  return (
    <form onSubmit={save} noValidate>
      <PageHeader back={<Link to="/hospital/pharmacy/purchases" className="back-link"><ArrowLeft size={16} aria-hidden /> Purchases</Link>} title="Record purchase" />
      <Alert type="error">{error}</Alert>
      <section className="card">
        <div className="form-grid">
          <div className={`form-field width-half${errors.supplierId ? ' has-error' : ''}`}>
            <label htmlFor="supplier">Supplier</label>
            <select id="supplier" value={head.supplierId} onChange={(e) => setHead({ ...head, supplierId: e.target.value })}>
              <option value="">Choose…</option>
              {suppliers.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {suppliers.length === 0 && <span className="field-help">Add the supplier under Suppliers first.</span>}
          </div>
          <div className={`form-field width-third${errors.invoiceNumber ? ' has-error' : ''}`}>
            <label htmlFor="inv">Invoice number</label>
            <input id="inv" value={head.invoiceNumber} onChange={(e) => setHead({ ...head, invoiceNumber: e.target.value })} />
            {errors.invoiceNumber && <span className="field-error">{errors.invoiceNumber}</span>}
          </div>
          <div className="form-field width-third">
            <label htmlFor="invdate">Invoice date</label>
            <input id="invdate" type="date" max={todayInput()} value={head.invoiceDate} onChange={(e) => setHead({ ...head, invoiceDate: e.target.value })} />
          </div>
        </div>
      </section>

      <section className="card top-gap">
        <h2>Medicines received</h2>
        <MedicineSearch onPick={addLine} showStock={false} label="Add a medicine from the list" />
        {lines.length > 0 && (
          <div className="table-wrap top-gap">
            <table className="table compact-inputs">
              <thead>
                <tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th className="num">Qty</th><th className="num">Free</th><th className="num">Cost / unit</th><th className="num">MRP / unit</th><th>GST</th><th /></tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.name}{lineError(i) && <span className="field-error block">{lineError(i)}</span>}</td>
                    <td><input aria-label="Batch" value={l.batch} onChange={(e) => update(i, 'batch', e.target.value)} /></td>
                    <td><input aria-label="Expiry" type="date" value={l.expiry} onChange={(e) => update(i, 'expiry', e.target.value)} /></td>
                    <td className="num"><input aria-label="Quantity" type="number" min="1" value={l.qty} onChange={(e) => update(i, 'qty', e.target.value)} /></td>
                    <td className="num"><input aria-label="Free quantity" type="number" min="0" value={l.freeQty} onChange={(e) => update(i, 'freeQty', e.target.value)} /></td>
                    <td className="num"><input aria-label="Cost per unit" type="number" min="0" step="0.01" value={l.purchasePrice} onChange={(e) => update(i, 'purchasePrice', e.target.value)} /></td>
                    <td className="num"><input aria-label="MRP per unit" type="number" min="0" step="0.01" value={l.mrp} onChange={(e) => update(i, 'mrp', e.target.value)} /></td>
                    <td>
                      <select aria-label="GST" value={l.gstRate} onChange={(e) => update(i, 'gstRate', e.target.value)}>
                        {pharmacy.gstRates.map((r) => <option key={r} value={r}>{r}%</option>)}
                      </select>
                    </td>
                    <td className="actions"><button type="button" className="icon-btn" aria-label={`Remove ${l.name}`} onClick={() => setLines((all) => all.filter((_, j) => j !== i))}><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="form-actions">
          <span>Cost of the invoice: <strong>{formatMoney(total)}</strong></span>
          <button type="submit" className="btn btn-primary" disabled={saving || lines.length === 0}>{saving ? 'Saving…' : 'Save purchase'}</button>
        </div>
      </section>
    </form>
  );
}
