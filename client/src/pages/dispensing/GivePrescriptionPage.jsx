// Give a prescription (owner, 8 Oct 2026) – the pharmacy or the front desk:
//  1. her details and the prescription (doctor, date);
//  2. the doctor's medicines – read only (name, dose, how long) – each matched to the pharmacy's stock with the
//     quantity worked out from the dose and the days, its price and amount; more medicines can be added (and removed);
//  3. other charges from the price list (consultation, registration …) or written in;
//  4. discount, total, payment method and amount received;
//  5. "Give and make the bill": stock goes out, one bill holds everything, the payment is recorded – then "Print bill".
import { ArrowLeft, CircleCheck, Lock, Plus, Printer, ReceiptText, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { dispensingApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { ageText, formatMoney, labelOf } from '../../utils/format.js';
import { dayText } from '../appointments/appointmentFormat.js';
import { MedicineSearch } from '../pharmacy/MedicineSearch.jsx';
import { DURATION_UNITS, TIMINGS } from '../visits/visitFormat.js';

const searchMedicines = (text) => dispensingApi.medicines(text);
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const howLong = (i) => (i.durationUnit === 'till_delivery' || i.durationUnit === 'continue' ? DURATION_UNITS[i.durationUnit] : i.durationValue ? `${i.durationValue} ${DURATION_UNITS[i.durationUnit] || 'days'}` : '—');

export function GivePrescriptionPage() {
  const { visitId } = useParams();
  const navigate = useNavigate();
  const { patients: settings } = useAppConfig();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const [extra, setExtra] = useState([]); // medicines added here: { medicine, qty }
  const [charges, setCharges] = useState([]); // { priceItemId | name, group, unitPrice, qty, label }
  const [pick, setPick] = useState('');
  const [custom, setCustom] = useState({ name: '', amount: '' });
  const [discount, setDiscount] = useState({ amount: '', reason: '' });
  const [payment, setPayment] = useState({ mode: '', amount: '', reference: '' });
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null); // { billId, billNumber } once given

  useEffect(() => {
    dispensingApi
      .get(visitId)
      .then((d) => {
        setData(d);
        setPayment((p) => ({ ...p, mode: d.modes[0]?.key ?? 'cash' }));
      })
      .catch((err) => setError(err.message));
  }, [visitId]);

  const prescribed = useMemo(() => (data?.items ?? []).filter((i) => i.medicine && i.qty > 0), [data]);
  const missing = (data?.items ?? []).filter((i) => !i.medicine);
  const medicineTotal = money([...prescribed, ...extra].reduce((n, l) => n + l.medicine.mrp * l.qty, 0));
  const chargeTotal = money(charges.reduce((n, c) => n + c.unitPrice * c.qty, 0));
  const discountAmount = Math.min(money(discount.amount), medicineTotal + chargeTotal);
  const total = money(medicineTotal + chargeTotal - discountAmount);
  const received = payment.amount === '' ? total : money(payment.amount);
  const mode = data?.modes.find((m) => m.key === payment.mode);

  if (error && !data) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  const { patient, prescription } = data;
  const given = prescription.status === 'given' || Boolean(done);

  if (done) {
    return (
      <>
        <PageHeader back={<Link to="/hospital" className="back-link"><ArrowLeft size={16} aria-hidden /> Today</Link>} title="Prescription given" subtitle={`${patient.name} · ${patient.patientNumber}`} />
        <section className="card give-done">
          <span className="give-done-icon" aria-hidden><CircleCheck size={34} /></span>
          <h2>Bill {done.billNumber} is ready</h2>
          <p className="muted">The medicines left the stock, the payment is recorded and the prescription is marked given.</p>
          <div className="button-row">
            <a className="btn btn-primary btn-lg" href={`/hospital/print/prescription-bill/${done.billId}`} target="_blank" rel="noreferrer"><Printer size={18} aria-hidden /> Print bill</a>
            <button type="button" className="btn btn-ghost btn-lg" onClick={() => navigate('/hospital')}>Back to Today</button>
          </div>
        </section>
      </>
    );
  }

  const addExtra = (m) => {
    if ([...prescribed, ...extra].some((l) => l.medicine.id === m.id)) return;
    setExtra((x) => [...x, { medicine: m, qty: 1 }]);
  };
  const addCharge = () => {
    const item = data.charges.find((c) => c.id === pick);
    if (!item) return;
    setCharges((c) => [...c, { priceItemId: item.id, label: item.name, group: item.group, unitPrice: item.price, qty: 1 }]);
    setPick('');
  };
  const addCustom = () => {
    if (custom.name.trim().length < 2 || !(Number(custom.amount) >= 0) || custom.amount === '') return;
    setCharges((c) => [...c, { name: custom.name.trim(), label: custom.name.trim(), group: 'other', unitPrice: money(custom.amount), qty: 1 }]);
    setCustom({ name: '', amount: '' });
  };

  const submit = async () => {
    setSaving(true);
    setError('');
    setFields({});
    try {
      const r = await dispensingApi.give(visitId, {
        medicines: [...prescribed, ...extra].map((l) => ({ medicineId: l.medicine.id, qty: l.qty })),
        charges: charges.map(({ priceItemId, name, group, unitPrice, qty }) => (priceItemId ? { priceItemId, qty } : { name, group, unitPrice, qty })),
        discount: { amount: discountAmount, reason: discount.reason },
        payment: { mode: payment.mode, reference: payment.reference, amount: Math.min(received, total) },
      });
      setDone(r);
      setSaving(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setSaving(false);
    }
  };

  const medicineRow = (l, locked, i) => (
    <tr key={l.medicine.id} className={locked ? 'rx-locked' : undefined}>
      <td>
        <strong>{l.medicine.name} {l.medicine.strength}</strong>
        {locked ? (
          <span className="block small muted">
            {l.rx.drug} · {l.rx.frequency === 'custom' ? l.rx.frequencyText : l.rx.frequency}
            {l.rx.timing && TIMINGS[l.rx.timing] !== '—' && ` · ${TIMINGS[l.rx.timing]}`} · {howLong(l.rx)}
          </span>
        ) : (
          <span className="block small muted">Added here</span>
        )}
      </td>
      <td className="num">{l.medicine.available}</td>
      <td className="num">
        {locked ? (
          <strong>{l.qty}</strong>
        ) : (
          <input className="qty" type="number" min="1" max={l.medicine.available} aria-label={`Quantity of ${l.medicine.name}`} value={l.qty} onChange={(e) => setExtra((x) => x.map((y, j) => (j === i ? { ...y, qty: Math.max(1, Math.min(Number(e.target.value) || 1, l.medicine.available)) } : y)))} />
        )}
      </td>
      <td className="num">{formatMoney(l.medicine.mrp)}</td>
      <td className="num">{formatMoney(l.medicine.mrp * l.qty)}</td>
      <td className="actions">
        {locked ? <span className="badge badge-info small" title="From the doctor's prescription – cannot be changed"><Lock size={11} aria-hidden /> Prescribed</span> : (
          <button type="button" className="icon-btn" aria-label={`Remove ${l.medicine.name}`} onClick={() => setExtra((x) => x.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
        )}
      </td>
    </tr>
  );

  return (
    <>
      <PageHeader
        back={<Link to="/hospital" className="back-link"><ArrowLeft size={16} aria-hidden /> Today</Link>}
        title="Give prescription"
        subtitle={`${patient.name} · ${patient.patientNumber}`}
      />
      <Alert type="error">{error}</Alert>
      {given && (
        <Alert type="info">
          This prescription was already given. {prescription.invoiceNumber && `(invoice ${prescription.invoiceNumber})`}
        </Alert>
      )}

      <section className="card give-head">
        <dl className="give-facts">
          <div><dt>Patient</dt><dd><strong>{patient.name}</strong></dd></div>
          <div><dt>Patient no.</dt><dd>{patient.patientNumber}</dd></div>
          <div><dt>Age · sex</dt><dd>{ageText(patient.birthDate, patient.birthDateApprox)} · {labelOf(settings.sexes, patient.sex)}</dd></div>
          <div><dt>Doctor</dt><dd>{prescription.doctor || '—'}</dd></div>
          <div><dt>Prescription</dt><dd>{dayText(prescription.visitOn)}</dd></div>
        </dl>
      </section>

      <section className="card top-gap">
        <div className="card-head">
          <h2>Medicines</h2>
          <span className="muted small"><Lock size={12} aria-hidden /> The doctor's medicines cannot be changed – you can add more.</span>
        </div>
        {missing.length > 0 && (
          <Alert type="info">Not in stock or not on the medicine list: {missing.map((m) => m.rx.drug).join(', ')}.</Alert>
        )}
        {prescribed.some((i) => i.short) && <p className="small muted">Less in stock than prescribed for: {prescribed.filter((i) => i.short).map((i) => i.medicine.name).join(', ')} – the quantity is what can be given.</p>}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Medicine</th><th className="num">In stock</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th><th /></tr>
            </thead>
            <tbody>
              {prescribed.map((l) => medicineRow(l, true))}
              {extra.map((l, i) => medicineRow(l, false, i))}
              {prescribed.length + extra.length === 0 && <tr><td colSpan={6} className="empty">No medicines to give.</td></tr>}
            </tbody>
            <tfoot>
              <tr className="total-row"><td colSpan={4}><strong>Medicine total</strong></td><td className="num"><strong>{formatMoney(medicineTotal)}</strong></td><td /></tr>
            </tfoot>
          </table>
        </div>
        {!given && <MedicineSearch onPick={addExtra} search={searchMedicines} label="+ Add a medicine" />}
        {prescription.notes && <p className="small muted">Doctor's advice: {prescription.notes}</p>}
      </section>

      <div className="grid-2 top-gap give-grid">
        <section className="card">
          <h2>Other charges</h2>
          {charges.length === 0 && <p className="muted small">None added – e.g. consultation, registration.</p>}
          <ul className="plain-list give-charges">
            {charges.map((c, i) => (
              <li key={i}>
                <span>{c.label}</span>
                <strong>{formatMoney(c.unitPrice * c.qty)}</strong>
                <button type="button" className="icon-btn" aria-label={`Remove ${c.label}`} onClick={() => setCharges((x) => x.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
          {!given && (
            <>
              <div className="give-add">
                <select aria-label="Charge from the price list" value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">Choose from the price list…</option>
                  {data.charges.map((c) => <option key={c.id} value={c.id}>{c.name} – {formatMoney(c.price)}</option>)}
                </select>
                <button type="button" className="btn btn-ghost btn-sm" disabled={!pick} onClick={addCharge}><Plus size={14} aria-hidden /> Add</button>
              </div>
              <div className="give-add">
                <input aria-label="Other charge name" placeholder="Or write a charge" value={custom.name} onChange={(e) => setCustom((c) => ({ ...c, name: e.target.value }))} />
                <input aria-label="Other charge amount" className="give-amount" type="number" min="0" placeholder="₹" value={custom.amount} onChange={(e) => setCustom((c) => ({ ...c, amount: e.target.value }))} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={addCustom}><Plus size={14} aria-hidden /> Add</button>
              </div>
            </>
          )}
        </section>

        <section className="card give-pay">
          <h2>Bill</h2>
          <dl className="totals give-totals">
            <dt>Medicines</dt><dd>{formatMoney(medicineTotal)}</dd>
            <dt>Other charges</dt><dd>{formatMoney(chargeTotal)}</dd>
            <dt>Discount</dt><dd>{discountAmount > 0 ? `−${formatMoney(discountAmount)}` : formatMoney(0)}</dd>
            <dt className="give-grand">Grand total</dt><dd className="give-grand">{formatMoney(total)}</dd>
          </dl>
          {!given && (
            <>
              <div className="form-grid top-gap-sm">
                <div className="form-field width-third">
                  <label htmlFor="give-discount">Discount (₹)</label>
                  <input id="give-discount" type="number" min="0" value={discount.amount} onChange={(e) => setDiscount((d) => ({ ...d, amount: e.target.value }))} />
                </div>
                {discountAmount > 0 && (
                  <div className={`form-field width-two-thirds${fields['discount.reason'] ? ' has-error' : ''}`}>
                    <label htmlFor="give-reason">Reason for the discount</label>
                    <input id="give-reason" value={discount.reason} onChange={(e) => setDiscount((d) => ({ ...d, reason: e.target.value }))} />
                    {fields['discount.reason'] && <span className="field-error">{fields['discount.reason']}</span>}
                  </div>
                )}
              </div>
              <div className="form-field">
                <span className="field-label">Payment method</span>
                <div className="checkbox-group">
                  {data.modes.map((m) => (
                    <label key={m.key} className={`chip-check${payment.mode === m.key ? ' checked' : ''}`}>
                      <input type="radio" name="give-mode" checked={payment.mode === m.key} onChange={() => setPayment((p) => ({ ...p, mode: m.key }))} /> {m.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="form-grid">
                <div className={`form-field width-half${fields['payment.amount'] ? ' has-error' : ''}`}>
                  <label htmlFor="give-received">Amount received (₹)</label>
                  <input id="give-received" type="number" min="0" max={total} value={payment.amount === '' ? total : payment.amount} onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))} />
                  {fields['payment.amount'] && <span className="field-error">{fields['payment.amount']}</span>}
                </div>
                {mode?.needsReference && (
                  <div className={`form-field width-half${fields['payment.reference'] ? ' has-error' : ''}`}>
                    <label htmlFor="give-ref">Reference</label>
                    <input id="give-ref" value={payment.reference} onChange={(e) => setPayment((p) => ({ ...p, reference: e.target.value }))} />
                    {fields['payment.reference'] && <span className="field-error">{fields['payment.reference']}</span>}
                  </div>
                )}
              </div>
              <p className="give-balance">Balance after payment: <strong>{formatMoney(Math.max(0, total - Math.min(received, total)))}</strong></p>
              <button type="button" className="btn btn-primary btn-block btn-lg" disabled={saving || prescribed.length + extra.length + charges.length === 0} onClick={submit}>
                <ReceiptText size={18} aria-hidden /> {saving ? 'Making the bill…' : 'Give and make the bill'}
              </button>
              <p className="muted small"><Printer size={12} aria-hidden /> The bill opens for printing.</p>
            </>
          )}
        </section>
      </div>
    </>
  );
}
