import { useState } from 'react';
import { Download, FileChartColumn, Printer } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Letterhead } from '../../components/print/Letterhead.jsx';
import { downloadFile } from '../../components/print/pdfExport.js';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { dayLabel } from '../appointments/appointmentFormat.js';
import { billingTabs, rupees } from './billingFormat.js';

// Billing → Reports (owner, 27 Oct 2026): the hospital's "OPD IPD MIS reports", as in its old billing software – a
// list by group on the left (OPD MIS, IPD MIS, Collection MIS); the chosen report for a range of days on the right,
// to print, save as a PDF or download for Excel. The server says which reports there are (routes/billing.js).

const todayIso = () => new Date().toLocaleDateString('en-CA'); // yyyy-mm-dd on this computer's clock
const monthStart = (iso) => `${iso.slice(0, 8)}01`;

/** A cell as shown: money in rupees, everything else as it is. */
const cellText = (c, v) => (c.money ? rupees(v ?? 0) : (v ?? ''));

/** The report as a spreadsheet (CSV, opens in Excel): never a formula, whatever a name begins with. */
export function reportCsv(report) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const money = (p) => ((p ?? 0) / 100).toFixed(2);
  const lines = [
    [report.title, `${report.from} to ${report.to}`],
    report.columns.map((c) => c.label),
    ...report.rows.map((r) => report.columns.map((c) => (c.money ? money(r[c.key]) : r[c.key]))),
  ];
  if (report.columns.some((c) => c.money)) lines.push(report.columns.map((c, i) => (c.money ? money(report.totals[c.key]) : i === 0 ? 'Total' : '')));
  return `﻿${lines.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

function ReportTable({ report }) {
  const hasTotals = report.columns.some((c) => c.money);
  return (
    <table className="bill-report mis-table">
      <thead>
        <tr>
          {report.columns.map((c) => (
            <th key={c.key} scope="col" className={c.money ? 'num' : undefined}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {report.rows.map((r, i) => (
          <tr key={i}>
            {report.columns.map((c) => (
              <td key={c.key} className={c.money ? 'num' : undefined}>
                {cellText(c, r[c.key])}
              </td>
            ))}
          </tr>
        ))}
        {!report.rows.length && (
          <tr>
            <td colSpan={report.columns.length} className="muted">
              Nothing in these days.
            </td>
          </tr>
        )}
        {hasTotals && report.rows.length > 0 && (
          <tr className="bill-report-total">
            {report.columns.map((c, i) => (
              <td key={c.key} className={c.money ? 'num' : undefined}>
                {c.money ? rupees(report.totals[c.key] ?? 0) : i === 0 ? <strong>Total</strong> : ''}
              </td>
            ))}
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function MisReportsPage() {
  const { activeMembership } = useAuth();
  const [params, setParams] = useSearchParams();
  const menu = useFetch('/billing/reports/mis/menu');
  const lh = useFetch('/tenant/settings/letterhead');
  const today = todayIso();
  const key = params.get('report') ?? 'daily-collection';
  const from = /^\d{4}-\d{2}-\d{2}$/.test(params.get('from') ?? '') ? params.get('from') : today;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(params.get('to') ?? '') ? params.get('to') : today;
  const res = useFetch('/billing/reports/mis', { report: key, from, to });
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState(null);
  const set = (changes) => setParams({ report: key, from, to, ...changes }, { replace: true });
  const report = res.data?.report;
  const saved = (as) => api('/billing/reports/mis/saved', { method: 'POST', body: { report: report.key, from: report.from, to: report.to, as } });
  const fileName = report ? `${report.title} ${report.from === report.to ? report.from : `${report.from} to ${report.to}`}` : '';
  const downloadExcel = async () => {
    setError(null);
    try {
      await saved('excel');
      downloadFile(new Blob([reportCsv(report)], { type: 'text/csv;charset=utf-8' }), `${fileName}.csv`);
    } catch (err) {
      setError(err.message);
    }
  };
  const period = report ? (report.from === report.to ? dayLabel(report.from) : `${dayLabel(report.from)} to ${dayLabel(report.to)}`) : '';

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Billing', to: '/billing' }, { label: 'Reports' }]}
        title="Reports"
        tabs={billingTabs(activeMembership.roles)}
        actions={
          report && (
            <>
              <button type="button" className="btn btn-secondary" onClick={downloadExcel}>
                <Download aria-hidden="true" /> Download Excel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setPrinting(true)}>
                <Printer aria-hidden="true" /> Print or download PDF
              </button>
            </>
          )
        }
      />
      <div className="pf-content mis-layout">
        <nav className="card mis-menu" aria-label="Reports">
          {(menu.data?.menu ?? []).map((g) => (
            <section key={g.group}>
              <h2>{g.group}</h2>
              <ul>
                {g.reports.map((r) => (
                  <li key={r.key}>
                    <button type="button" className={r.key === key ? 'active' : ''} aria-current={r.key === key ? 'page' : undefined} onClick={() => set({ report: r.key })}>
                      <FileChartColumn aria-hidden="true" /> {r.label}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
        <section className="card mis-body" aria-labelledby="mis-title">
          <h2 id="mis-title">{report?.title ?? 'Report'}</h2>
          <div className="mis-dates" role="group" aria-label="Days">
            <label>
              <span className="field-label">From</span>
              <input type="date" value={from} max={to} onChange={(e) => e.target.value && set({ from: e.target.value })} />
            </label>
            <label>
              <span className="field-label">To</span>
              <input type="date" value={to} min={from} onChange={(e) => e.target.value && set({ to: e.target.value })} />
            </label>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => set({ from: today, to: today })}>
              Today
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => set({ from: monthStart(today), to: today })}>
              This month
            </button>
          </div>
          {key === 'credit-report' && <p className="hint">Every bill with money still to come, whatever its date.</p>}
          {key === 'ipd-admitted-now' && <p className="hint">The patients in hospital now, whatever the days chosen.</p>}
          {key === 'discharge-typewise' && <p className="hint">By how the patient was admitted: planned, emergency or day care.</p>}
          <Alert type="error">{error ?? res.error ?? menu.error}</Alert>
          {res.loading && !report && <p className="muted">Loading…</p>}
          {report && (
            <div className="table-scroll">
              <ReportTable report={report} />
            </div>
          )}
        </section>
      </div>
      {printing && report && (
        <PrintPreview
          title={`${report.title} – print preview`}
          hint="Print it, or save it as a PDF."
          pdf={{ fileName: `${fileName}.pdf`, title: fileName, share: false, onSaved: () => saved('pdf') }}
          docKey={lh.data ? `${report.key}-${report.from}-${report.to}` : null}
          pageNumbers
          onClose={() => setPrinting(false)}
        >
          <PrintDocument className="bill-doc bill-daily-doc">
            {lh.data?.letterhead && <Letterhead letterhead={lh.data.letterhead} centered />}
            <div className="bill-doc-titlebar">
              <h1 className="pdoc-title">{report.title}</h1>
              <span className="pdoc-small">Print date {formatDateTime(new Date())}</span>
            </div>
            <p className="mis-period">{period}</p>
            <ReportTable report={report} />
          </PrintDocument>
        </PrintPreview>
      )}
    </>
  );
}
