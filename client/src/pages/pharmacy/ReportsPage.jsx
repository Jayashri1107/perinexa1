import { useState } from 'react';
import { Download, Printer, Save } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiFile } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { downloadFile } from '../../components/print/pdfExport.js';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { dayLabel } from '../appointments/appointmentFormat.js';
import { gstinProblem } from './gstin.js';
import { MOVE_LABELS, expiryLabel } from './pharmacyFormat.js';
import { PharmacyHeader, money, useSend } from './pharmacyUi.jsx';

// Pharmacy → Reports: alerts (low stock, expiring and expired batches), the registers (Schedule H1, Schedule X,
// narcotic – printable), sales and GST by rate, purchases by supplier net of what was returned to each supplier, and
// the export for the accountant (admin).
// Pharmacy → Settings: the pharmacy's name, GSTIN and licence numbers printed on its invoices (and its city and PIN
// code, which the e-invoice file of a sale to a business needs).

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function Period({ from, to, setFrom, setTo }) {
  return (
    <div className="form-grid">
      <Field label="From" id="ph-rep-from">
        <input id="ph-rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </Field>
      <Field label="To" id="ph-rep-to">
        <input id="ph-rep-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
      </Field>
    </div>
  );
}

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

export function ReportsPage() {
  const { activeMembership } = useAuth();
  const admin = activeMembership.roles.includes('admin');
  const now = new Date();
  const [from, setFrom] = useState(isoOf(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(isoOf(now));
  const [type, setType] = useState('H1');
  const alerts = useFetch('/pharmacy/reports/alerts');
  const sales = useFetch('/pharmacy/reports/sales', { from, to });
  const purchases = useFetch('/pharmacy/reports/purchases', { from, to });
  const reg = useFetch('/pharmacy/reports/register', { type, from, to });
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
  return (
    <>
      <PharmacyHeader title="Pharmacy reports" crumb="Reports" />
      <div className="pf-content bill-page">
        {a && (
          <section className="card bill-section">
            <h2>Alerts</h2>
            <h3>Low stock ({a.low.length})</h3>
            {!a.low.length && <p className="muted">Nothing is at or below its reorder level.</p>}
            <ul className="appt-lines">
              {a.low.map((m) => (
                <li key={m.id}>
                  <Link to={`/pharmacy/stock/${m.id}`}>{m.name}</Link> – {m.qty} left (reorder at {m.reorderLevel})
                </li>
              ))}
            </ul>
            <h3>Expiring within {a.days} days, or expired ({a.expiring.length})</h3>
            {!a.expiring.length && <p className="muted">No batch expires soon.</p>}
            <ul className="appt-lines">
              {a.expiring.map((b) => (
                <li key={b.id}>
                  <Link to={`/pharmacy/stock/${b.medicine.id}`}>{b.medicine.name}</Link> · batch {b.batch} · {b.qtyLeft} left · {expiryLabel(b.expiry)}{' '}
                  {b.expired ? <StatusPill tone="high">Expired – write off or return</StatusPill> : <StatusPill tone="due">{b.daysLeft} days</StatusPill>}
                </li>
              ))}
            </ul>
            <p className="hint">
              To order what is low: <Link to="/pharmacy/orders/new">New order</Link> → Suggest from low stock. To send expired stock back to its supplier: <Link to="/pharmacy/supplier-returns">Returns to supplier</Link>.
            </p>
          </section>
        )}

        <section className="card bill-section">
          <h2>Period</h2>
          <Period from={from} to={to} setFrom={setFrom} setTo={setTo} />
        </section>

        <section className="card bill-section">
          <div className="row-between">
            <h2>Registers</h2>
            <span className="row">
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
              {reg.data && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPrinting(true)}>
                  <Printer aria-hidden="true" /> Print
                </button>
              )}
            </span>
          </div>
          {reg.error && <Alert type="error">{reg.error}</Alert>}
          {reg.data && !reg.data.pages.length && <p className="muted">No {reg.data.label} medicines{type === 'H1' ? ' sold' : ''} in this period.</p>}
          {reg.data && <RegisterTables reg={reg.data} />}
        </section>

        {sales.data && (
          <section className="card bill-section">
            <h2>Sales and GST</h2>
            <table className="bill-report">
              <caption>By day</caption>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col" className="num">Invoices</th>
                  <th scope="col" className="num">Counter</th>
                  <th scope="col" className="num">Inpatient</th>
                  <th scope="col" className="num">Returned</th>
                </tr>
              </thead>
              <tbody>
                {sales.data.byDay.map((d) => (
                  <tr key={d.date}>
                    <td>{dayLabel(d.date)}</td>
                    <td className="num">{d.invoices}</td>
                    <td className="num">{money(d.salePaise)}</td>
                    <td className="num">{money(d.issuePaise)}</td>
                    <td className="num">{d.returnedPaise ? `−${money(d.returnedPaise)}` : ''}</td>
                  </tr>
                ))}
                {!sales.data.byDay.length && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No sales in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <table className="bill-report">
              <caption>GST by rate (after returns)</caption>
              <thead>
                <tr>
                  <th scope="col">Rate</th>
                  <th scope="col" className="num">Taxable value</th>
                  <th scope="col" className="num">CGST</th>
                  <th scope="col" className="num">SGST</th>
                  <th scope="col" className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {sales.data.gst.map((g) => (
                  <tr key={g.rate}>
                    <td>{g.rate}%</td>
                    <td className="num">{money(g.taxablePaise)}</td>
                    <td className="num">{money(g.cgstPaise)}</td>
                    <td className="num">{money(g.sgstPaise)}</td>
                    <td className="num">{money(g.amountPaise)}</td>
                  </tr>
                ))}
                <tr className="bill-report-total">
                  <th scope="row">All</th>
                  <td className="num">{money(sales.data.totals.taxablePaise)}</td>
                  <td className="num">{money(sales.data.totals.cgstPaise)}</td>
                  <td className="num">{money(sales.data.totals.sgstPaise)}</td>
                  <td className="num">{money(sales.data.totals.amountPaise)}</td>
                </tr>
              </tbody>
            </table>
          </section>
        )}

        {purchases.data && (
          <section className="card bill-section">
            <h2>Purchases by supplier, net of returns</h2>
            <table className="bill-report">
              <thead>
                <tr>
                  <th scope="col">Supplier</th>
                  <th scope="col" className="num">Invoices</th>
                  <th scope="col" className="num">Purchases</th>
                  <th scope="col" className="num">Returned</th>
                  <th scope="col" className="num">Net</th>
                </tr>
              </thead>
              <tbody>
                {purchases.data.bySupplier.map((x) => (
                  <tr key={x.supplier}>
                    <td>{x.supplier}</td>
                    <td className="num">{x.invoices}</td>
                    <td className="num">{money(x.totalPaise)}</td>
                    <td className="num">{x.returnedPaise ? `−${money(x.returnedPaise)} (${x.returns} return${x.returns === 1 ? '' : 's'})` : ''}</td>
                    <td className="num">{money(x.netPaise)}</td>
                  </tr>
                ))}
                {!purchases.data.bySupplier.length && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No purchases or returns in this period.
                    </td>
                  </tr>
                )}
                <tr className="bill-report-total">
                  <th scope="row">Total</th>
                  <td />
                  <td className="num">{money(purchases.data.totalPaise)}</td>
                  <td className="num">{purchases.data.returnedPaise ? `−${money(purchases.data.returnedPaise)}` : ''}</td>
                  <td className="num">{money(purchases.data.netPaise)}</td>
                </tr>
              </tbody>
            </table>
            <p className="hint">Purchase value before GST. Purchases count by their invoice date; returns to a supplier by the day the stock went back. A cancelled purchase or return is not counted.</p>
          </section>
        )}

        {admin && (
          <section className="card bill-section">
            <h2>Export for the accountant</h2>
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
          <PrintDocument className="bill-doc">
            <h1 className="pdoc-title">
              {reg.data.label} register – {reg.data.settings.name}
            </h1>
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
  const v = form ?? res.data?.settings;
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
              Printed on every tax invoice, credit note, purchase order and debit note. The address and phone come from the hospital letterhead. The city and PIN code are needed only for the e-invoice file of a sale to a business.
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
                  <input id={`phs-${k}`} value={v[k] ?? ''} maxLength={max} onChange={f(k)} disabled={!canEdit} />
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
