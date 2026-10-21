import { useMemo, useState } from 'react';
import { PackagePlus, Plus, Save, Trash2, X } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Alert, Field, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { dayLabel } from '../appointments/appointmentFormat.js';
import { toPaise } from '../billing/billingFormat.js';
import { gstinProblem } from './gstin.js';
import { FORM_LABELS, SCHEDULE_LABELS, cleanBarcode, expiryLabel, isBarcode, medicineLabel, medicinesToCheck, orderLook, receiveLines, receivedFlash, scannedForPurchase } from './pharmacyFormat.js';
import { FindMedicine, Modal, PharmacyHeader, ScheduleMark, money, useSend } from './pharmacyUi.jsx';

// Pharmacy → Purchases (supplier invoices: stock in, batch by batch – also received against a purchase order),
// → Medicines (the stock list, with the barcodes on their packs) and → Suppliers.

function CancelPurchase({ purchase, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const s = useSend(onDone);
  return (
    <Modal id="ph-pu-cancel" title={`Cancel purchase ${purchase.number}`} onClose={onClose}>
      <p>Only while none of its stock has been sold, issued or written off.</p>
      <Alert type="error">{s.error}</Alert>
      <Field label="Reason" id="ph-pu-reason">
        <input id="ph-pu-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
      <div className="row">
        <button type="button" className="btn btn-danger" disabled={reason.trim().length < 3 || s.busy} onClick={() => s.send(`/pharmacy/purchases/${purchase.id}/cancel`, { reason: reason.trim() })}>
          Cancel the purchase
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Keep it
        </button>
      </div>
    </Modal>
  );
}

export function PurchasesPage() {
  const navigate = useNavigate();
  const { activeMembership } = useAuth();
  const res = useFetch('/pharmacy/purchases');
  const [cancelling, setCancelling] = useState(null);
  const desk = activeMembership.roles.includes('pharmacist');
  return (
    <>
      <PharmacyHeader
        title="Purchases"
        crumb="Purchases"
        buying
        actions={
          desk && (
            <button type="button" className="btn btn-primary" onClick={() => navigate('/pharmacy/purchases/new')}>
              <PackagePlus aria-hidden="true" /> Enter a purchase
            </button>
          )
        }
      />
      <div className="pf-content bill-page">
        {res.error && <Alert type="error">{res.error}</Alert>}
        {res.data && !res.data.purchases.length && <p className="muted">No purchases yet.</p>}
        {(res.data?.purchases ?? []).map((p) => (
          <section key={p.id} className={`card bill-section ${p.status === 'cancelled' ? 'bill-row-cancelled' : ''}`}>
            <div className="row-between">
              <h2>
                {p.number} · {p.supplier} · invoice {p.invoiceNo} · {dayLabel(p.invoiceDate)}
              </h2>
              <span className="row">
                <strong>{money(p.totalPaise)}</strong>
                {p.status === 'cancelled' ? (
                  <StatusPill tone="inactive">Cancelled – {p.cancelled?.reason}</StatusPill>
                ) : (
                  desk && (
                    <button type="button" className="btn btn-link btn-sm" onClick={() => setCancelling(p)}>
                      Cancel
                    </button>
                  )
                )}
              </span>
            </div>
            <table className="bill-report">
              <thead>
                <tr>
                  <th scope="col">Medicine</th>
                  <th scope="col">Batch</th>
                  <th scope="col">Expiry</th>
                  <th scope="col" className="num">Qty (+ free)</th>
                  <th scope="col" className="num">Rate</th>
                  <th scope="col" className="num">MRP</th>
                </tr>
              </thead>
              <tbody>
                {p.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.name}</td>
                    <td>{l.batch}</td>
                    <td>{expiryLabel(l.expiry)}</td>
                    <td className="num">
                      {l.qty}
                      {l.freeQty ? ` + ${l.freeQty}` : ''}
                    </td>
                    <td className="num">{money(l.ratePaise)}</td>
                    <td className="num">{money(l.mrpPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">
              Entered by {p.byName}
              {p.order && (
                <>
                  {' '}
                  · received against order <Link to={`/pharmacy/orders/${p.order.id}`}>{p.order.number}</Link>
                </>
              )}
            </p>
          </section>
        ))}
      </div>
      {cancelling && (
        <CancelPurchase
          purchase={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            res.reload();
          }}
        />
      )}
    </>
  );
}

let lineSeq = 0;
const blankLine = (m, key) => ({ key, medicine: m, batch: '', expiry: '', qty: '', freeQty: '', rate: '', mrp: '' });
const emptyLine = (m) => blankLine(m, `${m.id}-${(lineSeq += 1)}`);

export function NewPurchasePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // "Receive" on a purchase order comes here with ?order=<id>: the form is filled in from the order (its supplier,
  // and what is still to come of each medicine) and the purchase is linked to it.
  const orderId = /^[a-f\d]{24}$/i.test(params.get('order') ?? '') ? params.get('order') : null;
  const orderRes = useFetch(orderId ? `/pharmacy/orders/${orderId}` : null);
  const loaded = orderRes.data?.order ?? null;
  const order = loaded?.can.receive ? loaded : null;
  const suppliers = useFetch('/pharmacy/suppliers');
  const [pickedSupplier, setSupplierId] = useState('');
  const supplierId = order ? (order.supplier?.id ?? '') : pickedSupplier; // an order fixes the supplier
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  // The lines start as what the order still expects (none without an order) until the pharmacist changes them
  const orderLines = useMemo(() => (order ? receiveLines(order).map((x, i) => ({ ...blankLine(x.medicine, `${x.medicine.id}-order-${i}`), qty: String(x.qty) })) : []), [order]);
  const [changedLines, setChangedLines] = useState(null);
  const lines = changedLines ?? orderLines;
  const setLines = (change) => setChangedLines((ls) => change(ls ?? orderLines));
  const s = useSend((res) => {
    if (!res.order) return navigate('/pharmacy/purchases');
    const said = receivedFlash(res);
    return navigate(`/pharmacy/orders/${res.order.id}`, { state: said.warning ? { warning: said.text } : { flash: said.text } });
  });
  const set = (key, field, value) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  const scan = (m) => {
    const out = scannedForPurchase(m);
    if (out.add) setLines((ls) => [...ls, emptyLine(m)]);
    return out.said;
  };
  const parsed = lines.map((l) => ({ l, qty: Number(l.qty || 0), free: Number(l.freeQty || 0), rate: toPaise(l.rate || '0'), mrp: toPaise(l.mrp) }));
  const ok =
    supplierId &&
    invoiceNo.trim() &&
    parsed.length > 0 &&
    parsed.every((x) => x.l.batch.trim() && /^\d{4}-\d{2}$/.test(x.l.expiry) && Number.isInteger(x.qty) && Number.isInteger(x.free) && x.qty + x.free > 0 && x.rate != null && x.mrp > 0);
  const total = parsed.reduce((t, x) => t + (x.rate ?? 0) * x.qty, 0);
  if (orderId && !orderRes.data && !orderRes.error) {
    return (
      <>
        <PharmacyHeader title="Receive an order" crumb="New purchase" buying />
        <div className="pf-content">
          <p className="muted" aria-busy="true">
            Loading the order…
          </p>
        </div>
      </>
    );
  }
  return (
    <>
      <PharmacyHeader title={order ? `Receive order ${order.number}` : 'Enter a purchase'} crumb={order ? `Receive ${order.number}` : 'New purchase'} buying />
      <div className="pf-content bill-page">
        <Alert type="error" onClose={() => s.setError(null)}>
          {s.error}
        </Alert>
        {orderRes.error && <Alert type="error">The order could not be opened: {orderRes.error} This purchase will be entered without an order.</Alert>}
        {loaded && !order && (
          <Alert type="warning">
            Nothing can be received against order {loaded.number} ({orderLook(loaded).label.toLowerCase()}). <Link to={`/pharmacy/orders/${loaded.id}`}>Open the order</Link>, or enter this purchase without an order below.
          </Alert>
        )}
        {order && (
          <Alert type="info">
            Receiving against order <Link to={`/pharmacy/orders/${order.id}`}>{order.number}</Link>. The medicines still to come are filled in below. Change a quantity if fewer arrived, take off what did not come, and add a line for a second batch of the
            same medicine.
          </Alert>
        )}
        <section className="card bill-section">
          <h2>Supplier invoice</h2>
          {suppliers.data && !suppliers.data.suppliers.length && <Alert type="warning">Add a supplier first (Suppliers tab).</Alert>}
          <div className="form-grid">
            <Field label="Supplier" id="pu-sup" hint={order ? `The supplier of order ${order.number}.` : undefined}>
              <select id="pu-sup" value={supplierId} disabled={Boolean(order)} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Choose…</option>
                {(suppliers.data?.suppliers ?? [])
                  .filter((x) => x.active || x.id === supplierId)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Invoice number" id="pu-no">
              <input id="pu-no" value={invoiceNo} maxLength={60} onChange={(e) => setInvoiceNo(e.target.value)} />
            </Field>
            <Field label="Invoice date" id="pu-date">
              <input id="pu-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </Field>
          </div>
        </section>
        <section className="card bill-section">
          <h2>Medicines received</h2>
          <FindMedicine onPick={(m) => setLines((ls) => [...ls, emptyLine(m)])} onScan={scan} />
          {lines.length > 0 && (
            <table className="bill-lines ph-pu-lines">
              <thead>
                <tr>
                  <th scope="col">Medicine</th>
                  <th scope="col">Batch</th>
                  <th scope="col">Expiry</th>
                  <th scope="col">Qty</th>
                  <th scope="col">Free</th>
                  <th scope="col">Rate (₹/unit)</th>
                  <th scope="col">MRP (₹/unit)</th>
                  <th scope="col">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td data-label="Medicine">{medicineLabel(l.medicine)}</td>
                    <td data-label="Batch">
                      <input className="ph-batch" aria-label="Batch" value={l.batch} maxLength={40} onChange={(e) => set(l.key, 'batch', e.target.value)} />
                    </td>
                    <td data-label="Expiry">
                      <input aria-label="Expiry month" type="month" value={l.expiry} onChange={(e) => set(l.key, 'expiry', e.target.value)} />
                    </td>
                    <td data-label="Qty">
                      <input className="ph-num" aria-label="Quantity" inputMode="numeric" value={l.qty} onChange={(e) => set(l.key, 'qty', e.target.value)} />
                    </td>
                    <td data-label="Free">
                      <input className="ph-num" aria-label="Free quantity" inputMode="numeric" value={l.freeQty} onChange={(e) => set(l.key, 'freeQty', e.target.value)} />
                    </td>
                    <td data-label="Rate">
                      <input className="ph-num" aria-label="Purchase rate per unit" inputMode="decimal" value={l.rate} onChange={(e) => set(l.key, 'rate', e.target.value)} />
                    </td>
                    <td data-label="MRP">
                      <input className="ph-num" aria-label="MRP per unit" inputMode="decimal" value={l.mrp} onChange={(e) => set(l.key, 'mrp', e.target.value)} />
                    </td>
                    <td>
                      <button type="button" className="icon-btn" aria-label={`Remove ${l.medicine.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                        <Trash2 aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="hint">Prices per unit of sale (e.g. per tablet: a strip of 10 at ₹30 is ₹3). Purchase value: {money(total)}.</p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!ok || s.busy}
            onClick={() =>
              s.send('/pharmacy/purchases', {
                supplierId,
                invoiceNo: invoiceNo.trim(),
                invoiceDate,
                ...(order ? { orderId: order.id } : {}),
                lines: parsed.map((x) => ({ medicineId: x.l.medicine.id, batch: x.l.batch.trim(), expiry: x.l.expiry, qty: x.qty, freeQty: x.free, ratePaise: x.rate, mrpPaise: x.mrp })),
              })
            }
          >
            <Save aria-hidden="true" /> {s.busy ? 'Saving…' : 'Save and add to stock'}
          </button>
        </section>
      </div>
    </>
  );
}

// ---------- Medicines ----------

const emptyMedicine = { name: '', generic: '', form: 'tablet', strength: '', unit: 'tablet', hsn: '3004', gstRate: 5, schedule: '', reorderLevel: 0, barcodes: [] };
const MAX_BARCODES = 10;

/**
 * The barcodes of a medicine: scanned (a scanner types the digits and presses Enter) or typed, one at a time. A
 * medicine can hold several – one for each pack size or maker's pack.
 */
export function BarcodesField({ barcodes, onChange, typed, setTyped, error }) {
  const [problem, setProblem] = useState(null);
  const add = () => {
    const code = cleanBarcode(typed);
    if (!code) return;
    if (!isBarcode(code)) return setProblem('A barcode has 4 to 32 digits or letters.');
    if (barcodes.includes(code)) return setProblem('This barcode is already on the list.');
    if (barcodes.length >= MAX_BARCODES) return setProblem(`A medicine can hold at most ${MAX_BARCODES} barcodes.`);
    setProblem(null);
    setTyped('');
    return onChange([...barcodes, code]);
  };
  return (
    <>
      <Field label="Barcodes on the pack (optional)" id="med-barcode" error={problem ?? error} keepHint hint="Click in the box and scan the pack, or type the number under the bars, then press Enter. A barcode belongs to one medicine only.">
        <input
          id="med-barcode"
          value={typed}
          maxLength={60}
          autoComplete="off"
          spellCheck={false}
          placeholder="Scan or type a barcode"
          onChange={(e) => {
            setTyped(e.target.value);
            setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
      </Field>
      {barcodes.length > 0 && (
        <ul className="ph-chips" aria-label="Barcodes of this medicine">
          {barcodes.map((code) => (
            <li key={code} className="ph-chip">
              <span className="tabular">{code}</span>
              <button type="button" className="icon-btn" aria-label={`Remove barcode ${code}`} onClick={() => onChange(barcodes.filter((x) => x !== code))}>
                <X aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function MedicineDialog({ medicine, lists, onClose, onDone }) {
  const [m, setM] = useState(medicine ? { ...medicine, barcodes: medicine.barcodes ?? [] } : { ...emptyMedicine });
  const [typedBarcode, setTypedBarcode] = useState('');
  const s = useSend(onDone);
  const f = (k) => (e) => setM({ ...m, [k]: e.target.value });
  // A barcode typed but not yet added with Enter is saved too (it would be lost otherwise)
  const pending = cleanBarcode(typedBarcode);
  const barcodes = pending && isBarcode(pending) && !m.barcodes.includes(pending) ? [...m.barcodes, pending] : m.barcodes;
  const barcodeError = Object.entries(s.fields).find(([k]) => k === 'barcodes' || k.startsWith('barcodes.'))?.[1];
  const gstRates = lists?.gstRates ?? [0, 5, 18];
  const body = { name: m.name.trim(), generic: m.generic.trim(), form: m.form, strength: m.strength.trim(), unit: m.unit.trim(), hsn: m.hsn.trim(), gstRate: Number(m.gstRate), schedule: m.schedule, reorderLevel: Number(m.reorderLevel) || 0, barcodes };
  return (
    <Modal id="ph-med" title={medicine ? `Change ${medicine.name}` : 'Add a medicine'} onClose={onClose} wide>
      <Alert type="error">{s.error}</Alert>
      <div className="form-grid">
        <Field label="Brand name (as on the pack)" id="med-name" error={s.fields.name}>
          <input id="med-name" value={m.name} maxLength={120} onChange={f('name')} autoFocus />
        </Field>
        <Field label="Generic name" id="med-generic">
          <input id="med-generic" value={m.generic} maxLength={160} onChange={f('generic')} />
        </Field>
        <Field label="Strength" id="med-strength">
          <input id="med-strength" value={m.strength} maxLength={60} onChange={f('strength')} />
        </Field>
        <Field label="Form" id="med-form">
          <select id="med-form" value={m.form} onChange={f('form')}>
            {(lists?.forms ?? Object.keys(FORM_LABELS)).map((x) => (
              <option key={x} value={x}>
                {FORM_LABELS[x]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Unit of sale" id="med-unit" hint="tablet, bottle, vial, tube …">
          <input id="med-unit" value={m.unit} maxLength={30} onChange={f('unit')} />
        </Field>
        <Field label="HSN code" id="med-hsn" error={s.fields.hsn} hint="4, 6 or 8 digits. The e-invoice file of a sale to a business needs 6 or 8.">
          <input id="med-hsn" inputMode="numeric" value={m.hsn} maxLength={8} onChange={f('hsn')} />
        </Field>
        <Field label="GST rate" id="med-gst" error={s.fields.gstRate} hint="Medicines 5 % since 22 September 2025; nil for listed life-saving drugs; 18 % for non-medicine items.">
          <select id="med-gst" value={m.gstRate} onChange={f('gstRate')}>
            {gstRates.includes(Number(m.gstRate)) ? null : <option value={m.gstRate}>{m.gstRate}% (no longer in use – choose another)</option>}
            {gstRates.map((r) => (
              <option key={r} value={r}>
                {r}%
              </option>
            ))}
          </select>
        </Field>
        <Field label="Schedule" id="med-schedule">
          <select id="med-schedule" value={m.schedule} onChange={f('schedule')}>
            {Object.entries(SCHEDULE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reorder level" id="med-reorder" hint="Low-stock alert at or below this">
          <input id="med-reorder" inputMode="numeric" value={m.reorderLevel} onChange={f('reorderLevel')} />
        </Field>
      </div>
      <BarcodesField barcodes={m.barcodes} onChange={(list) => setM({ ...m, barcodes: list })} typed={typedBarcode} setTyped={setTypedBarcode} error={barcodeError} />
      {['X', 'narcotic'].includes(m.schedule) && <Alert type="warning">Controlled medicine: sold only to registered patients against a prescription with the doctor’s registration number; its own register; counts need a witness. Narcotics need the hospital’s NDPS recognition (RMI).</Alert>}
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={body.name.length < 2 || !body.unit || s.busy} onClick={() => (medicine ? s.send(`/pharmacy/medicines/${medicine.id}`, body, 'PATCH') : s.send('/pharmacy/medicines', body))}>
          <Save aria-hidden="true" /> {s.busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function MedicinesPage() {
  const res = useFetch('/pharmacy/medicines');
  const settings = useFetch('/pharmacy/settings');
  const [editing, setEditing] = useState(null); // 'new' | medicine
  const [checkShown, setCheckShown] = useState(true);
  const canEdit = Boolean(settings.data?.canEdit);
  const toCheck = medicinesToCheck(res.data?.medicines);
  const done = () => {
    setEditing(null);
    res.reload();
  };
  return (
    <>
      <PharmacyHeader
        title="Medicines"
        crumb="Medicines"
        actions={
          canEdit && (
            <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
              <Plus aria-hidden="true" /> Add a medicine
            </button>
          )
        }
      />
      <div className="pf-content bill-page">
        {res.error && <Alert type="error">{res.error}</Alert>}
        {canEdit && checkShown && toCheck.length > 0 && (
          <Alert type="warning" onClose={() => setCheckShown(false)}>
            Please check {toCheck.length === 1 ? 'this medicine' : `these ${toCheck.length} medicines`}:{' '}
            {toCheck
              .slice(0, 12)
              .map((m) => m.name)
              .join(', ')}
            {toCheck.length > 12 ? ` and ${toCheck.length - 12} more` : ''}. {toCheck.length === 1 ? 'Its' : 'Their'} generic name, strength, HSN code, schedule and reorder level are all empty. Until 4 Oct 2026 a fault emptied them when a
            medicine was stopped or used again. If one is a prescription medicine (Schedule H, H1 or X) or a narcotic, choose Change and set its schedule: without it, it is sold with no prescription check and is missing from its register. A
            medicine that has none of these needs no change.
          </Alert>
        )}
        <section className="card bill-section">
          <table className="bill-prices">
            <thead>
              <tr>
                <th scope="col">Medicine</th>
                <th scope="col">Form · unit</th>
                <th scope="col">HSN · GST</th>
                <th scope="col">Schedule</th>
                <th scope="col" className="num">In stock</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(res.data?.medicines ?? []).map((m) => (
                <tr key={m.id} className={m.active ? '' : 'bill-row-cancelled'}>
                  <td>
                    {medicineLabel(m)}
                    {m.barcodes?.length > 0 && (
                      <span className="ph-line-note">
                        {m.barcodes.length === 1 ? `Barcode ${m.barcodes[0]}` : `${m.barcodes.length} barcodes`}
                      </span>
                    )}
                  </td>
                  <td>
                    {FORM_LABELS[m.form]} · {m.unit}
                  </td>
                  <td>
                    {m.hsn || '–'} · {m.gstRate}%
                  </td>
                  <td>
                    <ScheduleMark schedule={m.schedule} />
                  </td>
                  <td className="num">{m.inStock}</td>
                  <td className="bill-price-actions">
                    {canEdit && (
                      <>
                        <button type="button" className="btn btn-link btn-sm" onClick={() => setEditing(m)}>
                          Change
                        </button>
                        <MedicineActive m={m} onDone={res.reload} />
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {res.data && !res.data.medicines.length && (
                <tr>
                  <td colSpan={6} className="muted">
                    No medicines yet. Add them as they are first bought.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
      {editing && <MedicineDialog medicine={editing === 'new' ? null : editing} lists={settings.data?.lists} onClose={() => setEditing(null)} onDone={done} />}
    </>
  );
}

function MedicineActive({ m, onDone }) {
  const s = useSend(onDone);
  return (
    <button type="button" className="btn btn-link btn-sm" disabled={s.busy} onClick={() => s.send(`/pharmacy/medicines/${m.id}`, { active: !m.active }, 'PATCH')}>
      {m.active ? 'Stop using' : 'Use again'}
    </button>
  );
}

// ---------- Suppliers ----------

function SupplierDialog({ supplier, onClose, onDone }) {
  const [x, setX] = useState(supplier ? { ...supplier } : { name: '', gstin: '', drugLicence: '', phone: '', address: '' });
  const s = useSend(onDone);
  const f = (k) => (e) => setX({ ...x, [k]: e.target.value });
  const body = { name: x.name.trim(), gstin: x.gstin.trim(), drugLicence: x.drugLicence.trim(), phone: x.phone.trim(), address: x.address.trim() };
  return (
    <Modal id="ph-sup" title={supplier ? `Change ${supplier.name}` : 'Add a supplier'} onClose={onClose}>
      <Alert type="error">{s.error}</Alert>
      <Field label="Name" id="sup-name">
        <input id="sup-name" value={x.name} maxLength={150} onChange={f('name')} autoFocus />
      </Field>
      <div className="form-grid">
        <Field label="GSTIN" id="sup-gstin" keepHint hint={x.gstin.trim() && gstinProblem(x.gstin) ? `Please check: ${gstinProblem(x.gstin)} It can still be saved.` : undefined}>
          <input id="sup-gstin" value={x.gstin} maxLength={20} onChange={f('gstin')} />
        </Field>
        <Field label="Drug licence no." id="sup-dl">
          <input id="sup-dl" value={x.drugLicence} maxLength={80} onChange={f('drugLicence')} />
        </Field>
        <Field label="Phone" id="sup-phone">
          <input id="sup-phone" value={x.phone} maxLength={30} onChange={f('phone')} />
        </Field>
      </div>
      <Field label="Address" id="sup-address">
        <input id="sup-address" value={x.address} maxLength={300} onChange={f('address')} />
      </Field>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={body.name.length < 2 || s.busy} onClick={() => (supplier ? s.send(`/pharmacy/suppliers/${supplier.id}`, body, 'PATCH') : s.send('/pharmacy/suppliers', body))}>
          <Save aria-hidden="true" /> Save
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function SuppliersPage() {
  const { activeMembership } = useAuth();
  const res = useFetch('/pharmacy/suppliers');
  const settings = useFetch('/pharmacy/settings');
  const [editing, setEditing] = useState(null);
  const canEdit = Boolean(settings.data?.canEdit);
  const desk = activeMembership.roles.includes('pharmacist');
  return (
    <>
      <PharmacyHeader
        title="Suppliers"
        crumb="Suppliers"
        actions={
          canEdit && (
            <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
              <Plus aria-hidden="true" /> Add a supplier
            </button>
          )
        }
      />
      <div className="pf-content bill-page">
        {res.error && <Alert type="error">{res.error}</Alert>}
        <section className="card bill-section">
          <table className="bill-prices">
            <thead>
              <tr>
                <th scope="col">Supplier</th>
                <th scope="col">GSTIN</th>
                <th scope="col">Drug licence</th>
                <th scope="col">Phone</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(res.data?.suppliers ?? []).map((x) => (
                <tr key={x.id} className={x.active ? '' : 'bill-row-cancelled'}>
                  <td>{x.name}</td>
                  <td>{x.gstin}</td>
                  <td>{x.drugLicence}</td>
                  <td>{x.phone}</td>
                  <td className="bill-price-actions">
                    {desk && (
                      <Link className="btn btn-link btn-sm" to={`/pharmacy/supplier-returns/new?supplier=${x.id}`}>
                        Return stock
                      </Link>
                    )}
                    {canEdit && (
                      <button type="button" className="btn btn-link btn-sm" onClick={() => setEditing(x)}>
                        Change
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {res.data && !res.data.suppliers.length && (
                <tr>
                  <td colSpan={5} className="muted">
                    No suppliers yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
      {editing && (
        <SupplierDialog
          supplier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            res.reload();
          }}
        />
      )}
    </>
  );
}
