// The counter: sell medicines to a registered patient (paid here or on her hospital bill) or to a walk-in buyer.
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { salesApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { PatientPicker } from '../../components/PatientPicker.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { formatMoney, labelOf } from '../../utils/format.js';
import { FromPrescription } from './FromPrescription.jsx';
import { MedicineSearch } from './MedicineSearch.jsx';
import { PharmacyFrame } from './PharmacyFrame.jsx';

const EMPTY = { patient: null, customerName: '', doctorName: '', lines: [], discount: '', discountReason: '', payTo: 'counter', mode: '', reference: '' };

export function SellPage() {
  const { pharmacy, billing } = useAppConfig();
  const navigate = useNavigate();
  // Opened from the Prescriptions tab: her, and the prescription the doctor sent (its medicines are put on the sale)
  const from = useLocation().state;
  const [visitId, setVisitId] = useState(from?.visitId ?? null);
  const [sale, setSale] = useState({ ...EMPTY, patient: from?.patient ?? null, mode: billing.paymentModes[0].key });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (patch) => setSale((s) => ({ ...s, ...patch }));
  const registerSchedules = pharmacy.schedules.filter((s) => s.register).map((s) => s.key);
  const needsRegister = sale.lines.some((l) => registerSchedules.includes(l.schedule));
  const subtotal = sale.lines.reduce((n, l) => n + l.mrp * (Number(l.qty) || 0), 0);
  const total = Math.max(0, subtotal - (Number(sale.discount) || 0));
  const needsReference = billing.paymentModes.find((m) => m.key === sale.mode)?.needsReference;

  const addLine = (m) => {
    if (sale.lines.some((l) => l.medicineId === m.id)) return;
    set({ lines: [...sale.lines, { medicineId: m.id, name: `${m.name} ${m.strength ?? ''}`.trim(), schedule: m.schedule, available: m.available, mrp: m.mrp, qty: 1 }] });
  };
  // from her prescription: each medicine found on the stock list, once
  const usePrescription = (found, doctor) =>
    setSale((s) => {
      const lines = [...s.lines];
      for (const { medicine: m, qty } of found) {
        if (lines.some((l) => l.medicineId === m.id)) continue;
        lines.push({ medicineId: m.id, name: `${m.name} ${m.strength ?? ''}`.trim(), schedule: m.schedule, available: m.available, mrp: m.mrp, qty: Math.min(qty, m.available) });
      }
      return { ...s, lines, doctorName: s.doctorName || doctor || '' };
    });
  const updateLine = (i, qty) => set({ lines: sale.lines.map((l, j) => (j === i ? { ...l, qty } : l)) });

  const submit = async (e) => {
    e.preventDefault();
    setErrors({});
    setError('');
    setSaving(true);
    try {
      const { sale: done } = await salesApi.create({
        patientId: sale.patient?.id,
        visitId: sale.patient ? visitId ?? undefined : undefined,
        customerName: sale.patient ? '' : sale.customerName,
        doctorName: sale.doctorName,
        lines: sale.lines.map((l) => ({ medicineId: l.medicineId, qty: Number(l.qty) })),
        discount: { amount: Number(sale.discount) || 0, reason: sale.discountReason },
        payTo: sale.payTo,
        mode: sale.payTo === 'counter' ? sale.mode : undefined,
        reference: sale.reference,
      });
      navigate(`/hospital/pharmacy/sales/${done.id}`);
    } catch (err) {
      setErrors(err.fields ?? {});
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PharmacyFrame subtitle="Sell at the counter. The earliest-expiring batch is used first; expired stock cannot be sold.">
      <form onSubmit={submit} noValidate>
        <Alert type="error">{error}</Alert>
        <div className="grid-2">
          <section className="card">
            <h2>Buyer</h2>
            <PatientPicker
              search={salesApi.patients}
              value={sale.patient}
              onChange={(p) => {
                if (p?.id !== sale.patient?.id) setVisitId(null); // another patient: not that prescription any more
                set({ patient: p, payTo: p ? sale.payTo : 'counter' });
              }}
              label="Registered patient (optional)"
              error={errors.customerName}
            />
            {sale.patient && <FromPrescription patientId={sale.patient.id} onUse={usePrescription} autoUseVisitId={visitId} onUsed={setVisitId} />}
            {!sale.patient && (
              <div className="form-field">
                <label htmlFor="customer">Or the buyer's name</label>
                <input id="customer" value={sale.customerName} onChange={(e) => set({ customerName: e.target.value })} />
              </div>
            )}
            <div className={`form-field top-gap${errors.doctorName ? ' has-error' : ''}`}>
              <label htmlFor="doctor">Prescribing doctor{needsRegister && <span className="required"> *</span>}</label>
              <input id="doctor" value={sale.doctorName} onChange={(e) => set({ doctorName: e.target.value })} />
              {errors.doctorName ? <span className="field-error">{errors.doctorName}</span> : needsRegister && <span className="field-help">Needed for H1, X and narcotic medicines (register).</span>}
            </div>
          </section>

          <section className="card">
            <h2>Payment</h2>
            <div className="form-field">
              <span className="field-label">Paid</span>
              <div className="checkbox-group">
                <label className={`chip-check${sale.payTo === 'counter' ? ' checked' : ''}`}>
                  <input type="radio" name="payTo" checked={sale.payTo === 'counter'} onChange={() => set({ payTo: 'counter' })} /> At the counter
                </label>
                <label className={`chip-check${sale.payTo === 'bill' ? ' checked' : ''}`}>
                  <input type="radio" name="payTo" disabled={!sale.patient} checked={sale.payTo === 'bill'} onChange={() => set({ payTo: 'bill' })} /> On her hospital bill
                </label>
              </div>
            </div>
            {sale.payTo === 'counter' && (
              <div className="form-grid top-gap">
                <div className="form-field width-half">
                  <label htmlFor="mode">Mode</label>
                  <select id="mode" value={sale.mode} onChange={(e) => set({ mode: e.target.value })}>
                    {billing.paymentModes.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                  </select>
                </div>
                {needsReference && (
                  <div className={`form-field width-half${errors.reference ? ' has-error' : ''}`}>
                    <label htmlFor="reference">Reference</label>
                    <input id="reference" value={sale.reference} onChange={(e) => set({ reference: e.target.value })} />
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <section className="card top-gap">
          <h2>Medicines</h2>
          <MedicineSearch onPick={addLine} />
          {sale.lines.length > 0 && (
            <div className="table-wrap top-gap">
              <table className="table">
                <thead>
                  <tr><th>Medicine</th><th className="num">In stock</th><th className="num">Qty</th><th className="num">MRP</th><th className="num">Amount</th><th /></tr>
                </thead>
                <tbody>
                  {sale.lines.map((l, i) => (
                    <tr key={l.medicineId}>
                      <td>{l.name} {l.schedule !== pharmacy.schedules[0].key && <span className="badge badge-pending small">{labelOf(pharmacy.schedules, l.schedule)}</span>}</td>
                      <td className="num">{l.available}</td>
                      <td className="num"><input className="qty" type="number" min="1" max={l.available} aria-label={`Quantity of ${l.name}`} value={l.qty} onChange={(e) => updateLine(i, e.target.value)} /></td>
                      <td className="num">{formatMoney(l.mrp)}</td>
                      <td className="num">{formatMoney(l.mrp * (Number(l.qty) || 0))}</td>
                      <td className="actions">
                        <button type="button" className="icon-btn" aria-label={`Remove ${l.name}`} onClick={() => set({ lines: sale.lines.filter((_, j) => j !== i) })}><Trash2 size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="form-grid top-gap">
            <div className="form-field width-third">
              <label htmlFor="discount">Discount (₹)</label>
              <input id="discount" type="number" min="0" value={sale.discount} onChange={(e) => set({ discount: e.target.value })} />
            </div>
            {Number(sale.discount) > 0 && (
              <div className={`form-field width-two-thirds${errors['discount.reason'] ? ' has-error' : ''}`}>
                <label htmlFor="discountReason">Reason for the discount</label>
                <input id="discountReason" value={sale.discountReason} onChange={(e) => set({ discountReason: e.target.value })} />
              </div>
            )}
          </div>
          <div className="form-actions">
            <span>Estimated total: <strong>{formatMoney(total)}</strong> <span className="muted small">(MRP may differ by batch)</span></span>
            <button type="submit" className="btn btn-primary" disabled={saving || sale.lines.length === 0}>{saving ? 'Selling…' : 'Sell and make invoice'}</button>
          </div>
        </section>
      </form>
    </PharmacyFrame>
  );
}
