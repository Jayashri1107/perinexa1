import { useState } from 'react';
import { ChevronDown, ChevronRight, FileSpreadsheet, Printer } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { downloadFile } from '../../components/print/pdfExport.js';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PharmacyLetterhead, money } from './pharmacyUi.jsx';
import { DateText } from '../../components/DateText.jsx';
import { amount } from './searchBill.js';

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
      ['upi-collection', 'UPI collection'],
      ['patient-collection', 'Patient-wise collection'],
      ['by-doctor', 'Doctor-wise sales'], // the existing Sales by doctor report (the pharmacist only – owner's decision 5)
      ['returns', 'Sales return report'],
      ['return-lines', 'Sales return details'],
      ['patient-returns', 'Sales return patient-wise'],
      ['credit', 'Credit report'],
      ['patient-credit', 'Patient-wise credit'],
      ['advance', 'Advance amount report'],
      ['insurance', 'Insurance / cashless patients'],
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
      ['company-grn', 'Company-wise GRN list', ['supplier', 'item', 'detail']],
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

/**
 * The Summary of a Pharmacy MIS report (18 Nov 2026, the pharmacy's request – every report as Details or Summary): its
 * rows added up day by day – the date, how many rows, and the sums of the money and number columns. null for a report
 * with no date column (it is already one row per patient or rate).
 */
export function daySummary(report) {
  const dateCol = report.columns.find((c) => c.type === 'date');
  if (!dateCol) return null;
  const nums = report.columns.filter(isNum);
  const by = new Map();
  for (const r of report.rows) {
    const d = r[dateCol.k] ?? '';
    const x = by.get(d) ?? { [dateCol.k]: d, count: 0, ...Object.fromEntries(nums.map((c) => [c.k, 0])) };
    x.count += 1;
    for (const c of nums) x[c.k] += r[c.k] ?? 0;
    by.set(d, x);
  }
  const rows = [...by.values()].sort((a, b) => String(a[dateCol.k]).localeCompare(String(b[dateCol.k])));
  const total = { [dateCol.k]: `${rows.length} day${rows.length === 1 ? '' : 's'}`, count: report.rows.length, ...Object.fromEntries(nums.map((c) => [c.k, rows.reduce((n, r) => n + r[c.k], 0)])) };
  return { ...report, columns: [dateCol, { k: 'count', label: 'Entries', type: 'num' }, ...nums], rows, total };
}

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

// ---------- Pharmacy Daily Collection (24 Nov 2026) ----------
// Sales collection as the pharmacy's earlier software printed it (server/src/pharmacy/dailyCollection.js): Cash Sales,
// Cash Sales Return, Credit Sale and Due Collection, each with its Sub Total, rows numbered on through the sections;
// then the money by mode (Sales, Sales Return, Advance, Advance Refund), the net collection, the amount by mode and the
// sale types. On A4 landscape with the store's heading, the period, when it was printed and "Page 1 of 2".

const DC_MONEY = [
  ['netPaise', 'Net amount'],
  ['cashPaise', 'Cash'],
  ['chequePaise', 'Cheque'],
  ['cardPaise', 'Card'],
  ['neftPaise', 'NEFT'],
  ['upiPaise', 'UPI'],
  ['advancePaise', 'Adv. use amount'],
];
const DC_MODES = { cash: 'Cash', cheque: 'Cheque', card: 'Card', neft: 'NEFT', upi: 'UPI Transaction' };
// Dates as the brand guide writes them (23 Nov 2026), not the earlier paper's 23/11/2026
const dmy = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso ?? '') ? formatDate(iso) : (iso ?? ''));
/** The period in the report's words: one day, or from – to. */
export const dcPeriod = (from, to) => (from === to ? dmy(from) : `${dmy(from)} to ${dmy(to)}`);

/** The four sections, one table: the column headings repeat on every printed page. */
export function DailyCollectionTable({ daily }) {
  let sr = 0;
  return (
    <table className="bill-report ph-dc-table">
      <thead>
        <tr>
          <th scope="col">Sr. No</th>
          <th scope="col">Date</th>
          <th scope="col">Sales no</th>
          <th scope="col">MR No</th>
          <th scope="col">Patient name</th>
          {DC_MONEY.map(([k, label]) => (
            <th key={k} scope="col" className="num">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      {daily.sections.map((section) => (
        <tbody key={section.key}>
          <tr className="ph-dc-section">
            <th colSpan={5 + DC_MONEY.length} scope="rowgroup">
              {section.title}
            </th>
          </tr>
          {section.rows.map((r) => {
            sr += 1;
            return (
              <tr key={`${section.key}-${r.invoiceId}-${r.date}-${sr}`}>
                <td className="num">{sr}</td>
                <td>{dmy(r.date)}</td>
                <td className="tabular">{r.saleNumber}</td>
                <td className="tabular">{r.mrn || '–'}</td>
                <td className="ph-dc-name">{r.name}</td>
                {DC_MONEY.map(([k]) => (
                  <td key={k} className="num">
                    {amount(r[k])}
                  </td>
                ))}
              </tr>
            );
          })}
          {!section.rows.length && (
            <tr>
              <td colSpan={5 + DC_MONEY.length} className="muted ph-dc-none">
                None in this period.
              </td>
            </tr>
          )}
          <tr className="ph-dc-sub">
            <th colSpan={5} scope="row">
              Sub total
            </th>
            {DC_MONEY.map(([k]) => (
              <td key={k} className="num">
                {amount(section.total[k])}
              </td>
            ))}
          </tr>
        </tbody>
      ))}
    </table>
  );
}

/** Under the sections: the money by mode, the net collection, the amount by mode and the sale types. */
export function DailyCollectionEnd({ daily }) {
  const m = daily.summary;
  const total = (k) => daily.modes.reduce((n, x) => n + x[k], 0);
  const byMode = Object.fromEntries(daily.modes.map((x) => [x.mode, x]));
  return (
    <div className="ph-dc-end">
      <div className="ph-dc-money">
        <table className="ph-dc-modes">
          <caption className="sr-only">Collection by mode</caption>
          <thead>
            <tr>
              <td />
              <th scope="col">Sales</th>
              <th scope="col">Sales return</th>
              <th scope="col">Advance</th>
              <th scope="col">Advance refund</th>
            </tr>
          </thead>
          <tbody>
            {daily.modes.map((x) => (
              <tr key={x.mode}>
                <th scope="row">{DC_MODES[x.mode] ?? x.mode}</th>
                <td className="num">{amount(x.salesPaise)}</td>
                <td className="num">{amount(x.returnPaise)}</td>
                <td className="num">{amount(x.advancePaise)}</td>
                <td className="num">{amount(x.advanceRefundPaise)}</td>
              </tr>
            ))}
            <tr className="ph-dc-total">
              <th scope="row">Total</th>
              <td className="num">{amount(total('salesPaise'))}</td>
              <td className="num">{amount(total('returnPaise'))}</td>
              <td className="num">{amount(total('advancePaise'))}</td>
              <td className="num">{amount(total('advanceRefundPaise'))}</td>
            </tr>
            <tr className="ph-dc-net">
              <th scope="row">Net collection</th>
              <td className="num">{amount(m.netCollectionPaise)}</td>
              <td colSpan={3} className="ph-dc-net-how">
                Sales − sales return + advance − advance refund
              </td>
            </tr>
          </tbody>
        </table>
        <dl className="ph-dc-amts">
          {['cash', 'cheque', 'card', 'neft', 'upi']
            .filter((k) => k !== 'cheque' || byMode.cheque?.netPaise)
            .map((k) => (
              <div key={k}>
                <dt>{k.toUpperCase()} AMT</dt>
                <dd className="tabular">{amount(byMode[k]?.netPaise ?? 0)}</dd>
              </div>
            ))}
        </dl>
      </div>
      <table className="ph-dc-types">
        <thead>
          <tr>
            <th scope="col">Sale type</th>
            <th scope="col" className="num">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {daily.saleTypes.map((t) => (
            <tr key={t.key}>
              <th scope="row">{t.label}</th>
              <td className="num">{amount(t.paise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The printed Pharmacy Daily Collection. printedAt: when Print was pressed. */
export function DailyCollectionPaper({ daily, from, to, settings, printedAt }) {
  return (
    <PrintDocument className="bill-doc ph-doc ph-dc-doc">
      <PharmacyLetterhead settings={settings} />
      <h1 className="ph-dc-title">{daily.title}</h1>
      <p className="ph-dc-when">
        <span>{dcPeriod(from, to)}</span>
        <span>{printedAt}</span>
      </p>
      <DailyCollectionTable daily={daily} />
      <DailyCollectionEnd daily={daily} />
      <p className="bill-sign">Prepared by: ____________________ &nbsp; Checked by: ____________________</p>
    </PrintDocument>
  );
}

/** The Daily Collection as a file for Excel: every row with its section, the sub totals, then the money by mode. */
export function dailyCsv(daily, { from, to }) {
  const esc = (v) => {
    const text = v == null ? '' : String(v);
    const safe = /^[=+\-@]/.test(text) && !/^-?\d/.test(text) ? `'${text}` : text;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rupees = (p) => (p / 100).toFixed(2);
  const lines = [[daily.title, dcPeriod(from, to)], ['Section', 'Sr. No', 'Date', 'Sales no', 'MR No', 'Patient name', ...DC_MONEY.map(([, label]) => label)]];
  let sr = 0;
  for (const s of daily.sections) {
    for (const r of s.rows) lines.push([s.title, (sr += 1), dmy(r.date), r.saleNumber, r.mrn, r.name, ...DC_MONEY.map(([k]) => rupees(r[k]))]);
    lines.push([s.title, '', '', '', '', 'Sub total', ...DC_MONEY.map(([k]) => rupees(s.total[k]))]);
  }
  lines.push([], ['Mode', 'Sales', 'Sales return', 'Advance', 'Advance refund', 'Net']);
  for (const x of daily.modes) lines.push([DC_MODES[x.mode] ?? x.mode, rupees(x.salesPaise), rupees(x.returnPaise), rupees(x.advancePaise), rupees(x.advanceRefundPaise), rupees(x.netPaise)]);
  lines.push(['Net collection', '', '', '', '', rupees(daily.summary.netCollectionPaise)], [], ['Sale type', 'Total']);
  for (const t of daily.saleTypes) lines.push([t.label, rupees(t.paise)]);
  return `\uFEFF${lines.map((l) => l.map(esc).join(',')).join('\r\n')}\r\n`;
}

/** "Printed 24 Nov 2026, 09:53" – when the report was printed, at the right as on the earlier paper. */
const printedNow = () => `Printed ${formatDateTime(new Date())}`;

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
  const [summed, setSummed] = useState(false); // a Pharmacy MIS report shown as its day-by-day Summary
  // Sales collection (24 Nov 2026): the Pharmacy Daily Collection first; the list of payments one click away
  const [payments, setPayments] = useState(false);
  const loaded = res.data?.key === chosen.k ? res.data : null;
  const daily = !payments && loaded?.daily ? loaded.daily : null;
  const summary = chosen.tree === 'pharmacy' && loaded && !daily ? daySummary(loaded) : null;
  const r = summed && summary ? summary : loaded;
  const pick = (k) => {
    if (k === 'by-doctor') return openDoctorSales();
    const next = new URLSearchParams(params);
    next.set('report', k);
    return setParams(next, { replace: true });
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const canExcel = r && (admin || !r.patients);
  const period = r ? (r.from === r.to ? formatDate(r.from) : `${formatDate(r.from)} to ${formatDate(r.to)}`) : '';
  const printTitle = daily ? 'Pharmacy Daily Collection' : `${chosen.label}${uses('detail') ? (f.detail ? ' – detail' : ' – summary') : summary ? (summed ? ' – summary' : ' – details') : ''}`;
  const [printedAt, setPrintedAt] = useState('');
  const print = () => {
    setPrintedAt(printedNow());
    setPrinting(true);
  };
  const excel = () =>
    daily
      ? downloadFile(new Blob([dailyCsv(daily, r)], { type: 'text/csv;charset=utf-8' }), `daily-collection-${r.from}-to-${r.to}.csv`)
      : downloadFile(new Blob([misCsv(r)], { type: 'text/csv;charset=utf-8' }), `${chosen.k}-${r.from}-to-${r.to}.csv`);

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
                  <button type="button" className="btn btn-secondary btn-sm" onClick={excel}>
                    <FileSpreadsheet aria-hidden="true" /> Excel
                  </button>
                )}
                <button type="button" className="btn btn-primary btn-sm" onClick={print}>
                  <Printer aria-hidden="true" /> Print
                </button>
              </div>
            )}
          </div>
          <div className="ph-mis-fields">
            <label className="ph-mis-f">
              <span>From date</span>
              <DateText value={from} max={to} onChange={(v) => v && setFrom(v)} />
            </label>
            <label className="ph-mis-f">
              <span>To date</span>
              <DateText value={to} min={from} onChange={(v) => v && setTo(v)} />
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
            {loaded?.daily && (
              <div className="ph-mis-f">
                <span>Show</span>
                <div className="segmented" role="group" aria-label="Daily collection or payment list">
                  <button type="button" aria-pressed={!payments} onClick={() => setPayments(false)}>
                    Daily collection
                  </button>
                  <button type="button" aria-pressed={payments} onClick={() => setPayments(true)}>
                    Payment list
                  </button>
                </div>
              </div>
            )}
            {summary && (
              <div className="ph-mis-f">
                <span>{loaded?.daily ? 'Payments' : 'Show'}</span>
                <div className="segmented" role="group" aria-label="Details or summary">
                  <button type="button" aria-pressed={!summed} onClick={() => setSummed(false)}>
                    Details
                  </button>
                  <button type="button" aria-pressed={summed} onClick={() => setSummed(true)}>
                    Summary
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
          {r && daily && (
            <>
              <p className="hint ph-mis-period">{period} · Counter sales by how they were paid. Ward issues are on the hospital bill and are not listed.</p>
              <Summary
                items={[
                  { label: 'Net collection', paise: daily.summary.netCollectionPaise },
                  { label: 'Sales', paise: daily.summary.salesPaise },
                  { label: 'Sales return', paise: daily.summary.returnPaise },
                  { label: 'Credit sale', paise: daily.saleTypes.find((t) => t.key === 'credit-sale')?.paise ?? 0 },
                  ...(daily.summary.advanceUsedPaise ? [{ label: 'Advance used', paise: daily.summary.advanceUsedPaise }] : []),
                ]}
              />
              <div className="ph-grn-scroll ph-dc-scroll">
                <DailyCollectionTable daily={daily} />
              </div>
              <DailyCollectionEnd daily={daily} />
              {!admin && <p className="hint">Holds patient and customer names: print only what you need and keep the paper with the pharmacy records.</p>}
            </>
          )}
          {r && !daily && (
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

      {printing && r && daily && (
        <PrintPreview title="Pharmacy Daily Collection – print preview" hint="Print on A4 paper, landscape." page={{ size: 'A4 landscape', margin: '10mm 10mm 14mm' }} pageNumbers onClose={() => setPrinting(false)}>
          <DailyCollectionPaper daily={daily} from={r.from} to={r.to} settings={r.settings} printedAt={printedAt} />
        </PrintPreview>
      )}
      {printing && r && !daily && (
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
