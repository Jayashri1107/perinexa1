import { useState } from 'react';
import { BedDouble, ChevronDown, Download, FileChartColumn, Printer, Search, Stethoscope, Wallet } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Letterhead } from '../../components/print/Letterhead.jsx';
import { downloadFile } from '../../components/print/pdfExport.js';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, KpiCard, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { addDaysIso, dayLabel } from '../appointments/appointmentFormat.js';
import { billingTabs, rupees } from './billingFormat.js';

// Billing → Reports (owner, 27 Oct 2026): the hospital's "OPD IPD MIS reports", as in its old billing software – a
// list by group on the left (OPD MIS, IPD MIS, Collection MIS) with a search; the chosen report on the right with the
// days (quick choices or from–to), its totals at a glance, a filter over its rows, and Print / PDF / Excel. The server
// says which reports there are and what each shows (server/src/billing/misReports.js).

const todayIso = () => new Date().toLocaleDateString('en-CA'); // yyyy-mm-dd on this computer's clock
const monthStart = (iso) => `${iso.slice(0, 8)}01`;
/** The Monday of the week of this day. */
const weekStart = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return addDaysIso(iso, -((d.getUTCDay() + 6) % 7));
};
const lastMonth = (iso) => {
  const end = addDaysIso(monthStart(iso), -1);
  return [monthStart(end), end];
};
const GROUP_ICONS = { 'OPD MIS': Stethoscope, 'IPD MIS': BedDouble, 'Collection MIS': Wallet };
/** Quick choices of days: [label, from, to]. */
const presets = (today) => [
  ['Today', today, today],
  ['Yesterday', addDaysIso(today, -1), addDaysIso(today, -1)],
  ['This week', weekStart(today), today],
  ['This month', monthStart(today), today],
  ['Last month', ...lastMonth(today)],
];

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

/** The rows a filter leaves (any cell containing the words typed). */
export const filterRows = (report, text) => {
  const q = text.trim().toLowerCase();
  if (!q) return report.rows;
  return report.rows.filter((r) => report.columns.some((c) => String(cellText(c, r[c.key])).toLowerCase().includes(q)));
};

function ReportTable({ report, rows = report.rows, totals = report.totals }) {
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
        {rows.map((r, i) => (
          <tr key={i}>
            {report.columns.map((c) => (
              <td key={c.key} className={c.money ? 'num' : undefined}>
                {cellText(c, r[c.key])}
              </td>
            ))}
          </tr>
        ))}
        {!rows.length && (
          <tr>
            <td colSpan={report.columns.length} className="mis-empty">
              {report.rows.length ? 'No rows match the filter.' : 'Nothing in these days. Choose other days above.'}
            </td>
          </tr>
        )}
      </tbody>
      {hasTotals && rows.length > 0 && (
        <tfoot>
          <tr className="bill-report-total">
            {report.columns.map((c, i) => (
              <td key={c.key} className={c.money ? 'num' : undefined}>
                {c.money ? rupees(totals[c.key] ?? 0) : i === 0 ? <strong>Total</strong> : ''}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
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
  const [find, setFind] = useState(''); // the list of reports
  const [filter, setFilter] = useState(''); // the rows of the report
  const [closed, setClosed] = useState({}); // groups folded by hand
  const set = (changes) => {
    setFilter('');
    setParams({ report: key, from, to, ...changes }, { replace: true });
  };
  const report = res.data?.report;
  const rows = report ? filterRows(report, filter) : [];
  const moneyCols = report ? report.columns.filter((c) => c.money) : [];
  const totals = report && filter ? Object.fromEntries(moneyCols.map((c) => [c.key, rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0)])) : report?.totals;
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
  const activePreset = presets(today).find(([, a, b]) => a === from && b === to)?.[0];
  const q = find.trim().toLowerCase();
  const groups = (menu.data?.menu ?? []).map((g) => ({ ...g, reports: g.reports.filter((r) => !q || r.label.toLowerCase().includes(q)) })).filter((g) => g.reports.length);
  const datesMatter = !['credit-report', 'ipd-admitted-now'].includes(key);

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
          <label className="mis-find">
            <Search aria-hidden="true" />
            <span className="sr-only">Find a report</span>
            <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a report…" />
          </label>
          {groups.map((g) => {
            const Icon = GROUP_ICONS[g.group] ?? FileChartColumn;
            const open = q ? true : !closed[g.group];
            return (
              <section key={g.group} className="mis-group">
                <button type="button" className="mis-group-head" aria-expanded={open} onClick={() => setClosed({ ...closed, [g.group]: open })}>
                  <Icon aria-hidden="true" />
                  <span>{g.group}</span>
                  <span className="mis-count">{g.reports.length}</span>
                  <ChevronDown className={`mis-chevron ${open ? 'is-open' : ''}`} aria-hidden="true" />
                </button>
                {open && (
                  <ul>
                    {g.reports.map((r) => (
                      <li key={r.key}>
                        <button type="button" className={r.key === key ? 'active' : ''} aria-current={r.key === key ? 'page' : undefined} onClick={() => set({ report: r.key })}>
                          {r.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          {!groups.length && <p className="muted mis-none">No report by that name.</p>}
        </nav>

        <div className="mis-main">
          <section className="card mis-head" aria-labelledby="mis-title">
            <div>
              <h2 id="mis-title">{report?.title ?? 'Report'}</h2>
              {report?.description && <p className="mis-desc">{report.description}</p>}
            </div>
            <div className="mis-dates">
              <div className="segmented" role="group" aria-label="Quick choice of days">
                {presets(today).map(([label, a, b]) => (
                  <button key={label} type="button" aria-pressed={activePreset === label} onClick={() => set({ from: a, to: b })}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="mis-range" role="group" aria-label="Days">
                <label>
                  <span className="field-label">From</span>
                  <input type="date" value={from} max={to} onChange={(e) => e.target.value && set({ from: e.target.value })} />
                </label>
                <label>
                  <span className="field-label">To</span>
                  <input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && set({ to: e.target.value })} />
                </label>
              </div>
            </div>
            {!datesMatter && <p className="hint">{key === 'credit-report' ? 'Every bill with money still to come, whatever its date.' : 'The patients in hospital now, whatever the days chosen.'}</p>}
          </section>

          <Alert type="error">{error ?? res.error ?? menu.error}</Alert>

          {report && (
            <div className="kpi-grid mis-kpis">
              <KpiCard tone="brand" icon={FileChartColumn} label={filter ? 'Rows shown' : 'Rows'} value={filter ? `${rows.length} of ${report.rows.length}` : report.rows.length} sub={period} />
              {moneyCols.slice(-3).map((c) => (
                <KpiCard key={c.key} tone={/refund|due|balance/i.test(c.label) ? 'watch' : 'stable'} icon={Wallet} label={`Total ${c.label.toLowerCase()}`} value={rupees(totals[c.key] ?? 0)} />
              ))}
            </div>
          )}

          <section className="card mis-body" aria-label="The report">
            <div className="mis-toolbar">
              <label className="dc-search">
                <Search aria-hidden="true" />
                <span className="sr-only">Filter the rows</span>
                <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter: name, number, doctor…" />
              </label>
              {report && <span className="muted">{period}</span>}
            </div>
            {res.loading && !report && <p className="muted">Loading…</p>}
            {report && (
              <div className="table-scroll mis-scroll">
                <ReportTable report={report} rows={rows} totals={totals} />
              </div>
            )}
          </section>
        </div>
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
            <p className="mis-period">
              {period} · {report.rows.length} {report.rows.length === 1 ? 'row' : 'rows'}
            </p>
            <ReportTable report={report} />
          </PrintDocument>
        </PrintPreview>
      )}
    </>
  );
}
