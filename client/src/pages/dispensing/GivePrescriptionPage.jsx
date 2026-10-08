// Give a prescription (owner, 8 Oct 2026) – the pharmacy or the front desk:
//  1. her details and the prescription (doctor, date);
//  2. the doctor's medicines – read only (name, dose, how long) – each matched to the pharmacy's stock with the
//     quantity worked out from the dose and the days, its price and amount; more medicines can be added (and removed);
//  3. other charges from the price list (consultation, registration …) or written in;
//  4. discount, total, payment method and amount received;
//  5. "Give and make the bill": stock goes out, one bill holds everything, the payment is recorded – then "Print bill".
import { ArrowLeft, CircleCheck, Lock, Plus, Printer, ReceiptText, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { dispensingApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { ageText, formatMoney, labelOf } from '../../utils/format.js';
import { dayText } from '../appointments/appointmentFormat.js';
import { DURATION_UNITS, TIMINGS } from '../visits/visitFormat.js';

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const howLong = (i) => (i.durationUnit === 'till_delivery' || i.durationUnit === 'continue' ? DURATION_UNITS[i.durationUnit] : i.durationValue ? `${i.durationValue} ${DURATION_UNITS[i.durationUnit] || 'days'}` : '—');

// The last row of the medicine table (owner, 8 Oct 2026): type a medicine, its quantity and price, and Add. Typing shows
// the medicines in stock – picking one fills its price (it is then sold from stock); any other name is added with the
// price typed here (on the bill, no stock change).
function AddMedicineRow({ onAdd, disabled }) {
  const empty = { name: '', medicine: null, qty: 1, price: '' };
  const [row, setRow] = useState(empty);
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    const text = row.name.trim();
    if (!text || row.medicine) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      dispensingApi.medicines(text).then((r) => !cancelled && setResults(r.items.filter((m) => m.available > 0))).catch(() => !cancelled && setResults([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [row.name, row.medicine]);

  const pickStock = (m) => {
    setRow((r) => ({ ...r, name: `${m.name}${m.strength ? ` ${m.strength}` : ''}`, medicine: m, price: m.mrp, qty: Math.min(Number(r.qty) || 1, m.available) }));
    setOpen(false);
  };
  const add = () => {
    const qty = Number(row.qty);
    if (row.name.trim().length < 2) return setProblem('Type the medicine name.');
    if (!(qty >= 1)) return setProblem('Enter the quantity.');
    if (row.medicine && qty > row.medicine.available) return setProblem(`Only ${row.medicine.available} in stock.`);
    if (!row.medicine && (row.price === '' || !(Number(row.price) >= 0))) return setProblem('Enter the price.');
    setProblem('');
    onAdd({ medicine: row.medicine, name: row.name.trim(), qty, price: row.medicine ? row.medicine.mrp : money(row.price) });
    setRow(empty);
    return undefined;
  };
  const amount = money(row.price) * (Number(row.qty) || 0);

  return (
    <tr className="give-add-row">
      <td>
        <div className="picker">
          <input
            aria-label="Medicine to add"
            placeholder="+ Add a medicine – type its name"
            value={row.name}
            disabled={disabled}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => setRow((r) => ({ ...r, name: e.target.value, medicine: null, price: r.medicine ? '' : r.price }))}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          />
          {open && results.length > 0 && (
            <ul className="picker-results" role="listbox">
              {results.map((m) => (
                <li key={m.id}>
                  <button type="button" role="option" aria-selected="false" onMouseDown={(e) => e.preventDefault()} onClick={() => pickStock(m)}>
                    <strong>{m.name}</strong> {m.strength} <span className="muted"> · {m.available} in stock · MRP {formatMoney(m.mrp)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {row.medicine ? <span className="block small give-stock">From stock</span> : row.name.trim() && <span className="block small give-nostock">Not from stock – enter the price</span>}
        {problem && <span className="field-error block">{problem}</span>}
      </td>
      <td className="num">{row.medicine ? row.medicine.available : '—'}</td>
      <td className="num">
        <input className="qty" type="number" min="1" aria-label="Quantity of the medicine to add" value={row.qty} disabled={disabled} onChange={(e) => setRow((r) => ({ ...r, qty: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
      </td>
      <td className="num">
        {row.medicine ? formatMoney(row.medicine.mrp) : (
          <input className="qty give-price" type="number" min="0" step="0.01" placeholder="₹" aria-label="Price of the medicine to add" value={row.price} disabled={disabled} onChange={(e) => setRow((r) => ({ ...r, price: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
        )}
      </td>
      <td className="num">{formatMoney(amount)}</td>
      <td className="actions"><button type="button" className="btn btn-primary btn-sm" disabled={disabled} onClick={add}><Plus size={14} aria-hidden /> Add</button></td>
    </tr>
  );
}

export function GivePrescriptionPage() {
  const { visitId } = useParams();
  const navigate = useNavigate();
  const { patients: settings } = useAppConfig();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const [rows, setRows] = useState([]); // the doctor's medicines: { rx, medicine (stock match or null), qty, price }
  const [extra, setExtra] = useState([]); // medicines added here: { medicine (from stock) or null, name, qty, price }
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
        // every medicine the doctor wrote: in stock (the stock's price) or not (the price is typed here)
        setRows(d.items.map((i) => ({ rx: i.rx, medicine: i.medicine, qty: i.qty, price: i.medicine ? i.medicine.mrp : '' })));
        setPayment((p) => ({ ...p, mode: d.modes[0]?.key ?? 'cash' }));
      })
      .catch((err) => setError(err.message));
  }, [visitId]);

  const medicineTotal = money(rows.reduce((n, r) => n + money(r.price) * (Number(r.qty) || 0), 0) + extra.reduce((n, l) => n + money(l.price) * (Number(l.qty) || 0), 0));
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
          <p className="muted">The medicines from stock left the stock, everything is on the bill, the payment is recorded and the prescription is marked given.</p>
          <div className="button-row">
            <a className="btn btn-primary btn-lg" href={`/hospital/print/prescription-bill/${done.billId}`} target="_blank" rel="noreferrer"><Printer size={18} aria-hidden /> Print bill</a>
            <button type="button" className="btn btn-ghost btn-lg" onClick={() => navigate('/hospital')}>Back to Today</button>
          </div>
        </section>
      </>
    );
  }

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const giving = rows.filter((r) => Number(r.qty) > 0);
  // the same stock medicine twice: its quantities add up on one row
  const addExtra = (item) =>
    setExtra((x) => {
      const same = item.medicine && x.findIndex((l) => l.medicine?.id === item.medicine.id);
      if (item.medicine && same >= 0) return x.map((l, j) => (j === same ? { ...l, qty: Math.min(l.qty + item.qty, item.medicine.available) } : l));
      return [...x, item];
    });
  const setExtraRow = (i, patch) => setExtra((x) => x.map((l, j) => (j === i ? { ...l, ...patch } : l)));
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
    const noPrice = [...giving.filter((r) => !r.medicine && r.price === '').map((r) => r.rx.drug), ...extra.filter((l) => !l.medicine && l.price === '').map((l) => l.name)];
    if (noPrice.length) {
      setError(`Enter the price of ${noPrice.join(', ')} – or set its quantity to 0 if it is not given.`);
      return;
    }
    setSaving(true);
    setError('');
    setFields({});
    // not on the stock list: on the bill as a medicine line with the price typed here (no stock change)
    const writtenIn = [
      ...giving.filter((r) => !r.medicine).map((r) => ({ name: `${r.rx.drug}${r.rx.strength && !r.rx.drug.includes(r.rx.strength) ? ` ${r.rx.strength}` : ''}`, group: 'medicine', unitPrice: money(r.price), qty: Number(r.qty) })),
      ...extra.filter((l) => !l.medicine).map((l) => ({ name: l.name, group: 'medicine', unitPrice: money(l.price), qty: Number(l.qty) || 1 })),
    ];
    try {
      const r = await dispensingApi.give(visitId, {
        medicines: [...giving.filter((x) => x.medicine).map((x) => ({ medicineId: x.medicine.id, qty: Number(x.qty) })), ...extra.filter((l) => l.medicine).map((l) => ({ medicineId: l.medicine.id, qty: Number(l.qty) || 1 }))],
        charges: [...writtenIn, ...charges.map(({ priceItemId, name, group, unitPrice, qty }) => (priceItemId ? { priceItemId, qty } : { name, group, unitPrice, qty }))],
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

  // A medicine the doctor wrote: the name and dose locked; the quantity can be set (0 = not given); the price is the
  // stock's (in stock) or typed here (not on the stock list).
  const rxRow = (r, i) => {
    const qty = Number(r.qty) || 0;
    return (
      <tr key={`rx${i}`} className={`rx-locked${qty === 0 ? ' struck-row' : ''}`}>
        <td>
          <strong><Lock size={12} aria-hidden /> {r.rx.drug}{r.rx.strength && !r.rx.drug.includes(r.rx.strength) ? ` ${r.rx.strength}` : ''}</strong>
          <span className="block small muted">
            {r.rx.frequency === 'custom' ? r.rx.frequencyText : r.rx.frequency}
            {r.rx.timing && TIMINGS[r.rx.timing] !== '—' && ` · ${TIMINGS[r.rx.timing]}`} · {howLong(r.rx)}
          </span>
          <span className="block small">{r.medicine ? <span className="give-stock">From stock: {r.medicine.name} {r.medicine.strength}</span> : <span className="give-nostock">Not on the stock list – enter the price</span>}</span>
        </td>
        <td className="num">{r.medicine ? r.medicine.available : '—'}</td>
        <td className="num">
          <input className="qty" type="number" min="0" max={r.medicine ? r.medicine.available : 10000} aria-label={`Quantity of ${r.rx.drug}`} value={r.qty} disabled={given} onChange={(e) => setRow(i, { qty: e.target.value === '' ? '' : Math.max(0, Math.min(Number(e.target.value), r.medicine ? r.medicine.available : 10000)) })} />
        </td>
        <td className="num">
          {r.medicine ? (
            formatMoney(r.medicine.mrp)
          ) : (
            <input className="qty give-price" type="number" min="0" step="0.01" placeholder="₹" aria-label={`Price of ${r.rx.drug}`} value={r.price} disabled={given} onChange={(e) => setRow(i, { price: e.target.value })} />
          )}
        </td>
        <td className="num">{formatMoney(money(r.price) * qty)}</td>
        <td className="actions"><span className="badge badge-info small" title="From the doctor's prescription – the name cannot be changed">Prescribed</span></td>
      </tr>
    );
  };
  // A medicine added here: quantity (and the price when not from stock) can still be changed, or the row removed.
  const extraRow = (l, i) => {
    const max = l.medicine ? l.medicine.available : 10000;
    return (
      <tr key={`x${i}`}>
        <td>
          <strong>{l.name}</strong>
          <span className="block small">{l.medicine ? <span className="give-stock">Added here · from stock</span> : <span className="muted">Added here · not from stock</span>}</span>
        </td>
        <td className="num">{l.medicine ? l.medicine.available : '—'}</td>
        <td className="num">
          <input className="qty" type="number" min="1" max={max} aria-label={`Quantity of ${l.name}`} value={l.qty} disabled={given} onChange={(e) => setExtraRow(i, { qty: e.target.value === '' ? '' : Math.max(1, Math.min(Number(e.target.value) || 1, max)) })} />
        </td>
        <td className="num">
          {l.medicine ? formatMoney(l.medicine.mrp) : (
            <input className="qty give-price" type="number" min="0" step="0.01" aria-label={`Price of ${l.name}`} value={l.price} disabled={given} onChange={(e) => setExtraRow(i, { price: e.target.value })} />
          )}
        </td>
        <td className="num">{formatMoney(money(l.price) * (Number(l.qty) || 0))}</td>
        <td className="actions">
          <button type="button" className="icon-btn" aria-label={`Remove ${l.name}`} onClick={() => setExtra((x) => x.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
        </td>
      </tr>
    );
  };

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
          <span className="muted small"><Lock size={12} aria-hidden /> The doctor's medicines cannot be renamed – set the quantity and price, and add more below.</span>
        </div>
        {data.items.some((i) => i.short && i.medicine) && <p className="small muted">Less in stock than prescribed for: {data.items.filter((i) => i.short && i.medicine).map((i) => i.medicine.name).join(', ')} – the quantity is what can be given.</p>}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Medicine</th><th className="num">In stock</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th><th /></tr>
            </thead>
            <tbody>
              {rows.map(rxRow)}
              {extra.map(extraRow)}
              {rows.length + extra.length === 0 && <tr><td colSpan={6} className="empty">No medicines to give.</td></tr>}
              {!given && <AddMedicineRow onAdd={addExtra} />}
            </tbody>
            <tfoot>
              <tr className="total-row"><td colSpan={4}><strong>Medicine total</strong></td><td className="num"><strong>{formatMoney(medicineTotal)}</strong></td><td /></tr>
            </tfoot>
          </table>
        </div>
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
              <button type="button" className="btn btn-primary btn-block btn-lg" disabled={saving || giving.length + extra.length + charges.length === 0} onClick={submit}>
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
