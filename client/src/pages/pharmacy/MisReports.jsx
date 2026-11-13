import { useState } from 'react';
import { ChevronDown, ChevronRight, FileSpreadsheet, Printer } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { downloadFile } from '../../components/print/pdfExport.js';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, formatDate } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PharmacyLetterhead, money } from './pharmacyUi.jsx';

// Pharmacy → Reports → Report list (13 Nov 2026, the developer, after the pharmacy's earlier software): two trees,
// Inventory MIS (purchase and stock) and Pharmacy MIS (sales and returns, GST, schedule drugs); beside them the chosen
// report's form (the dates, and only the choices it uses: supplier, item, batch, expiry, detail or summary, days) and
// the report, with Print (A4 landscape) and, for the hospital admin or a report without patient names, a file for Excel.
// The reports are made on the server (server/src/pharmacy/misReports.js and inventoryReports.js); keep the lists in
// step with MIS_GROUPS and INVENTORY_GROUPS there.

export const MIS_LIST = [
  {
    title: 'Sales and returns',
    reports: [
      ['sales', 'Sales report'],
      ['sale-lines', 'Sales bill details'],
      ['collection', 'Sales collection'],
      ['card-collection', 'Card collection'],
      ['patient-collection', 'Patient-wise collection'],
      ['by-doctor', 'Doctor-wise sales'], // the existing Sales by doctor report (the pharmacist only – owner's decision 5)
      ['returns', 'Sales return report'],
      ['return-lines', 'Sales return details'],
      ['credit', 'Credit report'],
      ['patient-credit', 'Patient-wise credit'],
    ],
  },
  {
    title: 'GST',
    reports: [
      ['grn-gst', 'GRN GST report'],
      ['sales-gst', 'Sales GST report'],
      ['grn-return-gst', 'GRN return GST report'],
      ['sales-return-gst', 'Sales return GST report'],
      ['gst-summary', 'GST summary by rate'],
    ],
  },
  {
    title: 'Schedule drugs',
    reports: [
      ['h1-sales', 'Sales – Schedule H1'],
      ['narcotic-sales', 'Sales – narcotic (NDPS)'],
      ['antitb-sales', 'Sales – anti-TB'],
      ['antitb-returns', 'Sales returns – anti-TB'],
      ['h1-returns', 'Sales returns – Schedule H1'],
    ],
  },
];

// Inventory MIS: [key, label, the filters its form shows]
export const INVENTORY_LIST = [
  {
    title: 'Purchase MIS',
    reports: [
      ['indent', 'Indent report', ['item', 'detail']],
      ['indent-datewise', 'Indent date-wise', []],
      ['grn', 'GRN report', ['supplier', 'item', 'batch', 'detail']],
      ['grn-return', 'GRN return report', ['supplier', 'item', 'batch', 'detail']],
      ['purchase-order', 'Purchase order', ['supplier', 'item', 'detail']],
      ['item-grn', 'Item-wise GRN list', ['supplier', 'item']],
      ['supplier-grn', 'Supplier-wise GRN list', ['supplier']],
    ],
  },
  {
    title: 'Stock MIS',
    reports: [
      ['current-stock', 'Current stock report', ['supplier', 'item', 'batch', 'expiry', 'detail']],
      ['stock-datewise', 'Current stock date-wise', ['item']],
      ['non-moving', 'Non-moving item list', ['item', 'days']],
    ],
  },
];
// The two trees of the earlier software
const TREE = [
  { key: 'inventory', title: 'Inventory MIS', groups: INVENTORY_LIST },
  { key: 'pharmacy', title: 'Pharmacy MIS', groups: MIS_LIST.map((g) => ({ ...g, reports: g.reports.map(([k, label]) => [k, label, []]) })) },
];
const ALL = TREE.flatMap((t) => t.groups.flatMap((g) => g.reports.map(([k, label, filters]) => ({ k, label, filters, tree: t.key }))));

/** The expiry month typed as on the pack (08/27, 08/2027) → 'YYYY-MM', or null. */
export function typedMonth(text) {
  const m = /^(\d{1,2})\s*[/.-]\s*(\d{2}|\d{4})$/.exec(String(text ?? '').trim());
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return null;
  return `${m[2].length === 2 ? `20${m[2]}` : m[2]}-${m[1].padStart(2, '0')}`;
}

/** A cell as shown: money in rupees, a date as 13 Nov 2026, '—' for nothing. */
export function misCell(type, v) {
  if (v == null || v === '') return type === 'money' || type === 'num' ? '—' : '';
  if (type === 'money') return money(v);
  if (type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v);
  return String(v);
}

/** The report as a CSV file that opens in Excel: money as plain rupees (1234.50), dates as on the screen. */
export function misCsv(report) {
  const cell = (c, v) => {
    const text = v == null ? '' : c.type === 'money' ? (v / 100).toFixed(2) : c.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v) : String(v);
    // a leading = + - @ would be read as a formula by Excel
    const safe = /^[=+\-@]/.test(text) && c.type !== 'money' ? `'${text}` : text;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [report.columns.map((c) => cell({ type: 'text' }, c.label)).join(','), ...report.rows.map((r) => report.columns.map((c) => cell(c, r[c.k])).join(','))];
  if (report.total) lines.push(report.columns.map((c) => cell(c, report.total[c.k])).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

const isNum = (c) => c.type === 'money' || c.type === 'num';

function MisTable({ report }) {
  return (
    <table className="bill-report ph-mis-table">
      <thead>
        <tr>
          {report.columns.map((c) => (
            <th key={c.k} scope="col" className={isNum(c) ? 'num' : undefined}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {report.rows.map((r, i) => (
          <tr key={i}>
            {report.columns.map((c) => (
              <td key={c.k} className={isNum(c) ? 'num' : undefined}>
                {misCell(c.type, r[c.k])}
              </td>
            ))}
          </tr>
        ))}
        {!report.rows.length && (
          <tr>
            <td colSpan={report.columns.length} className="muted">
              Nothing in this period.
            </td>
          </tr>
        )}
        {report.total && report.rows.length > 0 && (
          <tr className="bill-report-total">
            {report.columns.map((c, i) =>
              i === 0 ? (
                <th key={c.k} scope="row">
                  {report.total[c.k] ?? 'Total'}
                </th>
              ) : (
                <td key={c.k} className={isNum(c) ? 'num' : undefined}>
                  {c.k in report.total ? misCell(c.type, report.total[c.k]) : ''}
                </td>
              ),
            )}
          </tr>
        )}
      </tbody>
    </table>
  );
}

function Summary({ items }) {
  if (!items?.length) return null;
  return (
    <dl className="ph-mis-summary">
      {items.map((s) => (
        <div key={s.label}>
          <dt>{s.label}</dt>
          <dd className="tabular">{money(s.paise)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MisReports({ from, to, setFrom, setTo, admin, pharmacist, openDoctorSales }) {
  const [params, setParams] = useSearchParams();
  const chosen = ALL.find((r) => r.k === params.get('report') && r.k !== 'by-doctor') ?? ALL.find((r) => r.k === 'grn');
  const [open, setOpen] = useState({ inventory: true, pharmacy: true });
  const [f, setF] = useState({ supplierId: '', medicineId: '', batch: '', expiry: '', detail: false, days: '90' });
  const uses = (x) => chosen.filters.includes(x);
  const expiryBy = uses('expiry') && f.expiry.trim() ? typedMonth(f.expiry) : null;
  const days = Number.parseInt(f.days, 10);
  const query =
    chosen.tree === 'inventory'
      ? {
          report: chosen.k,
          from,
          to,
          ...(uses('supplier') && f.supplierId ? { supplierId: f.supplierId } : {}),
          ...(uses('item') && f.medicineId ? { medicineId: f.medicineId } : {}),
          ...(uses('batch') && f.batch.trim() ? { batch: f.batch.trim() } : {}),
          ...(expiryBy ? { expiryBy } : {}),
          ...(uses('detail') && f.detail ? { detail: '1' } : {}),
          ...(uses('days') && days >= 1 && days <= 730 ? { days: String(days) } : {}),
        }
      : { report: chosen.k, from, to };
  const res = useFetch(chosen.tree === 'inventory' ? '/pharmacy/reports/inventory' : '/pharmacy/reports/mis', query);
  const suppliers = useFetch(uses('supplier') ? '/pharmacy/suppliers' : null);
  const medicines = useFetch(uses('item') ? '/pharmacy/medicines' : null, { active: '1' });
  const [printing, setPrinting] = useState(false);
  const r = res.data?.key === chosen.k ? res.data : null;
  const pick = (k) => {
    if (k === 'by-doctor') return openDoctorSales();
    const next = new URLSearchParams(params);
    next.set('report', k);
    return setParams(next, { replace: true });
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const canExcel = r && (admin || !r.patients);
  const period = r ? (r.from === r.to ? formatDate(r.from) : `${formatDate(r.from)} to ${formatDate(r.to)}`) : '';
  const printTitle = `${chosen.label}${uses('detail') ? (f.detail ? ' – detail' : ' – summary') : ''}`;

  return (
    <div className="ph-mis">
      <nav className="card ph-mis-list" aria-label="Pharmacy reports">
        {TREE.map((t) => (
          <div key={t.key} className="ph-mis-tree">
            <button type="button" className="ph-mis-root" aria-expanded={open[t.key]} onClick={() => setOpen({ ...open, [t.key]: !open[t.key] })}>
              {open[t.key] ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
              {t.title}
            </button>
            {open[t.key] &&
              t.groups.map((g) => (
                <div key={g.title} className="ph-mis-group">
                  <h2 className="ph-mis-group-title">{g.title}</h2>
                  <ul>
                    {g.reports
                      .filter(([k]) => k !== 'by-doctor' || pharmacist)
                      .map(([k, label]) => (
                        <li key={k}>
                          <button type="button" className={chosen.k === k ? 'ph-mis-item is-on' : 'ph-mis-item'} aria-current={chosen.k === k ? 'true' : undefined} onClick={() => pick(k)}>
                            {label}
                          </button>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
          </div>
        ))}
      </nav>

      <div className="ph-mis-main">
        {/* The report's form, as on the earlier software: the dates, then only the choices this report uses */}
        <section className="card ph-mis-form" aria-labelledby="mis-title">
          <div className="ph-mis-head">
            <h2 id="mis-title">{chosen.label}</h2>
            {r && (
              <div className="row">
                {canExcel && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadFile(new Blob([misCsv(r)], { type: 'text/csv;charset=utf-8' }), `${chosen.k}-${r.from}-to-${r.to}.csv`)}>
                    <FileSpreadsheet aria-hidden="true" /> Excel
                  </button>
                )}
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setPrinting(true)}>
                  <Printer aria-hidden="true" /> Print
                </button>
              </div>
            )}
          </div>
          <div className="ph-mis-fields">
            <label className="ph-mis-f">
              <span>From date</span>
              <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            </label>
            <label className="ph-mis-f">
              <span>To date</span>
              <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
            </label>
            {uses('supplier') && (
              <label className="ph-mis-f">
                <span>Supplier name</span>
                <select value={f.supplierId} onChange={set('supplierId')}>
                  <option value="">All suppliers</option>
                  {(suppliers.data?.suppliers ?? []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {uses('item') && (
              <label className="ph-mis-f">
                <span>Item name</span>
                <select value={f.medicineId} onChange={set('medicineId')}>
                  <option value="">All items</option>
                  {(medicines.data?.medicines ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {uses('batch') && (
              <label className="ph-mis-f">
                <span>Batch code</span>
                <input value={f.batch} maxLength={40} placeholder="Any batch" onChange={set('batch')} />
              </label>
            )}
            {uses('expiry') && (
              <label className="ph-mis-f">
                <span>Expiring by (MM/YY)</span>
                <input value={f.expiry} inputMode="numeric" placeholder="Any expiry" maxLength={7} onChange={set('expiry')} aria-invalid={Boolean(f.expiry.trim()) && !expiryBy} />
              </label>
            )}
            {uses('days') && (
              <label className="ph-mis-f">
                <span>Days for non-moving</span>
                <input value={f.days} inputMode="numeric" maxLength={3} onChange={set('days')} />
              </label>
            )}
            {uses('detail') && (
              <div className="ph-mis-f">
                <span>Show</span>
                <div className="segmented" role="group" aria-label="Detail or summary">
                  <button type="button" aria-pressed={!f.detail} onClick={() => setF({ ...f, detail: false })}>
                    Summary
                  </button>
                  <button type="button" aria-pressed={f.detail} onClick={() => setF({ ...f, detail: true })}>
                    Detail
                  </button>
                </div>
              </div>
            )}
          </div>
          {uses('expiry') && f.expiry.trim() && !expiryBy && <p className="field-error">Type the expiry month as MM/YY, for example 08/27.</p>}
        </section>

        <section className="card ph-mis-view" aria-label={`${chosen.label} – result`}>
          {res.error && <Alert type="error">{res.error}</Alert>}
          {!r && !res.error && <p className="muted">Loading…</p>}
          {r && (
            <>
              <p className="hint ph-mis-period">
                {period}
                {r.note ? ` · ${r.note}` : ''}
              </p>
              <Summary items={r.summary} />
              <div className="ph-grn-scroll">
                <MisTable report={r} />
              </div>
              {r.patients && !admin && <p className="hint">Holds patient and customer names: print only what you need and keep the paper with the pharmacy records.</p>}
            </>
          )}
        </section>
      </div>

      {printing && r && (
        <PrintPreview title={`${printTitle} – print preview`} hint="Print on A4 paper, landscape." page={{ size: 'A4 landscape', margin: '10mm' }} onClose={() => setPrinting(false)}>
          <PrintDocument className="bill-doc ph-doc ph-mis-doc">
            <PharmacyLetterhead settings={r.settings} />
            <h1 className="pdoc-title">{printTitle}</h1>
            <p className="pdoc-small">{period}</p>
            {r.note && <p className="pdoc-small">{r.note}</p>}
            <Summary items={r.summary} />
            <MisTable report={r} />
            <p className="bill-sign">Prepared by: ____________________ &nbsp; Checked by: ____________________</p>
          </PrintDocument>
        </PrintPreview>
      )}
    </div>
  );
}
