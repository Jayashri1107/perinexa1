import { useState } from 'react';
import { ChevronRight, FileSpreadsheet, Printer } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { downloadFile } from '../../components/print/pdfExport.js';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, formatDate } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PharmacyLetterhead, money } from './pharmacyUi.jsx';

// Pharmacy → Reports → Report list (13 Nov 2026, the developer, after the pharmacy's earlier software): every report in
// one list – sales and returns, GST, schedule drugs – and the one chosen beside it, as a table for the period above,
// with Print (A4 landscape) and, for the hospital admin or a report without patient names, a file for Excel.
// The reports are made on the server (server/src/pharmacy/misReports.js); keep the list in step with MIS_GROUPS there.

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

function MisTable({ report }) {
  return (
    <table className="bill-report ph-mis-table">
      <thead>
        <tr>
          {report.columns.map((c) => (
            <th key={c.k} scope="col" className={c.type === 'money' || c.type === 'num' ? 'num' : undefined}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {report.rows.map((r, i) => (
          <tr key={i}>
            {report.columns.map((c) => (
              <td key={c.k} className={c.type === 'money' || c.type === 'num' ? 'num' : undefined}>
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
            {report.columns.map((c, i) => (i === 0 ? <th key={c.k} scope="row">{report.total[c.k] ?? 'Total'}</th> : <td key={c.k} className={c.type === 'money' || c.type === 'num' ? 'num' : undefined}>{c.k in report.total ? misCell(c.type, report.total[c.k]) : ''}</td>))}
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

export function MisReports({ from, to, admin, pharmacist, openDoctorSales }) {
  const [params, setParams] = useSearchParams();
  const all = MIS_LIST.flatMap((g) => g.reports.map(([k]) => k));
  const chosen = all.includes(params.get('report')) && params.get('report') !== 'by-doctor' ? params.get('report') : 'sales';
  const res = useFetch('/pharmacy/reports/mis', { report: chosen, from, to });
  const [printing, setPrinting] = useState(false);
  const r = res.data?.key === chosen ? res.data : null;
  const pick = (k) => {
    if (k === 'by-doctor') return openDoctorSales();
    const next = new URLSearchParams(params);
    next.set('report', k);
    return setParams(next, { replace: true });
  };
  const canExcel = r && (admin || !r.patients);
  const title = MIS_LIST.flatMap((g) => g.reports).find(([k]) => k === chosen)[1];
  const period = r ? (r.from === r.to ? formatDate(r.from) : `${formatDate(r.from)} to ${formatDate(r.to)}`) : '';

  return (
    <div className="ph-mis">
      <nav className="card ph-mis-list" aria-label="Pharmacy reports">
        {MIS_LIST.map((g) => (
          <div key={g.title} className="ph-mis-group">
            <h2 className="ph-mis-group-title">{g.title}</h2>
            <ul>
              {g.reports
                .filter(([k]) => k !== 'by-doctor' || pharmacist)
                .map(([k, label]) => (
                  <li key={k}>
                    <button type="button" className={chosen === k ? 'ph-mis-item is-on' : 'ph-mis-item'} aria-current={chosen === k ? 'true' : undefined} onClick={() => pick(k)}>
                      <ChevronRight aria-hidden="true" />
                      {label}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </nav>

      <section className="card ph-mis-view" aria-labelledby="mis-title">
        <div className="ph-mis-head">
          <div>
            <h2 id="mis-title">{title}</h2>
            <p className="hint">{period}</p>
          </div>
          {r && (
            <div className="row">
              {canExcel && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadFile(new Blob([misCsv(r)], { type: 'text/csv;charset=utf-8' }), `${chosen}-${r.from}-to-${r.to}.csv`)}>
                  <FileSpreadsheet aria-hidden="true" /> Excel
                </button>
              )}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPrinting(true)}>
                <Printer aria-hidden="true" /> Print
              </button>
            </div>
          )}
        </div>
        {res.error && <Alert type="error">{res.error}</Alert>}
        {!r && !res.error && <p className="muted">Loading…</p>}
        {r && (
          <>
            {r.note && <p className="hint">{r.note}</p>}
            <Summary items={r.summary} />
            <div className="ph-grn-scroll">
              <MisTable report={r} />
            </div>
            {r.patients && !admin && <p className="hint">Holds patient and customer names: print only what you need and keep the paper with the pharmacy records.</p>}
          </>
        )}
      </section>

      {printing && r && (
        <PrintPreview title={`${title} – print preview`} hint="Print on A4 paper, landscape." page={{ size: 'A4 landscape', margin: '10mm' }} onClose={() => setPrinting(false)}>
          <PrintDocument className="bill-doc ph-doc ph-mis-doc">
            <PharmacyLetterhead settings={r.settings} />
            <h1 className="pdoc-title">{title}</h1>
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
