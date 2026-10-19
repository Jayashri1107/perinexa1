import { useState } from 'react';
import { CircleCheck, PackagePlus, Pencil, Plus, Scale, TriangleAlert } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { DataTable, usePagedRows } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { HOSPITAL_LAB } from '../../platform/modules.js';
import { Alert, Field, StatusPill, formatDate } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { rupees } from '../billing/billingFormat.js';
import { Modal } from '../billing/billingUi.jsx';

// Lab → Stock (Lab version 2 – docs/LAB_V2_PLAN.md): reagents and consumables with what each test uses, batches
// received (expiry, cost), counts and write-offs; low stock and batches expiring soon. A reported test takes its stock
// by itself (earliest expiry first). The Cost per test tab: by month, tests done, income, reagent cost and margin.
// Laid out as tables with pages; adding, receiving, counting and writing off in dialogs (owner, 19 Oct 2026).

const EMPTY_ITEM = { name: '', kind: 'reagent', unit: 'test', reorderLevel: '0', perTest: [] };
const KIND_WORDS = { reagent: 'Reagent', consumable: 'Consumable', control: 'Control material' };
const thisMonth = () => new Date().toISOString().slice(0, 7);

function ItemDialog({ item, tests, onSaved, onClose }) {
  const [v, setV] = useState(item ? { ...item, reorderLevel: String(item.reorderLevel), perTest: item.perTest.map((u) => ({ ...u, qty: String(u.qty) })) } : EMPTY_ITEM);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const setUse = (i, k, val) => setV({ ...v, perTest: v.perTest.map((u, j) => (j === i ? { ...u, [k]: val } : u)) });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: v.name, kind: v.kind, unit: v.unit, reorderLevel: Number(v.reorderLevel) || 0, perTest: v.perTest.filter((u) => u.testKey).map((u) => ({ testKey: u.testKey, qty: Number(u.qty) || 0 })), active: v.active ?? true };
      const res = await api(item ? `/lab-stock/items/${item.id}` : '/lab-stock/items', { method: item ? 'PUT' : 'POST', body });
      onSaved(res.items, item ? `${v.name} saved.` : `${v.name} added.`);
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setBusy(false);
    }
  };
  return (
    <Modal id="si" title={item ? `Change ${item.name}` : 'Add a reagent or consumable'} wide onClose={onClose}>
      <form onSubmit={save} noValidate>
        <Alert type="error">{error}</Alert>
        <div className="form-grid">
          <Field label="Name" id="si-name" error={fields.name}>
            <input id="si-name" maxLength={120} value={v.name} onChange={set('name')} autoFocus />
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
          {v.perTest.length > 0 && (
            <div className="stock-uses">
              {v.perTest.map((u, i) => (
                <div key={i} className="stock-use">
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
            </div>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setV({ ...v, perTest: [...v.perTest, { testKey: '', qty: '1' }] })}>
            <Plus aria-hidden="true" /> Add a test that uses it
          </button>
        </fieldset>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy || v.name.trim().length < 2}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn btn-link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ReceiveDialog({ item, onSaved, onClose }) {
  const [v, setV] = useState({ batchNo: '', expiresOn: '', qty: '', cost: '', supplier: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api(`/lab-stock/items/${item.id}/batches`, { method: 'POST', body: { batchNo: v.batchNo, expiresOn: v.expiresOn || null, qty: Number(v.qty), unitCostPaise: Math.round(Number(v.cost || 0) * 100), supplier: v.supplier } });
      onSaved(res.items, `${item.name}: batch ${v.batchNo} received.`);
    } catch (err) {
      setError(Object.values(err.fields ?? {})[0] ?? err.message);
      setBusy(false);
    }
  };
  return (
    <Modal id="sb" title={`Receive ${item.name}`} wide onClose={onClose}>
      <form onSubmit={save} noValidate>
        <Alert type="error">{error}</Alert>
        <div className="form-grid">
          <Field label="Batch number" id="sb-no">
            <input id="sb-no" maxLength={60} value={v.batchNo} onChange={set('batchNo')} autoFocus />
          </Field>
          <Field label="Expires on" id="sb-exp">
            <input id="sb-exp" type="date" value={v.expiresOn} onChange={set('expiresOn')} />
          </Field>
          <Field label={`Quantity (${item.unit})`} id="sb-qty">
            <input id="sb-qty" inputMode="decimal" value={v.qty} onChange={set('qty')} />
          </Field>
          <Field label={`Cost of one ${item.unit} (₹)`} id="sb-cost">
            <input id="sb-cost" inputMode="decimal" value={v.cost} onChange={set('cost')} />
          </Field>
          <Field label="Supplier" id="sb-sup">
            <input id="sb-sup" maxLength={120} value={v.supplier} onChange={set('supplier')} />
          </Field>
        </div>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy || !v.batchNo.trim() || !(Number(v.qty) > 0)}>
            <PackagePlus aria-hidden="true" /> {busy ? 'Saving…' : 'Receive the batch'}
          </button>
          <button type="button" className="btn btn-link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AdjustDialog({ batch, onSaved, onClose }) {
  const [v, setV] = useState({ kind: 'written_off', qty: '', reason: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api(`/lab-stock/batches/${batch.id}/adjust`, { method: 'POST', body: { kind: v.kind, qty: Number(v.qty), reason: v.reason } });
      onSaved(res.items, `${batch.itemName}, batch ${batch.batchNo}: ${v.kind === 'written_off' ? 'written off' : 'count saved'}.`);
    } catch (err) {
      setError(Object.values(err.fields ?? {})[0] ?? err.message);
      setBusy(false);
    }
  };
  return (
    <Modal id="sa" title={`Count or write off – ${batch.itemName}, batch ${batch.batchNo}`} onClose={onClose}>
      <p>
        In stock now: <strong className="tabular">{`${batch.qty} ${batch.unit}`}</strong>.
      </p>
      <form onSubmit={save} noValidate>
        <Alert type="error">{error}</Alert>
        <div className="form-grid">
          <Field label="What happened" id="sa-kind">
            <select id="sa-kind" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
              <option value="written_off">Write off (broken, expired, spilt)</option>
              <option value="adjusted">Counted – set the stock to</option>
            </select>
          </Field>
          <Field label={v.kind === 'written_off' ? `Quantity written off (${batch.unit})` : `Counted (${batch.unit})`} id="sa-qty">
            <input id="sa-qty" inputMode="decimal" className="tabular" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} autoFocus />
          </Field>
        </div>
        <Field label="Reason" id="sa-reason">
          <input id="sa-reason" maxLength={200} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy || v.qty === '' || v.reason.trim().length < 3}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn btn-link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Costs() {
  const [month, setMonth] = useState(thisMonth());
  const res = useFetch('/lab-stock/costs', { month });
  const d = res.data;
  const { shown, pager } = usePagedRows(d?.rows, { label: 'tests' });
  const money = (k) => (r) => <span className="tabular">{rupees(r[k])}</span>;
  const columns = [
    { key: 'name', header: 'Test', render: (r) => <strong>{r.name}</strong> },
    { key: 'count', header: 'Done', align: 'right', render: (r) => <span className="tabular">{r.count}</span> },
    { key: 'price', header: 'Price', align: 'right', render: money('pricePaise') },
    { key: 'cost1', header: 'Reagent cost of one', align: 'right', render: money('costPerTestPaise') },
    { key: 'income', header: 'Income', align: 'right', render: money('incomePaise') },
    { key: 'reagents', header: 'Reagents used', align: 'right', render: money('reagentCostPaise') },
    { key: 'margin', header: 'Margin', align: 'right', render: money('marginPaise') },
  ];
  return (
    <>
      <Alert type="error">{res.error}</Alert>
      {d && (
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
      )}
      <DataTable
        caption="Cost per test"
        columns={columns}
        rows={shown}
        rowKey="key"
        loading={res.loading}
        emptyText="No tests reported in this month."
        toolbar={
          <label className="lab-filter" htmlFor="cost-month">
            <span>Month</span>
            <input id="cost-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
        }
        footer={pager}
      />
      <p className="hint">Income uses today's price list; reagent cost is what the reported tests took from the stock.</p>
    </>
  );
}

export function LabStockPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'costs' ? 'costs' : 'stock';
  const res = useFetch('/lab-stock');
  const [items, setItems] = useState(null);
  const [dialog, setDialog] = useState(null); // 'new' | { edit } | { receive } | { adjust }
  const [notice, setNotice] = useState(null);
  const [q, setQ] = useState('');
  const shown = items ?? res.data?.items;
  const canEdit = Boolean(res.data?.canEdit);
  const saved = (list, message) => {
    setItems(list);
    setDialog(null);
    setNotice(message ?? null);
  };
  const words = q.trim().toLowerCase();
  const filtered = shown?.filter((i) => !words || i.name.toLowerCase().includes(words));
  const batches = filtered?.flatMap((i) => i.batches.map((b) => ({ ...b, itemName: i.name, unit: i.unit })));
  const itemsPage = usePagedRows(filtered, { label: 'items' });
  const batchPage = usePagedRows(batches, { label: 'batches' });
  const low = (shown ?? []).filter((i) => i.low);
  const expiring = (shown ?? []).flatMap((i) => i.batches.filter((b) => b.expiring || b.expired).map((b) => ({ ...b, item: i.name })));

  const itemColumns = [
    {
      key: 'name',
      header: 'Item',
      render: (i) => (
        <>
          <strong>{i.name}</strong>
          <span className="muted dt-sub">{KIND_WORDS[i.kind] ?? i.kind}</span>
        </>
      ),
    },
    { key: 'stock', header: 'In stock', align: 'right', render: (i) => <span className="tabular">{`${i.stock} ${i.unit}`}</span> },
    { key: 'reorder', header: 'Reorder at', align: 'right', render: (i) => <span className="tabular">{i.reorderLevel}</span> },
    { key: 'used', header: 'Used by', render: (i) => (i.perTest.length ? `${i.perTest.length} ${i.perTest.length === 1 ? 'test' : 'tests'}` : '–') },
    { key: 'batches', header: 'Batches', align: 'right', render: (i) => <span className="tabular">{i.batches.length}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (i) =>
        i.low ? (
          <StatusPill tone="watch" icon={TriangleAlert}>
            Low
          </StatusPill>
        ) : (
          <StatusPill tone="stable" icon={CircleCheck}>
            Enough
          </StatusPill>
        ),
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right',
            render: (i) => (
              <span className="dt-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog({ receive: i })}>
                  <PackagePlus aria-hidden="true" /> Receive
                </button>
                <button type="button" className="btn btn-link btn-sm" onClick={() => setDialog({ edit: i })} aria-label={`Change ${i.name}`}>
                  <Pencil aria-hidden="true" /> Change
                </button>
              </span>
            ),
          },
        ]
      : []),
  ];
  const batchColumns = [
    { key: 'item', header: 'Item', render: (b) => <strong>{b.itemName}</strong> },
    { key: 'batch', header: 'Batch', render: (b) => <span className="tabular">{b.batchNo}</span> },
    { key: 'qty', header: 'In stock', align: 'right', render: (b) => <span className="tabular">{`${b.qty} ${b.unit}`}</span> },
    { key: 'expires', header: 'Expires', render: (b) => (b.expiresOn ? formatDate(b.expiresOn) : '–') },
    { key: 'cost', header: 'Cost each', align: 'right', render: (b) => <span className="tabular">{b.unitCostPaise ? rupees(b.unitCostPaise) : '–'}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (b) =>
        b.expired || b.expiring ? (
          <StatusPill tone={b.expired ? 'high' : 'watch'} icon={TriangleAlert}>
            {b.expired ? 'Expired' : 'Expiring soon'}
          </StatusPill>
        ) : (
          <StatusPill tone="stable" icon={CircleCheck}>
            In date
          </StatusPill>
        ),
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right',
            render: (b) => (
              <button type="button" className="btn btn-link btn-sm" onClick={() => setDialog({ adjust: b })}>
                <Scale aria-hidden="true" /> Count or write off
              </button>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        tabs={HOSPITAL_LAB.tabs}
        title="Lab stock"
        documentTitle="Lab stock"
        help="Reagents and consumables. A reported test takes its stock by itself, earliest expiry first."
        actions={
          canEdit &&
          tab === 'stock' && (
            <button type="button" className="btn btn-primary" onClick={() => setDialog('new')}>
              <Plus aria-hidden="true" /> Add a reagent or consumable
            </button>
          )
        }
      />
      <div className="pf-content stock-page lab-tables">
        <div className="segmented" role="group" aria-label="Stock or costs">
          <button type="button" aria-pressed={tab === 'stock'} onClick={() => setParams({}, { replace: true })}>
            Stock
          </button>
          <button type="button" aria-pressed={tab === 'costs'} onClick={() => setParams({ tab: 'costs' }, { replace: true })}>
            Cost per test
          </button>
        </div>
        <Alert type="error">{res.error}</Alert>
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
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
            <DataTable
              caption="Stock items"
              columns={itemColumns}
              rows={itemsPage.shown}
              loading={res.loading}
              emptyText={words ? 'No item matches.' : 'No stock items yet.'}
              toolbar={
                <label className="lab-filter" htmlFor="stock-find">
                  <span>Find an item</span>
                  <input id="stock-find" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
                </label>
              }
              footer={itemsPage.pager}
            />
            <h2 className="stock-subhead">Batches</h2>
            <DataTable caption="Batches" columns={batchColumns} rows={batchPage.shown} loading={res.loading} emptyText="No batches in stock." footer={batchPage.pager} />
          </>
        )}
      </div>
      {dialog === 'new' && <ItemDialog item={null} tests={res.data?.tests ?? []} onSaved={saved} onClose={() => setDialog(null)} />}
      {dialog?.edit && <ItemDialog item={dialog.edit} tests={res.data?.tests ?? []} onSaved={saved} onClose={() => setDialog(null)} />}
      {dialog?.receive && <ReceiveDialog item={dialog.receive} onSaved={saved} onClose={() => setDialog(null)} />}
      {dialog?.adjust && <AdjustDialog batch={dialog.adjust} onSaved={saved} onClose={() => setDialog(null)} />}
    </>
  );
}
