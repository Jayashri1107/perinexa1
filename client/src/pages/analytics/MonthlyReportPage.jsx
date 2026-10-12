import { useState } from 'react';
import { Printer } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { ColumnChart, columnSummary } from '../../components/charts/ColumnChart.jsx';
import { formatNumber } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Letterhead } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { analyticsTabs, isReportMonth, monthWords, thisMonth } from './analyticsFormat.js';

// Analytics → Monthly report (doctors only; server/src/routes/analytics.js): the month's numbers in the order of
// the government's HMIS monthly form, to type into the HMIS portal or print, and the last 12 months as charts for
// the owner (one series per chart). Counts only, never a name. Moved here from Registers on 2 Oct 2026.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortMonth = (key) => {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};

function ReportTables({ report }) {
  return report.sections.map((s) => (
    <section key={s.key} className="card rep-section" aria-labelledby={`rep-${s.key}`}>
      <h2 id={`rep-${s.key}`}>{s.title}</h2>
      <table className="rep-table">
        <tbody>
          {s.rows.map((r) => (
            <tr key={r.key} className={r.sub ? 'rep-sub' : undefined}>
              <th scope="row">{r.label}</th>
              <td className="tabular">{formatNumber(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  ));
}

function ReportPrint({ report, onClose }) {
  const { user } = useAuth();
  const lh = useFetch('/tenant/settings/letterhead');
  const [printedAt] = useState(() => new Date());
  const title = `Monthly report – ${monthWords(report.month)}`;
  return (
    <PrintPreview title={title} hint="Check the page, then print it on A4 paper." onClose={onClose}>
      <PrintDocument footer={<span>{title} · printed {formatDateTime(printedAt)} by {user.name}</span>}>
        {lh.data?.letterhead && <Letterhead letterhead={lh.data.letterhead} />}
        <h1 className="pdoc-title">{title}</h1>
        {report.sections.map((s) => (
          <div key={s.key}>
            <h2>{s.title}</h2>
            <table className="ptable">
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.key}>
                    <td style={r.sub ? { paddingLeft: '1.5em' } : undefined}>{r.label}</td>
                    <td className="tabular">{formatNumber(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {report.notes?.map((n) => (
          <p key={n} className="pdoc-small">
            {n}
          </p>
        ))}
        <p className="pdoc-small">From the records in Perinexa as they are now. Check each row against the current HMIS data items before entering it.</p>
      </PrintDocument>
    </PrintPreview>
  );
}

export function MonthlyReportPage() {
  const [params, setParams] = useSearchParams();
  const month = isReportMonth(params.get('month')) ? params.get('month') : thisMonth();
  const { data, error, loading } = useFetch('/analytics/report/monthly', { month });
  const trend = useFetch('/analytics/report/trend', { month });
  const [printing, setPrinting] = useState(false);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Analytics', to: '/analytics' }, { label: 'Monthly report' }]}
        title="Monthly report"
        documentTitle="Monthly report"
        help="The month's numbers in the order of the HMIS monthly form – to type into the HMIS portal or print – and the last 12 months as charts. Counts only."
        tabs={analyticsTabs('/analytics', '', { ask: true, report: true })}
      />
      <div className="pf-content">
        <Alert type="error">{error ?? trend.error}</Alert>
        <div className="row reg-toolbar">
          <Field label="Month" id="rep-month">
            <input id="rep-month" type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setParams({ month: e.target.value }, { replace: true })} />
          </Field>
          <button type="button" className="btn btn-secondary" disabled={!data} onClick={() => setPrinting(true)}>
            <Printer aria-hidden="true" /> Print the report
          </button>
        </div>
        {month === thisMonth() && <p className="hint">This month is not over yet: the numbers grow until its last day.</p>}
        {loading && !data && <p className="muted">Loading…</p>}
        {data?.month === month && (
          <>
            <div className="rep-grid">
              <ReportTables report={data} />
            </div>
            {data.notes?.map((n) => (
              <p key={n} className="hint">
                {n}
              </p>
            ))}
          </>
        )}
        {trend.data && (
          <>
            <h2 className="rep-charts-title">The last 12 months</h2>
            <div className="rep-charts">
              {trend.data.series.map((s) => {
                const columns = trend.data.months.map((k, i) => ({ key: k, label: shortMonth(k), value: s.values[i] }));
                const total = s.values.reduce((a, b) => a + b, 0);
                return (
                  <section key={s.key} className="card" aria-labelledby={`rep-chart-${s.key}`}>
                    <h3 id={`rep-chart-${s.key}`}>{s.label}</h3>
                    <ColumnChart columns={columns} summary={columnSummary(s.label, columns, total)} labelHeader="Month" valueHeader={s.label} />
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>
      {printing && data && <ReportPrint report={data} onClose={() => setPrinting(false)} />}
    </>
  );
}
