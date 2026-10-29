import { useState } from 'react';
import { ClipboardCheck, FileDown, FileUp, PackageX } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { CONTROLLED, MOVE_LABELS, expiryLabel, medicineLabel } from './pharmacyFormat.js';
import { BarcodeBox, Modal, PharmacyHeader, ScheduleMark, money, useSend } from './pharmacyUi.jsx';

// Pharmacy → Stock: every medicine with its usable and expired stock, value, nearest expiry and the low mark; one
// medicine's batches and its stock moves, with write-off and stock count (a witness for X and narcotic medicines).

export function StockPage() {
  const navigate = useNavigate();
  const res = useFetch('/pharmacy/stock');
  const [filter, setFilter] = useState('all');
  const [sheet, setSheet] = useState(false);
  const rows = (res.data?.medicines ?? []).filter((m) => (filter === 'low' ? m.low : filter === 'expiring' ? m.expiringSoon || m.expiredQty > 0 : true));
  return (
    <>
      <PharmacyHeader title="Stock" crumb="Stock" />
      <div className="pf-content bill-page">
        {res.error && <Alert type="error">{res.error}</Alert>}
        {res.data && (
          <div className="row-between">
            <p>
              Stock value: <strong>{money(res.data.totals.costValuePaise)}</strong> at purchase price · <strong>{money(res.data.totals.mrpValuePaise)}</strong> at MRP · {res.data.totals.low} below reorder level
            </p>
            <div className="row">
              <Link className="btn btn-secondary btn-sm" to="/pharmacy/stock/import">
                <FileUp aria-hidden="true" /> Import opening stock
              </Link>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSheet(true)}>
                <FileDown aria-hidden="true" /> Stock sheet
              </button>
            </div>
          </div>
        )}
        <DataTable
          caption="Stock"
          rows={res.data ? rows : null}
          loading={res.loading}
          onRowClick={(m) => navigate(`/pharmacy/stock/${m.id}`)}
          emptyText="No medicines here."
          toolbar={
            <div className="bill-toolbar ph-stock-toolbar">
              <div className="segmented" role="group" aria-label="Show">
                {[
                  ['all', 'All'],
                  ['low', 'Low stock'],
                  ['expiring', 'Expiring or expired'],
                ].map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                    {label}
                  </button>
                ))}
              </div>
              {/* A scanned pack opens that medicine's batches and stock moves */}
              <div className="ph-toolbar-scan">
                <BarcodeBox
                  onPick={(m) => {
                    navigate(`/pharmacy/stock/${m.id}`);
                    return `${m.name} found.`;
                  }}
                />
              </div>
            </div>
          }
          columns={[
            { key: 'name', header: 'Medicine', render: (m) => <span>{medicineLabel(m)} <ScheduleMark schedule={m.schedule} />{!m.active && <span className="muted"> (stopped)</span>}</span> },
            { key: 'qty', header: 'In stock', align: 'right', render: (m) => <span className="tabular">{m.qty} {m.unit}{m.qty === 1 ? '' : 's'}</span> },
            {
              key: 'low',
              header: 'Status',
              render: (m) => (
                <span className="row">
                  {m.low && (
                    <StatusPill tone="watch" icon={PackageX}>
                      Low (reorder at {m.reorderLevel})
                    </StatusPill>
                  )}
                  {m.expiredQty > 0 && <StatusPill tone="high">{m.expiredQty} expired</StatusPill>}
                  {m.expiringSoon && <StatusPill tone="due">Expires {expiryLabel(m.nearestExpiry)}</StatusPill>}
                </span>
              ),
            },
            { key: 'value', header: 'Value (MRP)', align: 'right', render: (m) => <span className="tabular">{money(m.mrpValuePaise)}</span> },
          ]}
        />
      </div>
      {sheet && <StockSheet onClose={() => setSheet(false)} />}
    </>
  );
}

const two = (n) => String(n).padStart(2, '0');
const sheetDate = (iso) => iso.split('-').reverse().join('/'); // 2029-06-30 → 30/06/2029
const sheetTime = (d) => `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
const amount = (paise) => (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Column widths, the same for the headings repeated on each page and for the lines under them.
function SheetCols() {
  return (
    <colgroup>
      {[6, 31, 14, 11, 8, 8, 11, 11].map((w, i) => (
        <col key={i} style={{ width: `${w}%` }} />
      ))}
    </colgroup>
  );
}

/**
 * The stock sheet (Current Stock), laid out as the pharmacy's stock software printed it: one line per batch, a blank
 * Phy Qty column to write the shelf count in, the values at MRP and at purchase price, and the totals at the end.
 * The column headings and the print time are on every page; Download PDF numbers the pages.
 */
function StockSheet({ onClose }) {
  const res = useFetch('/pharmacy/stock-sheet');
  const [printedAt] = useState(() => new Date());
  const d = res.data;
  const s = d?.settings;
  const fileName = `Stock sheet ${printedAt.getFullYear()}-${two(printedAt.getMonth() + 1)}-${two(printedAt.getDate())}`;
  return (
    <PrintPreview
      title="Stock sheet – print preview"
      hint="Print it on A4 paper to count the shelves, or save it as a PDF."
      pdf={{ fileName: `${fileName}.pdf`, title: fileName, share: false, onSaved: async () => {} }}
      docKey={d ? `stock-sheet-${d.lines.length}` : null}
      pageNumbers
      onClose={onClose}
    >
      {res.error && <Alert type="error">{res.error}</Alert>}
      {d && (
        <PrintDocument
          className="bill-doc ph-sheet"
          head={
            <table className="ph-sheet-lines">
              <SheetCols />
              <thead>
                <tr>
                  <th scope="col">Sr. No</th>
                  <th scope="col">Item name</th>
                  <th scope="col">Batch no</th>
                  <th scope="col">Exp. date</th>
                  <th scope="col" className="num">Bal Qty</th>
                  <th scope="col" className="num">Phy Qty</th>
                  <th scope="col" className="num">Total Amt – MRP</th>
                  <th scope="col" className="num">Total Amt – Purchase</th>
                </tr>
              </thead>
            </table>
          }
          footer={<span>Print date and time {sheetTime(printedAt)}</span>}
        >
          <div className="ph-sheet-top">
            <p className="ph-sheet-name">{s.name}</p>
            {s.address && <p>{s.address}</p>}
            {s.phone && <p>{s.phone}</p>}
            <p className="ph-sheet-title">Current Stock</p>
            <p>Store name: Pharmacy store</p>
          </div>
          {!d.lines.length && <p>No stock.</p>}
          <table className="ph-sheet-lines">
            <SheetCols />
            <tbody>
              {d.lines.map((l, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{l.name}</td>
                  <td>{l.batch}</td>
                  <td>
                    {sheetDate(l.expiry)}
                    {l.expired && <span className="ph-sheet-expired"> expired</span>}
                  </td>
                  <td className="num">{l.qty.toFixed(2)}</td>
                  <td className="num" />
                  <td className="num">{amount(l.mrpValuePaise)}</td>
                  <td className="num">{amount(l.costValuePaise)}</td>
                </tr>
              ))}
              {/* In the body, not a table footer: a browser would repeat a footer on every printed page */}
              <tr className="ph-sheet-total">
                <th scope="row" colSpan={6}>
                  Total amount
                </th>
                <td className="num">{amount(d.totals.mrpValuePaise)}</td>
                <td className="num">{amount(d.totals.costValuePaise)}</td>
              </tr>
            </tbody>
          </table>
        </PrintDocument>
      )}
    </PrintPreview>
  );
}

function WriteOffDialog({ batch, onClose, onDone }) {
  const [qty, setQty] = useState(String(batch.qtyLeft));
  const [reason, setReason] = useState(batch.expired ? 'Expired' : '');
  const s = useSend(onDone);
  const n = Number(qty);
  return (
    <Modal id="ph-wo" title={`Write off batch ${batch.batch}`} onClose={onClose}>
      <p>{batch.qtyLeft} in this batch. Expired, damaged or lost stock leaves the stock with a reason.</p>
      <Alert type="error">{s.error}</Alert>
      <div className="form-grid">
        <Field label="Quantity" id="ph-wo-qty">
          <input id="ph-wo-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Reason" id="ph-wo-reason">
          <input id="ph-wo-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <div className="row">
        <button type="button" className="btn btn-danger" disabled={!Number.isInteger(n) || n < 1 || n > batch.qtyLeft || reason.trim().length < 3 || s.busy} onClick={() => s.send(`/pharmacy/batches/${batch.id}/writeoff`, { qty: n, reason: reason.trim() })}>
          {s.busy ? 'Saving…' : 'Write off'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function CountDialog({ batch, controlled, onClose, onDone }) {
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const [witness, setWitness] = useState('');
  const s = useSend(onDone);
  const n = Number(counted);
  const ok = counted !== '' && Number.isInteger(n) && n >= 0 && n !== batch.qtyLeft && reason.trim().length >= 3 && (!controlled || witness.trim().length >= 2);
  return (
    <Modal id="ph-count" title={`Stock count – batch ${batch.batch}`} onClose={onClose}>
      <p>Perinexa shows {batch.qtyLeft}. Enter what was counted on the shelf.</p>
      <Alert type="error">{s.error}</Alert>
      <div className="form-grid">
        <Field label="Counted" id="ph-count-n">
          <input id="ph-count-n" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value)} />
        </Field>
        <Field label="Reason for the difference" id="ph-count-reason">
          <input id="ph-count-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {controlled && (
          <Field label="Witness (staff who checked)" id="ph-count-witness" error={s.fields.witness}>
            <input id="ph-count-witness" value={witness} maxLength={150} onChange={(e) => setWitness(e.target.value)} />
          </Field>
        )}
      </div>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={!ok || s.busy} onClick={() => s.send(`/pharmacy/batches/${batch.id}/count`, { counted: n, reason: reason.trim(), witness: witness.trim() })}>
          <ClipboardCheck aria-hidden="true" /> {s.busy ? 'Saving…' : 'Save the count'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function MedicineStockPage() {
  const { id } = useParams();
  const { activeMembership } = useAuth();
  const res = useFetch(`/pharmacy/stock/${id}`);
  const [dialog, setDialog] = useState(null); // { kind, batch }
  const [flash, setFlash] = useState(null);
  const d = res.data;
  const desk = activeMembership.roles.includes('pharmacist');
  const done = (message) => () => {
    setDialog(null);
    setFlash(message);
    res.reload();
  };
  return (
    <>
      <PharmacyHeader title={d ? d.medicine.name : 'Medicine'} crumb="Stock" subtitle={d ? `${medicineLabel(d.medicine)} · ${d.medicine.inStock} ${d.medicine.unit}s usable` : undefined} badges={d && <ScheduleMark schedule={d.medicine.schedule} />} />
      <div className="pf-content bill-page">
        {res.error && <Alert type="error">{res.error}</Alert>}
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        {d && (
          <section className="card bill-section">
            <h2>Batches</h2>
            {!d.batches.length && <p className="muted">No stock.</p>}
            <table className="bill-lines">
              <thead>
                <tr>
                  <th scope="col">Batch</th>
                  <th scope="col">Expiry</th>
                  <th scope="col" className="num">Left</th>
                  <th scope="col" className="num">MRP</th>
                  <th scope="col" className="num">Cost</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.batches.map((b) => (
                  <tr key={b.id}>
                    <td>{b.batch}</td>
                    <td>
                      {expiryLabel(b.expiry)} {b.expired && <StatusPill tone="high">Expired</StatusPill>}
                    </td>
                    <td className="num">{b.qtyLeft}</td>
                    <td className="num">{money(b.mrpPaise)}</td>
                    <td className="num">{money(b.costPaise)}</td>
                    <td className="bill-price-actions">
                      {desk && b.qtyLeft > 0 && (
                        <button type="button" className="btn btn-link btn-sm" onClick={() => setDialog({ kind: 'writeoff', batch: b })}>
                          Write off
                        </button>
                      )}
                      {desk && (
                        <button type="button" className="btn btn-link btn-sm" onClick={() => setDialog({ kind: 'count', batch: b })}>
                          Count
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        {d && (
          <section className="card bill-section">
            <h2>Stock moves</h2>
            <table className="bill-report">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">What</th>
                  <th scope="col">Batch</th>
                  <th scope="col" className="num">Qty</th>
                  <th scope="col" className="num">Balance</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {d.moves.map((m, i) => (
                  <tr key={i}>
                    <td>{formatDateTime(m.at)}</td>
                    <td>{MOVE_LABELS[m.kind]}</td>
                    <td>{m.batch}</td>
                    <td className="num">{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
                    <td className="num">{m.balanceAfter}</td>
                    <td>{[m.ref, m.reason, m.witness && `witness ${m.witness}`, m.byName].filter(Boolean).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
      {dialog?.kind === 'writeoff' && <WriteOffDialog batch={dialog.batch} onClose={() => setDialog(null)} onDone={done('Written off.')} />}
      {dialog?.kind === 'count' && <CountDialog batch={dialog.batch} controlled={CONTROLLED.includes(d.medicine.schedule)} onClose={() => setDialog(null)} onDone={done('Stock count saved.')} />}
    </>
  );
}
