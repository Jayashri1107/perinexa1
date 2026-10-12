import { useState } from 'react';
import { ClipboardList, ListPlus, PackagePlus, Pencil, Printer, Save, Send, Trash2 } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { DataTable } from '../../components/DataTable.jsx';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { dayLabel } from '../appointments/appointmentFormat.js';
import { FORM_LABELS, linesFromSuggestions, medicineLabel, momentDay, orderLook, suggestionSummary, unitsLabel } from './pharmacyFormat.js';
import { MedicineFinder, Modal, PharmacyHeader, ScheduleMark, useSend } from './pharmacyUi.jsx';

// Pharmacy → Purchases → Orders: purchase orders to suppliers (PO-000001 …). An order is what the pharmacy asks a
// supplier for: draft → sent → part received / received, or cancelled. It moves no stock – "Receive" opens the
// New purchase form filled in from the order, and the stock comes in with that purchase.

function OrderStatus({ order }) {
  const look = orderLook(order);
  return (
    <StatusPill tone={look.tone} icon={look.icon}>
      {look.label}
    </StatusPill>
  );
}

const FILTERS = [
  ['', 'All'],
  ['draft', 'Drafts'],
  ['sent', 'Sent'],
  ['part_received', 'Part received'],
  ['received', 'Received'],
  ['cancelled', 'Cancelled'],
];

export function OrdersPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const res = useFetch('/pharmacy/orders', { status });
  return (
    <>
      <PharmacyHeader
        title="Purchase orders"
        crumb="Orders"
        buying
        actions={
          <button type="button" className="btn btn-primary" onClick={() => navigate('/pharmacy/orders/new')}>
            <ClipboardList aria-hidden="true" /> New order
          </button>
        }
      />
      <div className="pf-content bill-page">
        {res.error && <Alert type="error">{res.error}</Alert>}
        <p className="hint">An order is what you ask a supplier for. Stock comes in only when the delivery is received as a purchase.</p>
        <DataTable
          caption="Purchase orders"
          rows={res.data?.orders}
          loading={res.loading}
          onRowClick={(o) => navigate(`/pharmacy/orders/${o.id}`)}
          emptyText={status ? 'No orders like this.' : 'No orders yet.'}
          toolbar={
            <div className="segmented" role="group" aria-label="Show">
              {FILTERS.map(([k, label]) => (
                <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)}>
                  {label}
                </button>
              ))}
            </div>
          }
          columns={[
            { key: 'number', header: 'Order', render: (o) => <span className="tabular">{o.number}</span> },
            { key: 'date', header: 'Made on', render: (o) => momentDay(o.date) },
            { key: 'supplier', header: 'Supplier', render: (o) => o.supplier?.name ?? '' },
            { key: 'items', header: 'Medicines', align: 'right', render: (o) => o.items },
            { key: 'status', header: 'Status', render: (o) => <OrderStatus order={o} /> },
          ]}
        />
      </div>
    </>
  );
}

// ---------- A new order, or a draft being changed ----------

const fromOrder = (o) => ({
  supplierId: o.supplier?.id ?? '',
  note: o.note ?? '',
  lines: o.lines.map((l) => ({ medicine: l.medicine ?? { id: l.medicineId, name: l.name }, qty: String(l.qty), note: '' })),
});
const EMPTY = { supplierId: '', note: '', lines: [] };

export function OrderFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const suppliers = useFetch('/pharmacy/suppliers');
  const existing = useFetch(id ? `/pharmacy/orders/${id}` : null);
  const [form, setForm] = useState(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState(null);
  const s = useSend((res) => navigate(`/pharmacy/orders/${res.order.id}`, { state: { flash: `Order ${res.order.number} saved as a draft.` } }));
  const order = existing.data?.order;
  const start = id ? (order ? fromOrder(order) : null) : EMPTY;
  const v = form ?? start;
  const title = id ? `Change order ${order?.number ?? ''}` : 'New purchase order';

  if (existing.error) {
    return (
      <>
        <PharmacyHeader title={title} crumb="Orders" buying />
        <div className="pf-content">
          <Alert type="error">{existing.error}</Alert>
        </div>
      </>
    );
  }
  if (!v) {
    return (
      <>
        <PharmacyHeader title={title} crumb="Orders" buying />
        <div className="pf-content">
          <p className="muted" aria-busy="true">
            Loading the order…
          </p>
        </div>
      </>
    );
  }
  if (order && !order.can.edit) {
    return (
      <>
        <PharmacyHeader title={title} crumb="Orders" buying />
        <div className="pf-content">
          <Alert type="warning">
            Order {order.number} is no longer a draft, so it cannot be changed. <Link to={`/pharmacy/orders/${order.id}`}>Open the order</Link>
          </Alert>
        </div>
      </>
    );
  }

  const set = (patch) => setForm({ ...v, ...patch });
  const add = (medicine, qty = '', note = '') => {
    if (v.lines.some((l) => l.medicine.id === medicine.id)) return;
    set({ lines: [...v.lines, { medicine, qty: String(qty), note }] });
  };
  const suggest = async () => {
    setSuggesting(true);
    setSuggested(null);
    s.setError(null);
    try {
      const res = await api('/pharmacy/orders/suggest');
      const out = linesFromSuggestions(res.suggestions, v.lines);
      set({ lines: [...v.lines, ...out.add.map((x) => ({ medicine: x.medicine, qty: String(x.qty), note: x.note }))] });
      setSuggested(`${suggestionSummary(out, res.suggestions.length)}${out.add.length ? ` Each quantity brings the medicine to ${res.times} times its reorder level: change it as you need.` : ''}`);
    } catch (err) {
      s.setError(err.message);
    } finally {
      setSuggesting(false);
    }
  };
  const qtyOk = v.lines.length > 0 && v.lines.every((l) => /^\d+$/.test(l.qty) && Number(l.qty) > 0);
  const save = () => {
    const body = { supplierId: v.supplierId, note: v.note.trim(), lines: v.lines.map((l) => ({ medicineId: l.medicine.id, qty: Number(l.qty) })) };
    if (id) s.send(`/pharmacy/orders/${id}`, body, 'PUT');
    else s.send('/pharmacy/orders', body);
  };
  const supplierList = (suppliers.data?.suppliers ?? []).filter((x) => x.active || x.id === v.supplierId);

  return (
    <>
      <PharmacyHeader title={title} crumb={id ? 'Change order' : 'New order'} buying />
      <div className="pf-content bill-page">
        <Alert type="error" onClose={() => s.setError(null)}>
          {s.error}
        </Alert>
        <section className="card bill-section">
          <h2>Supplier</h2>
          {suppliers.data && !suppliers.data.suppliers.some((x) => x.active) && <Alert type="warning">Add a supplier first (Suppliers tab).</Alert>}
          <div className="form-grid">
            <Field label="Order from" id="po-sup" error={s.fields.supplierId}>
              <select id="po-sup" value={v.supplierId} onChange={(e) => set({ supplierId: e.target.value })}>
                <option value="">Choose…</option>
                {supplierList.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Note to the supplier (optional)" id="po-note" hint="Printed on the order, for example when to deliver.">
              <input id="po-note" value={v.note} maxLength={300} onChange={(e) => set({ note: e.target.value })} />
            </Field>
          </div>
        </section>

        <section className="card bill-section">
          <div className="row-between">
            <h2>Medicines to order</h2>
            <button type="button" className="btn btn-secondary" disabled={suggesting} onClick={suggest}>
              <ListPlus aria-hidden="true" /> {suggesting ? 'Looking at the stock…' : 'Suggest from low stock'}
            </button>
          </div>
          <p className="hint ph-under-heading">“Suggest from low stock” adds every medicine at or below its reorder level. Take off the ones this supplier does not sell.</p>
          {suggested && (
            <Alert type="info" onClose={() => setSuggested(null)}>
              {suggested}
            </Alert>
          )}
          <MedicineFinder label="Add a medicine" onPick={(m) => add(m)} />
          {v.lines.length > 0 && (
            <table className="bill-lines ph-lines">
              <thead>
                <tr>
                  <th scope="col">Medicine</th>
                  <th scope="col" className="num">
                    Quantity
                  </th>
                  <th scope="col">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {v.lines.map((l) => (
                  <tr key={l.medicine.id}>
                    <td data-label="Medicine">
                      {medicineLabel(l.medicine)} <ScheduleMark schedule={l.medicine.schedule} />
                      {l.note && <span className="ph-line-note">{l.note}</span>}
                    </td>
                    <td data-label="Quantity" className="num">
                      <input
                        className="bill-price-input"
                        inputMode="numeric"
                        aria-label={`Quantity of ${l.medicine.name}${l.medicine.unit ? ` (${l.medicine.unit}s)` : ''}`}
                        value={l.qty}
                        onChange={(e) => set({ lines: v.lines.map((x) => (x.medicine.id === l.medicine.id ? { ...x, qty: e.target.value } : x)) })}
                      />{' '}
                      <span className="ph-unit">{l.medicine.unit ? `${l.medicine.unit}s` : ''}</span>
                    </td>
                    <td>
                      <button type="button" className="icon-btn" aria-label={`Remove ${l.medicine.name}`} onClick={() => set({ lines: v.lines.filter((x) => x.medicine.id !== l.medicine.id) })}>
                        <Trash2 aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="hint">Quantities are in units of sale (tablets, bottles, vials …), as in the stock. The order is saved as a draft: you can change it until you mark it as sent.</p>
          <div className="row ph-actions">
            <button type="button" className="btn btn-primary" disabled={!v.supplierId || !qtyOk || s.busy} onClick={save}>
              <Save aria-hidden="true" /> {s.busy ? 'Saving…' : 'Save the draft'}
            </button>
            <button type="button" className="btn btn-link" onClick={() => navigate(id ? `/pharmacy/orders/${id}` : '/pharmacy/orders')}>
              Cancel
            </button>
          </div>
        </section>
      </div>
    </>
  );
}

// ---------- One order ----------

function ReasonDialog({ id, title, intro, label, danger = false, confirm, keep, path, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const s = useSend(onDone);
  return (
    <Modal id={id} title={title} onClose={onClose}>
      <p>{intro}</p>
      <Alert type="error">{s.error}</Alert>
      <Field label={label} id={`${id}-reason`} error={s.fields.reason}>
        <input id={`${id}-reason`} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
      <div className="row">
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={reason.trim().length < 3 || s.busy} onClick={() => s.send(path, { reason: reason.trim() })}>
          {s.busy ? 'Saving…' : confirm}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          {keep}
        </button>
      </div>
    </Modal>
  );
}

/** The printed purchase order (A4), with the pharmacy's details. */
export function OrderDocument({ order: o, settings }) {
  const sup = o.supplier ?? {};
  const mark = o.status === 'draft' ? ' – draft, not sent' : o.status === 'cancelled' ? ' – cancelled' : '';
  return (
    <PrintDocument className="bill-doc ph-doc">
      <header className="ph-doc-head">
        <div className="lh-name">{settings.name}</div>
        {settings.address && <div>{settings.address}</div>}
        <div className="pdoc-small">
          {[settings.phone && `Phone ${settings.phone}`, settings.gstin && `GSTIN ${settings.gstin}`, settings.licence20 && `DL 20: ${settings.licence20}`, settings.licence21 && `DL 21: ${settings.licence21}`].filter(Boolean).join(' · ')}
        </div>
      </header>
      <h1 className="pdoc-title">Purchase order{mark}</h1>
      <table className="bill-doc-head">
        <tbody>
          <tr>
            <th scope="row">Order no.</th>
            <td>{o.number}</td>
            <th scope="row">Date</th>
            <td>{momentDay(o.sent?.at ?? o.date)}</td>
          </tr>
          <tr>
            <th scope="row">To</th>
            <td>{sup.name}</td>
            <th scope="row">GSTIN</th>
            <td>{sup.gstin || '–'}</td>
          </tr>
          <tr>
            <th scope="row">Address</th>
            <td>{sup.address || '–'}</td>
            <th scope="row">Drug licence</th>
            <td>{sup.drugLicence || '–'}</td>
          </tr>
        </tbody>
      </table>
      <table className="bill-doc-lines ph-doc-lines">
        <thead>
          <tr>
            <th scope="col">No.</th>
            <th scope="col">Medicine</th>
            <th scope="col">Form</th>
            <th scope="col" className="num">
              Quantity
            </th>
          </tr>
        </thead>
        <tbody>
          {o.lines.map((l, i) => (
            <tr key={l.id}>
              <td>{i + 1}</td>
              <td>{l.medicine ? medicineLabel(l.medicine) : l.name}</td>
              <td>{l.medicine ? FORM_LABELS[l.medicine.form] : ''}</td>
              <td className="num">{l.medicine ? unitsLabel(l.qty, l.medicine.unit) : l.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {o.note && <p className="ph-doc-note">Note: {o.note}</p>}
      <p className="pdoc-small">Please show the batch number, expiry date, MRP and HSN code of each medicine on your invoice. Quantities are in single units (tablets, bottles, vials), not packs.</p>
      <p className="bill-sign">
        For {settings.name}: ____________________{settings.pharmacistName ? ` (${settings.pharmacistName})` : ''}
      </p>
    </PrintDocument>
  );
}

function OrderPrint({ order, settings, onClose }) {
  const record = () => api(`/pharmacy/orders/${order.id}/printed`, { method: 'POST', body: {} });
  return (
    <PrintPreview title="Purchase order – print preview" hint="Check it, then print on A4 paper." onPrint={record} onClose={onClose}>
      <OrderDocument order={order} settings={settings} />
    </PrintPreview>
  );
}

const NEXT = {
  draft: 'A draft. Change it as you need, then mark it as sent once the supplier has it – printed, phoned or messaged. Perinexa itself sends nothing to the supplier.',
  sent: 'Waiting for the delivery. When it arrives the pharmacist chooses Receive and enters the supplier’s invoice: batches, expiry dates and prices.',
  part_received: 'Part of it has arrived. Receive the rest when it comes, or close the order if nothing more will come.',
  received: 'Everything ordered has arrived.',
  cancelled: 'This order was cancelled.',
};

export function OrderPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const res = useFetch(`/pharmacy/orders/${id}`);
  const [changed, setChanged] = useState(null);
  const [flash, setFlash] = useState(location.state?.flash ?? null);
  // A purchase that was saved but could not be counted against this order (it was cancelled or closed at that moment)
  const [warning, setWarning] = useState(location.state?.warning ?? null);
  const [dialog, setDialog] = useState(null); // 'cancel' | 'close'
  const [printing, setPrinting] = useState(false);
  const sending = useSend((out) => {
    setChanged(out.order);
    setFlash(`Order ${out.order.number} is marked as sent.`);
  });
  const o = (changed?.id === id ? changed : null) ?? res.data?.order; // what an action here answered, else what was loaded
  if (res.error && !o) {
    return (
      <>
        <PharmacyHeader title="Purchase order" crumb="Orders" buying />
        <div className="pf-content">
          <Alert type="error">{res.error}</Alert>
        </div>
      </>
    );
  }
  if (!o) {
    return (
      <>
        <PharmacyHeader title="Purchase order" crumb="Orders" buying />
        <div className="pf-content">
          <p className="muted" aria-busy="true">
            Loading the order…
          </p>
        </div>
      </>
    );
  }
  const done = (message) => (out) => {
    setChanged(out.order);
    setDialog(null);
    setFlash(message);
  };
  const primary = o.can.send ? 'send' : o.can.receive ? 'receive' : null;
  return (
    <>
      <PharmacyHeader
        title={`Order ${o.number}`}
        crumb={o.number}
        buying
        badges={<OrderStatus order={o} />}
        subtitle={[o.supplier?.name, `made ${formatDateTime(o.date)}`, `by ${o.byName}`].filter(Boolean).join(' · ')}
        actions={
          <>
            {o.can.edit && (
              <button type="button" className="btn btn-secondary" onClick={() => navigate(`/pharmacy/orders/${o.id}/edit`)}>
                <Pencil aria-hidden="true" /> Change
              </button>
            )}
            <button type="button" className={`btn ${primary ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setPrinting(true)}>
              <Printer aria-hidden="true" /> Print
            </button>
            {o.can.send && (
              <button type="button" className="btn btn-primary" disabled={sending.busy} onClick={() => sending.send(`/pharmacy/orders/${o.id}/send`, {})}>
                <Send aria-hidden="true" /> {sending.busy ? 'Saving…' : 'Mark as sent'}
              </button>
            )}
            {!o.can.send && o.can.receive && (
              <button type="button" className="btn btn-primary" onClick={() => navigate(`/pharmacy/purchases/new?order=${o.id}`)}>
                <PackagePlus aria-hidden="true" /> {o.status === 'part_received' ? 'Receive the rest' : 'Receive'}
              </button>
            )}
          </>
        }
      />
      <div className="pf-content bill-page">
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        <Alert type="warning" onClose={() => setWarning(null)}>
          {warning}
        </Alert>
        <Alert type="error" onClose={() => sending.setError(null)}>
          {sending.error}
        </Alert>
        <section className="card bill-section">
          <h2>The order</h2>
          <dl className="ph-order-facts">
            <dt>Supplier</dt>
            <dd>
              {o.supplier?.name}
              {o.supplier?.phone ? ` · ${o.supplier.phone}` : ''}
            </dd>
            {o.note && (
              <>
                <dt>Note</dt>
                <dd>{o.note}</dd>
              </>
            )}
            {o.sent && (
              <>
                <dt>Sent</dt>
                <dd>
                  {formatDateTime(o.sent.at)} · {o.sent.byName}
                </dd>
              </>
            )}
            {o.cancelled && (
              <>
                <dt>Cancelled</dt>
                <dd>
                  {formatDateTime(o.cancelled.at)} · {o.cancelled.byName} – {o.cancelled.reason}
                </dd>
              </>
            )}
            {o.closed && (
              <>
                <dt>Closed</dt>
                <dd>
                  {formatDateTime(o.closed.at)} · {o.closed.byName} – {o.closed.reason}
                </dd>
              </>
            )}
          </dl>
          <p className="hint">{o.closed ? 'Closed: nothing more will come on this order.' : NEXT[o.status]}</p>
          {(o.can.cancel || o.can.close) && (
            <div className="row">
              {o.can.close && (
                <button type="button" className="btn btn-link" onClick={() => setDialog('close')}>
                  Nothing more will come
                </button>
              )}
              {o.can.cancel && (
                <button type="button" className="btn btn-link" onClick={() => setDialog('cancel')}>
                  Cancel the order
                </button>
              )}
            </div>
          )}
        </section>

        <section className="card bill-section">
          <h2>Medicines</h2>
          <table className="bill-report">
            <thead>
              <tr>
                <th scope="col">Medicine</th>
                <th scope="col" className="num">
                  Ordered
                </th>
                <th scope="col" className="num">
                  Received
                </th>
                <th scope="col" className="num">
                  Still to come
                </th>
              </tr>
            </thead>
            <tbody>
              {o.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.medicine ? medicineLabel(l.medicine) : l.name} <ScheduleMark schedule={l.medicine?.schedule} />
                  </td>
                  <td className="num">{l.qty}</td>
                  <td className="num">{l.receivedQty}</td>
                  <td className="num">{o.status === 'cancelled' || o.closed ? '–' : l.outstanding}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {o.purchases?.length > 0 && (
          <section className="card bill-section">
            <h2>Received on</h2>
            <ul className="appt-lines">
              {o.purchases.map((p) => (
                <li key={p.id}>
                  Purchase {p.number} · invoice {p.invoiceNo} · {dayLabel(p.invoiceDate)}
                  {p.status === 'cancelled' && <span className="muted"> · cancelled, not counted</span>}
                </li>
              ))}
            </ul>
            <p className="hint">
              The stock of each delivery is under <Link to="/pharmacy/purchases">Purchases</Link>.
            </p>
          </section>
        )}
      </div>
      {dialog === 'cancel' && (
        <ReasonDialog
          id="po-cancel"
          title={`Cancel order ${o.number}`}
          intro="Only while nothing has been received against it. The order stays on the list as cancelled."
          label="Reason"
          danger
          confirm="Cancel the order"
          keep="Keep it"
          path={`/pharmacy/orders/${o.id}/cancel`}
          onClose={() => setDialog(null)}
          onDone={done(`Order ${o.number} cancelled.`)}
        />
      )}
      {dialog === 'close' && (
        <ReasonDialog
          id="po-close"
          title={`Close order ${o.number}`}
          intro="Close it when the supplier will send nothing more. What has arrived stays in the stock; nothing more can be received against this order."
          label="Why nothing more will come"
          confirm="Close the order"
          keep="Keep it open"
          path={`/pharmacy/orders/${o.id}/close`}
          onClose={() => setDialog(null)}
          onDone={done(`Order ${o.number} closed.`)}
        />
      )}
      {printing && res.data && <OrderPrint order={o} settings={res.data.settings} onClose={() => setPrinting(false)} />}
    </>
  );
}
