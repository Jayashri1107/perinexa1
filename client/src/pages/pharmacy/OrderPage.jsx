// One purchase order: a draft is changed here (medicines and quantities, "Suggest from low stock"), then sent; a sent
// order is received by recording the supplier's invoice against it; it can be cancelled while nothing has come, or
// closed when the rest will not come.
import { ArrowLeft, PackagePlus, Sparkles, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { purchaseOrdersApi, suppliersApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { useOptions } from '../../hooks/useOptions.js';
import { formatDateTime } from '../../utils/format.js';
import { MedicineSearch } from './MedicineSearch.jsx';
import { orderLook } from './pharmacyExtrasFormat.js';

function ReasonDialog({ title, action, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      onDone(await action(reason));
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <Modal title={title} onClose={onClose} size="sm">
      <form onSubmit={submit}>
        <Alert type="error">{error}</Alert>
        <div className="form-field">
          <label htmlFor="order-reason">Why<span className="required" aria-hidden> *</span></label>
          <input id="order-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="modal-foot inline">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Back</button>
          <button type="submit" className="btn btn-primary" disabled={reason.trim().length < 3}>{title}</button>
        </div>
      </form>
    </Modal>
  );
}

export function OrderPage() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const suppliers = useOptions(suppliersApi.options);
  const [order, setOrder] = useState(null);
  const [draft, setDraft] = useState(isNew ? { supplierId: '', note: '', lines: [] } : null);
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null); // 'cancel' | 'close'

  const load = useCallback(() => {
    if (isNew) return;
    purchaseOrdersApi
      .get(id)
      .then(({ order: o }) => {
        setOrder(o);
        setDraft({ supplierId: o.supplierId, note: o.note, lines: o.lines.map((l) => ({ medicineId: l.medicineId, medicineName: l.medicineName, qty: l.qty })) });
      })
      .catch((err) => setError(err.message));
  }, [id, isNew]);
  useEffect(load, [load]);

  if (error && !draft) return <Alert type="error">{error}</Alert>;
  if (!draft) return <Loader />;
  const editable = isNew || order?.can.edit;

  const addLine = (m) =>
    setDraft((d) => (d.lines.some((l) => l.medicineId === m.id) ? d : { ...d, lines: [...d.lines, { medicineId: m.id, medicineName: `${m.name} ${m.strength ?? ''}`.trim(), qty: '' }] }));
  const setQty = (i, qty) => setDraft((d) => ({ ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, qty } : l)) }));
  const suggest = async () => {
    const { items } = await purchaseOrdersApi.suggest();
    setDraft((d) => {
      const have = new Set(d.lines.map((l) => l.medicineId));
      return { ...d, lines: [...d.lines, ...items.filter((s) => !have.has(s.medicineId)).map((s) => ({ medicineId: s.medicineId, medicineName: s.medicineName, qty: s.qty, hint: `${s.usable} in stock · reorder at ${s.reorderLevel}${s.onOrder ? ` · ${s.onOrder} already on order` : ''}` }))] };
    });
  };

  const run = async (action) => {
    setBusy(true);
    setError('');
    setFields({});
    try {
      const { order: o } = await action();
      if (isNew) navigate(`/hospital/pharmacy/orders/${o.id}`, { replace: true });
      else {
        setOrder(o);
        setDraft({ supplierId: o.supplierId, note: o.note, lines: o.lines.map((l) => ({ medicineId: l.medicineId, medicineName: l.medicineName, qty: l.qty })) });
      }
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  };
  const body = () => ({ supplierId: draft.supplierId, note: draft.note, lines: draft.lines.map((l) => ({ medicineId: l.medicineId, qty: Number(l.qty) })) });
  const save = () => run(() => (isNew ? purchaseOrdersApi.create(body()) : purchaseOrdersApi.update(order.id, body())));
  const lineError = (i) => Object.entries(fields).filter(([k]) => k.startsWith(`lines.${i}.`)).map(([, m]) => m).join(' ');

  return (
    <>
      <PageHeader
        back={<Link to="/hospital/pharmacy/orders" className="back-link"><ArrowLeft size={16} aria-hidden /> Orders</Link>}
        title={isNew ? 'New purchase order' : `${order.orderNumber} · ${order.supplierName}`}
        subtitle={order && `Made ${formatDateTime(order.created.at)} by ${order.created.byName}${order.sent ? ` · sent ${formatDateTime(order.sent.at)}` : ''}`}
        actions={
          <>
            {order && <StateBadge look={orderLook(order)} />}
            {editable && <button type="button" className={isNew ? 'btn btn-primary' : 'btn btn-ghost'} disabled={busy} onClick={save}>{isNew ? 'Save as draft' : 'Save changes'}</button>}
            {order?.can.send && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => purchaseOrdersApi.send(order.id))}>Mark as sent</button>}
            {order?.can.receive && (
              <Link className="btn btn-primary" to={`/hospital/pharmacy/purchases/new?order=${order.id}`}><PackagePlus size={16} aria-hidden /> Record the invoice</Link>
            )}
            {order?.can.close && <button type="button" className="btn btn-ghost" onClick={() => setDialog('close')}>Close – no more will come</button>}
            {order?.can.cancel && <button type="button" className="btn btn-link btn-danger-text" onClick={() => setDialog('cancel')}>Cancel order</button>}
          </>
        }
      />
      <Alert type="error">{error}</Alert>
      {order?.cancelled && <Alert type="info">Cancelled {formatDateTime(order.cancelled.at)} by {order.cancelled.byName}: {order.cancelled.reason}</Alert>}
      {order?.closed && <Alert type="info">Closed {formatDateTime(order.closed.at)} by {order.closed.byName}: {order.closed.reason}</Alert>}

      <section className="card">
        <div className="form-grid">
          <div className={`form-field width-half${fields.supplierId ? ' has-error' : ''}`}>
            <label htmlFor="order-supplier">Supplier</label>
            <select id="order-supplier" disabled={!editable} value={draft.supplierId} onChange={(e) => setDraft({ ...draft, supplierId: e.target.value })}>
              <option value="">Choose…</option>
              {suppliers.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {fields.supplierId && <span className="field-error">{fields.supplierId}</span>}
          </div>
          <div className="form-field width-half">
            <label htmlFor="order-note">Note to the supplier (optional)</label>
            <input id="order-note" disabled={!editable} value={draft.note} maxLength={500} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          </div>
        </div>
      </section>

      <section className="card top-gap">
        <div className="card-head">
          <h2>Medicines</h2>
          {editable && <button type="button" className="btn btn-ghost btn-sm" onClick={suggest}><Sparkles size={14} aria-hidden /> Suggest from low stock</button>}
        </div>
        {editable && <MedicineSearch onPick={addLine} showStock={false} label="Add a medicine from the list" />}
        <div className="table-wrap top-gap-sm">
          <table className="table compact-inputs">
            <thead>
              <tr><th>Medicine</th><th className="num">Ordered</th>{!editable && <th className="num">Received</th>}{!editable && <th className="num">Still to come</th>}{editable && <th />}</tr>
            </thead>
            <tbody>
              {draft.lines.length === 0 && <tr><td colSpan={4} className="empty">No medicines yet.</td></tr>}
              {draft.lines.map((l, i) => {
                const got = order?.lines.find((x) => x.medicineId === l.medicineId);
                return (
                  <tr key={l.medicineId}>
                    <td>{l.medicineName}{l.hint && <span className="muted block small">{l.hint}</span>}{lineError(i) && <span className="field-error block">{lineError(i)}</span>}</td>
                    <td className="num">{editable ? <input aria-label={`Quantity of ${l.medicineName}`} type="number" min="1" value={l.qty} onChange={(e) => setQty(i, e.target.value)} /> : l.qty}</td>
                    {!editable && <td className="num">{got?.receivedQty ?? 0}</td>}
                    {!editable && <td className="num">{got?.outstanding ?? 0}</td>}
                    {editable && <td className="actions"><button type="button" className="icon-btn" aria-label={`Remove ${l.medicineName}`} onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((_, j) => j !== i) }))}><Trash2 size={15} /></button></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {dialog === 'cancel' && <ReasonDialog title="Cancel order" action={(reason) => purchaseOrdersApi.cancel(order.id, reason)} onClose={() => setDialog(null)} onDone={({ order: o }) => { setOrder(o); setDialog(null); }} />}
      {dialog === 'close' && <ReasonDialog title="Close order" action={(reason) => purchaseOrdersApi.close(order.id, reason)} onClose={() => setDialog(null)} onDone={({ order: o }) => { setOrder(o); setDialog(null); }} />}
    </>
  );
}
