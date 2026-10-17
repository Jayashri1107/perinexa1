import { useState } from 'react';
import { PackagePlus, Plus, TriangleAlert } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { HOSPITAL_LAB } from '../../platform/modules.js';
import { Alert, Field, StatusPill, formatDate } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { rupees } from '../billing/billingFormat.js';

// Lab → Stock (Lab version 2 – docs/LAB_V2_PLAN.md): reagents and consumables with what each test uses, batches
// received (expiry, cost), counts and write-offs; low stock and batches expiring soon. A reported test takes its stock
// by itself (earliest expiry first). The Cost per test tab: by month, tests done, income, reagent cost and margin.

const EMPTY_ITEM = { name: '', kind: 'reagent', unit: 'test', reorderLevel: '0', perTest: [] };
const thisMonth = () => new Date().toISOString().slice(0, 7);

function ItemForm({ item, tests, onSaved, onCancel }) {
  const [v, setV] = useState(item ? { ...item, reorderLevel: String(item.reorderLevel), perTest: item.perTest.map((u) => ({ ...u, qty: String(u.qty) })) } : EMPTY_ITEM);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const setUse = (i, k, val) => setV({ ...v, perTest: v.perTest.map((u, j) => (j === i ? { ...u, [k]: val } : u)) });
  const save = async (e) => {
    e.preventDefault();
    try {
      const body = { name: v.name, kind: v.kind, unit: v.unit, reorderLevel: Number(v.reorderLevel) || 0, perTest: v.perTest.filter((u) => u.testKey).map((u) => ({ testKey: u.testKey, qty: Number(u.qty) || 0 })), active: v.active ?? true };
      const res = await api(item ? `/lab-stock/items/${item.id}` : '/lab-stock/items', { method: item ? 'PUT' : 'POST', body });
      onSaved(res.items);
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    }
  };
  return (
    <form className="card" onSubmit={save} noValidate>
      <h2>{item ? `Change ${item.name}` : 'Add a reagent or consumable'}</h2>
      <Alert type="error">{error}</Alert>
      <div className="form-grid">
        <Field label="Name" id="si-name" error={fields.name}>
          <input id="si-name" maxLength={120} value={v.name} onChange={set('name')} />
        </Field>
        <Field label="Kind" id="si-kind">
          <select id="si-kind" value={v.kind} onChange={set('kind')}>
            <option value="reagent">Reagent</option>
            <option value="consumable">Consumable</option>
            <option value="control">Control material</option>
          </select>
        </Field>
        <Field label="Unit" id="si-unit" error={fields.unit} hint="One quantity: test, mL, piece …">
          <input id="si-unit" maxLength={20} value={v.unit} onChange={set('unit')} />
        </Field>
        <Field label="Reorder when at or below" id="si-reorder">
          <input id="si-reorder" inputMode="decimal" value={v.reorderLevel} onChange={set('reorderLevel')} />
        </Field>
      </div>
      <fieldset className="fieldset">
        <legend>Used by each test</legend>
        {fields.perTest && <p className="field-error">{fields.perTest}</p>}
        {v.perTest.map((u, i) => (
          <div key={i} className="row">
            <select aria-label="Test" value={u.testKey} onChange={(e) => setUse(i, 'testKey', e.target.value)}>
              <option value="">Choose a test…</option>
              {tests.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </select>
            <input aria-label="Quantity per test" inputMode="decimal" className="tabular" value={u.qty} onChange={(e) => setUse(i, 'qty', e.target.value)} />
            <span className="muted">{v.unit} per test</span>
            <button type="button" className="btn btn-link btn-sm" onClick={() => setV({ ...v, perTest: v.perTest.filter((_, j) => j !== i) })}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-link btn-sm" onClick={() => setV({ ...v, perTest: [...v.perTest, { testKey: '', qty: '1' }] })}>
          <Plus aria-hidden="true" /> Add a test that uses it
        </button>
      </fieldset>
      <div className="row">
        <button type="submit" className="btn btn-primary">
          Save
        </button>
        <button type="button" className="btn btn-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function BatchForm({ item, onSaved }) {
  const [v, setV] = useState({ batchNo: '', expiresOn: '', qty: '', cost: '', supplier: '' });
  const [error, setError] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    try {
      const res = await api(`/lab-stock/items/${item.id}/batches`, { method: 'POST', body: { batchNo: v.batchNo, expiresOn: v.expiresOn || null, qty: Number(v.qty), unitCostPaise: Math.round(Number(v.cost || 0) * 100), supplier: v.supplier } });
      onSaved(res.items);
    } catch (err) {
      setError(Object.values(err.fields ?? {})[0] ?? err.message);
    }
  };
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return (
    <form className="stock-batch" onSubmit={save} noValidate>
      <Alert type="error">{error}</Alert>
      <div className="form-grid">
        <Field label="Batch number" id={`sb-no-${item.id}`}>
          <input id={`sb-no-${item.id}`} maxLength={60} value={v.batchNo} onChange={set('batchNo')} />
        </Field>
        <Field label="Expires on" id={`sb-exp-${item.id}`}>
          <input id={`sb-exp-${item.id}`} type="date" value={v.expiresOn} onChange={set('expiresOn')} />
        </Field>
        <Field label={`Quantity (${item.unit})`} id={`sb-qty-${item.id}`}>
          <input id={`sb-qty-${item.id}`} inputMode="decimal" value={v.qty} onChange={set('qty')} />
        </Field>
        <Field label={`Cost of one ${item.unit} (₹)`} id={`sb-cost-${item.id}`}>
          <input id={`sb-cost-${item.id}`} inputMode="decimal" value={v.cost} onChange={set('cost')} />
        </Field>
        <Field label="Supplier" id={`sb-sup-${item.id}`}>
          <input id={`sb-sup-${item.id}`} maxLength={120} value={v.supplier} onChange={set('supplier')} />
        </Field>
      </div>
      <button type="submit" className="btn btn-secondary btn-sm">
        <PackagePlus aria-hidden="true" /> Receive the batch
      </button>
    </form>
  );
}

function AdjustForm({ batch, unit, onSaved }) {
  const [v, setV] = useState({ kind: 'written_off', qty: '', reason: '' });
  const [error, setError] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    try {
      const res = await api(`/lab-stock/batches/${batch.id}/adjust`, { method: 'POST', body: { kind: v.kind, qty: Number(v.qty), reason: v.reason } });
      onSaved(res.items);
    } catch (err) {
      setError(Object.values(err.fields ?? {})[0] ?? err.message);
    }
  };
  return (
    <form className="row stock-adjust" onSubmit={save} noValidate>
      <select aria-label="Kind of change" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
        <option value="written_off">Write off</option>
        <option value="adjusted">Counted – set to</option>
      </select>
      <input aria-label={`Quantity (${unit})`} inputMode="decimal" className="tabular" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} />
      <input aria-label="Reason" placeholder="Reason" maxLength={200} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      <button type="submit" className="btn btn-link btn-sm">
        Save
      </button>
      {error && <span className="field-error">{error}</span>}
    </form>
  );
}

function Costs() {
  const [month, setMonth] = useState(thisMonth());
  const res = useFetch('/lab-stock/costs', { month });
  const d = res.data;
  return (
    <section className="card" aria-labelledby="cost-title">
      <h2 id="cost-title">Cost per test</h2>
      <label className="lab-filter" htmlFor="cost-month">
        <span>Month</span>
        <input id="cost-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </label>
      <Alert type="error">{res.error}</Alert>
      {d && (
        <>
          <dl className="lab-counts">
            <div>
              <dt>Tests done</dt>
              <dd className="tabular">{d.totals.count}</dd>
            </div>
            <div>
              <dt>Income (price list)</dt>
              <dd className="tabular">{rupees(d.totals.incomePaise)}</dd>
            </div>
            <div>
              <dt>Reagents used</dt>
              <dd className="tabular">{rupees(d.totals.reagentCostPaise)}</dd>
            </div>
            <div>
              <dt>Written off</dt>
              <dd className="tabular">{rupees(d.totals.writtenOffPaise)}</dd>
            </div>
            <div>
              <dt>Margin</dt>
              <dd className="tabular">{rupees(d.totals.marginPaise)}</dd>
            </div>
          </dl>
          <table className="lab-values">
            <thead>
              <tr>
                <th scope="col">Test</th>
                <th scope="col">Done</th>
                <th scope="col">Price · reagent cost of one</th>
                <th scope="col">Income · reagents · margin</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">{r.name}</th>
                  <td className="tabular">{r.count}</td>
                  <td className="tabular">
                    {rupees(r.pricePaise)} · {rupees(r.costPerTestPaise)}
                  </td>
                  <td className="tabular">
                    {rupees(r.incomePaise)} · {rupees(r.reagentCostPaise)} · {rupees(r.marginPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">Income uses today's price list; reagent cost is what the reported tests took from the stock.</p>
        </>
      )}
    </section>
  );
}

export function LabStockPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'costs' ? 'costs' : 'stock';
  const res = useFetch('/lab-stock');
  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(null); // 'new' or an item
  const [receiving, setReceiving] = useState(null);
  const shown = items ?? res.data?.items;
  const saved = (list) => {
    setItems(list);
    setEditing(null);
    setReceiving(null);
  };
  const low = (shown ?? []).filter((i) => i.low);
  const expiring = (shown ?? []).flatMap((i) => i.batches.filter((b) => b.expiring || b.expired).map((b) => ({ ...b, item: i.name })));
  return (
    <>
      <PageHeader tabs={HOSPITAL_LAB.tabs} title="Lab stock" documentTitle="Lab stock" help="Reagents and consumables. A reported test takes its stock by itself, earliest expiry first." />
      <div className="pf-content">
        <div className="segmented" aria-label="Stock or costs">
          <button type="button" aria-pressed={tab === 'stock'} onClick={() => setParams({}, { replace: true })}>
            Stock
          </button>
          <button type="button" aria-pressed={tab === 'costs'} onClick={() => setParams({ tab: 'costs' }, { replace: true })}>
            Cost per test
          </button>
        </div>
        <Alert type="error">{res.error}</Alert>
        {tab === 'costs' ? (
          <Costs />
        ) : (
          <>
            {(low.length > 0 || expiring.length > 0) && (
              <Alert type="warning">
                {low.length > 0 && `Low stock: ${low.map((i) => `${i.name} (${i.stock} ${i.unit})`).join(', ')}. `}
                {expiring.length > 0 && `Expiring within ${res.data?.expiringDays ?? 30} days or expired: ${expiring.map((b) => `${b.item} batch ${b.batchNo} (${formatDate(b.expiresOn)})`).join(', ')}.`}
              </Alert>
            )}
            {res.data?.canEdit && !editing && (
              <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
                <Plus aria-hidden="true" /> Add a reagent or consumable
              </button>
            )}
            {editing && <ItemForm item={editing === 'new' ? null : editing} tests={res.data?.tests ?? []} onSaved={saved} onCancel={() => setEditing(null)} />}
            <section className="card">
              {!shown ? (
                <p className="muted">Loading…</p>
              ) : shown.length === 0 ? (
                <p className="muted">No stock items yet.</p>
              ) : (
                <ul className="wl-list">
                  {shown.map((i) => (
                    <li key={i.id}>
                      <div className="wl-row-head">
                        <span className="wl-who">
                          <strong>{i.name}</strong>
                          <span className="muted">
                            {i.stock} {i.unit} in stock · reorder at {i.reorderLevel}
                            {i.perTest.length ? ` · used by ${i.perTest.length} ${i.perTest.length === 1 ? 'test' : 'tests'}` : ''}
                          </span>
                        </span>
                        <span className="wl-counts">
                          {i.low && (
                            <StatusPill tone="watch" icon={TriangleAlert}>
                              Low
                            </StatusPill>
                          )}
                          {res.data?.canEdit && (
                            <>
                              <button type="button" className="btn btn-link btn-sm" onClick={() => setReceiving(receiving === i.id ? null : i.id)}>
                                Receive
                              </button>
                              <button type="button" className="btn btn-link btn-sm" onClick={() => setEditing(i)}>
                                Change
                              </button>
                            </>
                          )}
                        </span>
                      </div>
                      {receiving === i.id && <BatchForm item={i} onSaved={saved} />}
                      {i.batches.map((b) => (
                        <div key={b.id} className="stock-batch-row">
                          <span className="tabular">
                            Batch {b.batchNo} · {b.qty} {i.unit}
                            {b.expiresOn ? ` · expires ${formatDate(b.expiresOn)}` : ''}
                            {b.unitCostPaise ? ` · ${rupees(b.unitCostPaise)} each` : ''}
                          </span>
                          {(b.expired || b.expiring) && (
                            <StatusPill tone={b.expired ? 'high' : 'watch'} icon={TriangleAlert}>
                              {b.expired ? 'Expired' : 'Expiring soon'}
                            </StatusPill>
                          )}
                          {res.data?.canEdit && <AdjustForm batch={b} unit={i.unit} onSaved={saved} />}
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
