import { useState } from 'react';
import { BedDouble, CalendarClock, CircleAlert, CircleCheck, Clock, Download, PackageSearch, Printer, Receipt, RotateCcw, Save, ShoppingCart, Truck } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiFile } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { downloadFile } from '../../components/print/pdfExport.js';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, KpiCard, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { dayLabel } from '../appointments/appointmentFormat.js';
import { gstinProblem } from './gstin.js';
import { MOVE_LABELS, expiryLabel } from './pharmacyFormat.js';
import { PharmacyHeader, PharmacyLetterhead, money, useSend } from './pharmacyUi.jsx';

// Pharmacy → Reports (laid out for easy reading, owner 26 Oct 2026): a period with quick choices, the period's numbers
// as cards, then one report at a time – stock alerts (low stock, expiring and expired batches), sales and GST by rate,
// purchases by supplier net of what was returned to each supplier, the registers (Schedule H1, Schedule X, narcotic –
// printable) and the export for the accountant (admin).
// Pharmacy → Settings: the pharmacy's name, GSTIN and licence numbers printed on its invoices (and its city and PIN
// code, which the e-invoice file of a sale to a business needs).

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function RegisterTables({ reg }) {
  return reg.pages.map((p) => (
    <div key={p.medicine.id} className="ph-register-page">
      <h3>
        {p.medicine.name}
        {p.medicine.strength ? ` ${p.medicine.strength}` : ''} <span className="muted">({p.medicine.unit}s)</span>
      </h3>
      {reg.type !== 'H1' && <p className="hint">Opening balance: {p.opening}</p>}
      <table className="bill-report ph-register">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Entry</th>
            <th scope="col">Batch</th>
            <th scope="col">Patient / supplier</th>
            <th scope="col">Doctor</th>
            <th scope="col" className="num">In</th>
            <th scope="col" className="num">Out</th>
            {reg.type !== 'H1' && <th scope="col" className="num">Balance</th>}
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {p.rows.map((r, i) => (
            <tr key={i}>
              <td>
                {r.date} {r.time}
              </td>
              <td>
                {MOVE_LABELS[r.kind]} {r.ref}
              </td>
              <td>{r.batch}</td>
              <td>{r.patient || r.supplier}</td>
              <td>{r.doctor}</td>
              <td className="num">{r.in || ''}</td>
              <td className="num">{r.out || ''}</td>
              {reg.type !== 'H1' && <td className="num">{r.balance}</td>}
              <td>{[r.reason, reg.type === 'H1' && ['supplier_return', 'supplier_return_cancelled'].includes(r.kind) && `balance ${r.balance}`, r.witness && `witness: ${r.witness}`, r.byName].filter(Boolean).join(' · ')}</td>
            </tr>
          ))}
          {!p.rows.length && (
            <tr>
              <td colSpan={9} className="muted">
                No entries in this period.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {reg.type !== 'H1' && <p className="hint">Closing balance: {p.closing}</p>}
    </div>
  ));
}

// The reports, one at a time (owner, 26 Oct 2026: simpler to read): stock alerts, sales and GST, purchases, the
// registers and – for the hospital admin – the export.
const VIEWS = [
  ['alerts', 'Stock alerts'],
  ['sales', 'Sales & GST'],
  ['purchases', 'Purchases'],
  ['registers', 'Registers'],
];

/** The period: quick choices, or any two dates. */
function Period({ from, to, setFrom, setTo }) {
  const now = new Date();
  const today = isoOf(now);
  const quick = [
    ['Today', today, today],
    ['This month', isoOf(new Date(now.getFullYear(), now.getMonth(), 1)), today],
    ['Last month', isoOf(new Date(now.getFullYear(), now.getMonth() - 1, 1)), isoOf(new Date(now.getFullYear(), now.getMonth(), 0))],
  ];
  return (
    <div className="ph-rep-period">
      <div className="segmented" role="group" aria-label="Quick period">
        {quick.map(([label, f, t]) => (
          <button
            key={label}
            type="button"
            aria-pressed={from === f && to === t}
            onClick={() => {
              setFrom(f);
              setTo(t);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="ph-rep-date">
        <span>From</span>
        <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
      </label>
      <label className="ph-rep-date">
        <span>To</span>
        <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
      </label>
    </div>
  );
}

function StockAlerts({ a }) {
  // Expired first (take them off the shelf), then the soonest to expire
  const batches = [...a.expiring].sort((x, y) => (x.expired === y.expired ? x.daysLeft - y.daysLeft : x.expired ? -1 : 1));
  return (
    <div className="ph-rep-two">
      <section className="card bill-section" aria-labelledby="rep-low">
        <div className="row-between">
          <h2 id="rep-low">Low stock</h2>
          {a.low.length > 0 && (
            <Link className="btn btn-secondary btn-sm" to="/pharmacy/orders/new">
              Order now
            </Link>
          )}
        </div>
        {!a.low.length ? (
          <p className="muted">
            <CircleCheck aria-hidden="true" className="ph-rep-ok" /> Every medicine is above its reorder level.
          </p>
        ) : (
          <table className="bill-report">
            <thead>
              <tr>
                <th scope="col">Medicine</th>
                <th scope="col" className="num">
                  Left
                </th>
                <th scope="col" className="num">
                  Reorder at
                </th>
              </tr>
            </thead>
            <tbody>
              {a.low.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link to={`/pharmacy/stock/${m.id}`}>{m.name}</Link>
                  </td>
                  <td className="num">{m.qty}</td>
                  <td className="num">{m.reorderLevel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {a.low.length > 0 && <p className="hint">Order now → "Suggest from low stock" fills the order for you.</p>}
      </section>
      <section className="card bill-section" aria-labelledby="rep-exp">
        <div className="row-between">
          <h2 id="rep-exp">Expiring within {a.days} days, or expired</h2>
          {batches.some((b) => b.expired) && (
            <Link className="btn btn-secondary btn-sm" to="/pharmacy/supplier-returns/new">
              Return to supplier
            </Link>
          )}
        </div>
        {!batches.length ? (
          <p className="muted">
            <CircleCheck aria-hidden="true" className="ph-rep-ok" /> No batch expires in the next {a.days} days.
          </p>
        ) : (
          <table className="bill-report">
            <thead>
              <tr>
                <th scope="col">Medicine</th>
                <th scope="col">Batch</th>
                <th scope="col" className="num">
                  Left
                </th>
                <th scope="col">Expiry</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link to={`/pharmacy/stock/${b.medicine.id}`}>{b.medicine.name}</Link>
                  </td>
                  <td>{b.batch}</td>
                  <td className="num">{b.qtyLeft}</td>
                  <td>{expiryLabel(b.expiry)}</td>
                  <td>
                    {b.expired ? (
                      <StatusPill tone="high" icon={CircleAlert}>
                        Expired – do not sell
                      </StatusPill>
                    ) : (
                      <StatusPill tone={b.daysLeft <= 30 ? 'watch' : 'due'} icon={Clock}>
                        {b.daysLeft} days left
                      </StatusPill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {batches.length > 0 && <p className="hint">Sell these first. Expired stock: write it off under Stock, or send it back with Return to supplier.</p>}
      </section>
    </div>
  );
}

function SalesReport({ s }) {
  return (
    <>
      <section className="card bill-section" aria-labelledby="rep-days">
        <h2 id="rep-days">Sales day by day</h2>
        <table className="bill-report">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col" className="num">
                Bills
              </th>
              <th scope="col" className="num">
                Sold at the counter
              </th>
              <th scope="col" className="num">
                Issued to wards
              </th>
              <th scope="col" className="num">
                Returned
              </th>
            </tr>
          </thead>
          <tbody>
            {s.byDay.map((d) => (
              <tr key={d.date}>
                <td>{dayLabel(d.date)}</td>
                <td className="num">{d.invoices}</td>
                <td className="num">{money(d.salePaise)}</td>
                <td className="num">{money(d.issuePaise)}</td>
                <td className="num">{d.returnedPaise ? `−${money(d.returnedPaise)}` : '—'}</td>
              </tr>
            ))}
            {!s.byDay.length && (
              <tr>
                <td colSpan={5} className="muted">
                  No sales in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      <section className="card bill-section" aria-labelledby="rep-gst">
        <h2 id="rep-gst">GST on sales</h2>
        <p className="hint">For the GST return: the value before tax and the tax at each rate, after returns.</p>
        <table className="bill-report">
          <thead>
            <tr>
              <th scope="col">GST rate</th>
              <th scope="col" className="num">
                Value before tax
              </th>
              <th scope="col" className="num">
                CGST
              </th>
              <th scope="col" className="num">
                SGST
              </th>
              <th scope="col" className="num">
                Total with tax
              </th>
            </tr>
          </thead>
          <tbody>
            {s.gst.map((g) => (
              <tr key={g.rate}>
                <td>{g.rate}%</td>
                <td className="num">{money(g.taxablePaise)}</td>
                <td className="num">{money(g.cgstPaise)}</td>
                <td className="num">{money(g.sgstPaise)}</td>
                <td className="num">{money(g.amountPaise)}</td>
              </tr>
            ))}
            <tr className="bill-report-total">
              <th scope="row">All rates</th>
              <td className="num">{money(s.totals.taxablePaise)}</td>
              <td className="num">{money(s.totals.cgstPaise)}</td>
              <td className="num">{money(s.totals.sgstPaise)}</td>
              <td className="num">{money(s.totals.amountPaise)}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </>
  );
}

function PurchasesReport({ p }) {
  return (
    <section className="card bill-section" aria-labelledby="rep-pur">
      <h2 id="rep-pur">Purchases by supplier</h2>
      <p className="hint">What was bought from each supplier (value before GST, by invoice date), less what was sent back. Cancelled bills are not counted.</p>
      <table className="bill-report">
        <thead>
          <tr>
            <th scope="col">Supplier</th>
            <th scope="col" className="num">
              Bills
            </th>
            <th scope="col" className="num">
              Bought
            </th>
            <th scope="col" className="num">
              Sent back
            </th>
            <th scope="col" className="num">
              Net
            </th>
          </tr>
        </thead>
        <tbody>
          {p.bySupplier.map((x) => (
            <tr key={x.supplier}>
              <td>{x.supplier}</td>
              <td className="num">{x.invoices}</td>
              <td className="num">{money(x.totalPaise)}</td>
              <td className="num">{x.returnedPaise ? `−${money(x.returnedPaise)} (${x.returns} return${x.returns === 1 ? '' : 's'})` : '—'}</td>
              <td className="num">{money(x.netPaise)}</td>
            </tr>
          ))}
          {!p.bySupplier.length && (
            <tr>
              <td colSpan={5} className="muted">
                No purchases or returns in this period.
              </td>
            </tr>
          )}
          <tr className="bill-report-total">
            <th scope="row">All suppliers</th>
            <td />
            <td className="num">{money(p.totalPaise)}</td>
            <td className="num">{p.returnedPaise ? `−${money(p.returnedPaise)}` : '—'}</td>
            <td className="num">{money(p.netPaise)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

export function ReportsPage() {
  const { activeMembership } = useAuth();
  const admin = activeMembership.roles.includes('admin');
  const [params, setParams] = useSearchParams();
  const views = admin ? [...VIEWS, ['export', 'Export']] : VIEWS;
  const view = views.some(([k]) => k === params.get('view')) ? params.get('view') : 'alerts';
  const now = new Date();
  const [from, setFrom] = useState(isoOf(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(isoOf(now));
  const [type, setType] = useState('H1');
  const alerts = useFetch('/pharmacy/reports/alerts');
  const sales = useFetch('/pharmacy/reports/sales', { from, to });
  const purchases = useFetch('/pharmacy/reports/purchases', { from, to });
  const reg = useFetch(view === 'registers' ? '/pharmacy/reports/register' : null, { type, from, to });
  const [printing, setPrinting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const download = async (what) => {
    setExportError(null);
    try {
      const { blob, name } = await apiFile('/pharmacy/export', { query: { from, to, what } });
      downloadFile(blob, name);
    } catch (err) {
      setExportError(err.message);
    }
  };
  const a = alerts.data;
  const s = sales.data;
  const p = purchases.data;
  const sum = (key) => (s ? s.byDay.reduce((t, d) => t + (d[key] ?? 0), 0) : 0);
  const expired = a ? a.expiring.filter((b) => b.expired).length : 0;
  const soon = a ? a.expiring.length - expired : 0;
  const go = (k) => setParams(k === 'alerts' ? {} : { view: k }, { replace: true });
  const card = (k) => `?view=${k}`;

  return (
    <>
      <PharmacyHeader title="Pharmacy reports" crumb="Reports" subtitle="Choose the period, then the report you need." />
      <div className="pf-content bill-page">
        <section className="card bill-section ph-rep-top" aria-label="Period">
          <Period from={from} to={to} setFrom={setFrom} setTo={setTo} />
        </section>

        <div className="kpi-grid" aria-label="This period at a glance">
          <KpiCard to={card('sales')} icon={ShoppingCart} label="Sold at the counter" value={s ? money(sum('salePaise')) : '—'} textValue sub={s ? `${sum('invoices')} bills in this period` : undefined} />
          <KpiCard to={card('sales')} icon={BedDouble} label="Issued to wards" value={s ? money(sum('issuePaise')) : '—'} textValue sub="On the patients' hospital bills" />
          <KpiCard to={card('sales')} icon={RotateCcw} label="Returned by patients" value={s ? money(sum('returnedPaise')) : '—'} textValue sub="Credit notes" />
          <KpiCard to={card('sales')} icon={Receipt} label="GST on sales" value={s ? money(s.totals.cgstPaise + s.totals.sgstPaise) : '—'} textValue sub="CGST + SGST" />
          <KpiCard to={card('purchases')} icon={Truck} label="Bought from suppliers" value={p ? money(p.netPaise) : '—'} textValue sub="After returns, before GST" />
          <KpiCard to={card('alerts')} tone={a?.low.length ? 'watch' : 'neutral'} icon={PackageSearch} label="Low stock" value={a ? String(a.low.length) : '—'} sub={a ? (a.low.length ? 'Medicines to order' : 'Nothing to order') : undefined} />
          <KpiCard
            to={card('alerts')}
            tone={expired ? 'high' : soon ? 'watch' : 'neutral'}
            icon={CalendarClock}
            label="Expiring or expired"
            value={a ? String(a.expiring.length) : '—'}
            sub={a ? (expired ? `${expired} expired – take off the shelf` : soon ? `Within ${a.days} days` : 'Nothing expiring') : undefined}
          />
        </div>

        <div className="segmented ph-rep-tabs" role="group" aria-label="Report">
          {views.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={view === k} onClick={() => go(k)}>
              {label}
            </button>
          ))}
        </div>

        {view === 'alerts' && (alerts.error ? <Alert type="error">{alerts.error}</Alert> : a && <StockAlerts a={a} />)}
        {view === 'sales' && (sales.error ? <Alert type="error">{sales.error}</Alert> : s && <SalesReport s={s} />)}
        {view === 'purchases' && (purchases.error ? <Alert type="error">{purchases.error}</Alert> : p && <PurchasesReport p={p} />)}

        {view === 'registers' && (
          <section className="card bill-section" aria-labelledby="rep-reg">
            <div className="row-between">
              <h2 id="rep-reg">Drug registers</h2>
              {reg.data && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPrinting(true)}>
                  <Printer aria-hidden="true" /> Print
                </button>
              )}
            </div>
            <p className="hint">The registers the law asks the pharmacy to keep, filled in from every sale and purchase. Print and keep them with the pharmacy records.</p>
            <div className="segmented" role="group" aria-label="Register">
              {[
                ['H1', 'Schedule H1'],
                ['X', 'Schedule X'],
                ['narcotic', 'Narcotic (NDPS)'],
              ].map(([k, label]) => (
                <button key={k} type="button" aria-pressed={type === k} onClick={() => setType(k)}>
                  {label}
                </button>
              ))}
            </div>
            {reg.error && <Alert type="error">{reg.error}</Alert>}
            {reg.data && !reg.data.pages.length && <p className="muted">No {reg.data.label} medicines{type === 'H1' ? ' sold' : ''} in this period.</p>}
            {reg.data && <RegisterTables reg={reg.data} />}
          </section>
        )}

        {view === 'export' && admin && (
          <section className="card bill-section" aria-labelledby="rep-export">
            <h2 id="rep-export">Export for the accountant</h2>
            <p className="hint">Files that open in Excel, for the period above. They hold patient names: keep them safe. Cancelled purchases and cancelled returns are listed too, marked in the Status column.</p>
            <Alert type="error">{exportError}</Alert>
            <div className="row">
              <button type="button" className="btn btn-secondary" onClick={() => download('sales')}>
                <Download aria-hidden="true" /> Sales with GST
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => download('purchases')}>
                <Download aria-hidden="true" /> Purchases
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => download('supplier_returns')}>
                <Download aria-hidden="true" /> Returns to suppliers
              </button>
            </div>
          </section>
        )}
      </div>
      {printing && reg.data && (
        <PrintPreview title={`${reg.data.label} register – print preview`} hint="Print on A4 paper; keep it with the pharmacy records." onClose={() => setPrinting(false)}>
          <PrintDocument className="bill-doc ph-doc">
            <PharmacyLetterhead settings={reg.data.settings} rmi={type === 'narcotic'} />
            <h1 className="pdoc-title">{reg.data.label} register</h1>
            <p className="pdoc-small">
              {dayLabel(reg.data.from)} to {dayLabel(reg.data.to)}
              {reg.data.settings.licence20 ? ` · DL ${reg.data.settings.licence20}` : ''}
              {type === 'narcotic' && reg.data.settings.rmi ? ` · RMI ${reg.data.settings.rmi}` : ''}
            </p>
            <RegisterTables reg={reg.data} />
            <p className="bill-sign">Pharmacist: ____________________ &nbsp; Checked by: ____________________</p>
          </PrintDocument>
        </PrintPreview>
      )}
    </>
  );
}

export function PharmacySettingsPage() {
  const res = useFetch('/pharmacy/settings');
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);
  const s = useSend(() => setSaved(true));
  const v = form ?? (res.data && { ...res.data.settings, ...res.data.own });
  const canEdit = Boolean(res.data?.canEdit);
  const f = (k) => (e) => {
    setSaved(false);
    setForm({ ...v, [k]: e.target.value });
  };
  const fields = [
    ['name', 'Pharmacy name (on invoices)', 150],
    ['gstin', 'GSTIN', 20],
    ['licence20', 'Drug licence – Form 20', 80],
    ['licence21', 'Drug licence – Form 21', 80],
    ['rmi', 'NDPS recognition (RMI) number', 80],
    ['pharmacistName', 'Registered pharmacist', 150],
    ['address', 'Store address (on its papers)', 300],
    ['phone', 'Store phone numbers', 80],
    ['state', 'State (for GST)', 60],
    ['place', 'City or town', 50],
    ['pin', 'PIN code', 6],
  ];
  const gstinNote = v?.gstin?.trim() ? gstinProblem(v.gstin) : null;
  const pinWrong = Boolean(v?.pin?.trim()) && !/^[1-9]\d{5}$/.test(v.pin.trim());
  return (
    <>
      <PharmacyHeader title="Pharmacy settings" crumb="Settings" />
      <div className="pf-content bill-page">
        {res.error && <Alert type="error">{res.error}</Alert>}
        <Alert type="error">{s.error}</Alert>
        {saved && <Alert type="success">Saved.</Alert>}
        {v && (
          <section className="card bill-section narrow">
            <p className="hint">
              Printed on every tax invoice, credit note, purchase order and debit note. Leave the store address or phone empty to print the hospital letterhead’s. The city and PIN code are needed only for the e-invoice file of a sale to a business.
            </p>
            <div className="form-grid">
              {fields.map(([k, label, max]) => (
                <Field
                  key={k}
                  label={label}
                  id={`phs-${k}`}
                  error={k === 'pin' && pinWrong ? 'A PIN code has 6 digits.' : s.fields[k]}
                  keepHint={k === 'gstin'}
                  hint={k === 'gstin' && gstinNote ? `Please check: ${gstinNote}` : undefined}
                >
                  {k === 'address' ? (
                    <textarea id={`phs-${k}`} rows={3} value={v[k] ?? ''} maxLength={max} onChange={f(k)} disabled={!canEdit} />
                  ) : (
                    <input id={`phs-${k}`} value={v[k] ?? ''} maxLength={max} onChange={f(k)} disabled={!canEdit} />
                  )}
                </Field>
              ))}
            </div>
            {canEdit && (
              <button type="button" className="btn btn-primary" disabled={!form || pinWrong || s.busy} onClick={() => s.send('/pharmacy/settings', Object.fromEntries(fields.map(([k]) => [k, (v[k] ?? '').trim()])), 'PUT')}>
                <Save aria-hidden="true" /> Save
              </button>
            )}
          </section>
        )}
      </div>
    </>
  );
}
