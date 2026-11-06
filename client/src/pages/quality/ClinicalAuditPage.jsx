import { Link, useSearchParams } from 'react-router-dom';
import { DataTable, formatNumber } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { isReportMonth, thisMonth } from '../analytics/analyticsFormat.js';
import { ROBSON_GROUPS } from '../inpatient/robson.js';
import { QUALITY_TABS } from './qualityFormat.js';

// Clinical audit → Deliveries (Clinical Requirements Group A, items 1 and 2): the month's Robson ten-group table and
// its caesareans with category and decision-to-delivery interval (server/src/routes/clinicalAudit.js). Doctors and
// RMOs see each caesarean; the quality lead and the hospital admin see the numbers only. DRAFT rules.

const pct = (v) => (v == null ? '—' : `${v}%`);

export function ClinicalAuditPage() {
  const [params, setParams] = useSearchParams();
  const month = isReportMonth(params.get('month')) ? params.get('month') : thisMonth();
  const robson = useFetch('/clinical-audit/robson', { month });
  const cs = useFetch('/clinical-audit/caesareans', { month });
  const rows = robson.data ? [...robson.data.rows.map((r) => ({ ...r, id: String(r.group) })), { id: 'none', group: null, ...robson.data.unclassified }] : [];

  return (
    <>
      <PageHeader title="Clinical audit" documentTitle="Clinical audit" help="Robson ten-group table and caesarean decision-to-delivery times of the confirmed delivery notes. DRAFT rules until the Lead Obstetrician confirms them." tabs={QUALITY_TABS} />
      <div className="pf-content">
        <Alert type="error">{robson.error ?? cs.error}</Alert>
        <div className="row reg-toolbar">
          <Field label="Month" id="ca-month">
            <input id="ca-month" type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setParams({ month: e.target.value }, { replace: true })} />
          </Field>
        </div>
        <section className="card" aria-labelledby="ca-robson">
          <h2 id="ca-robson">Robson ten-group table</h2>
          {robson.data && (
            <p className="hint">
              {formatNumber(robson.data.women)} women delivered, {formatNumber(robson.data.caesareans)} by caesarean ({pct(robson.data.caesareanRate)}). Source: {robson.data.source}.
            </p>
          )}
          <DataTable
            loading={robson.loading && !robson.data}
            rows={rows}
            emptyText="No confirmed delivery notes this month."
            columns={[
              { key: 'group', header: 'Group', render: (r) => (r.group ? <span title={ROBSON_GROUPS[r.group]}>{r.group}</span> : 'Not classified') },
              { key: 'women', header: 'Women', align: 'right', render: (r) => formatNumber(r.women) },
              { key: 'caesareans', header: 'Caesareans', align: 'right', render: (r) => formatNumber(r.caesareans) },
              { key: 'groupSize', header: 'Group size', align: 'right', render: (r) => (r.group ? pct(r.groupSize) : '—') },
              { key: 'caesareanRate', header: 'Caesarean rate in group', align: 'right', render: (r) => (r.group ? pct(r.caesareanRate) : '—') },
              { key: 'absoluteContribution', header: 'Absolute contribution', align: 'right', render: (r) => (r.group ? pct(r.absoluteContribution) : '—') },
              { key: 'relativeContribution', header: 'Relative contribution', align: 'right', render: (r) => (r.group ? pct(r.relativeContribution) : '—') },
            ]}
          />
          <p className="hint">Not classified: a note confirmed before the Robson details were asked for, or with details missing.</p>
        </section>
        <section className="card" aria-labelledby="ca-cs">
          <h2 id="ca-cs">Caesareans – decision to delivery</h2>
          {cs.data && (
            <p className="hint">
              {formatNumber(cs.data.total)} caesareans. Targets: category 1 within {cs.data.targets[1]} minutes, category 2 within {cs.data.targets[2]} minutes. Source: {cs.data.source}.
            </p>
          )}
          {cs.data && (
            <ul className="plain-list">
              {cs.data.byCategory.map((c) => (
                <li key={String(c.category)}>
                  {c.category ? `Category ${c.category}` : 'Category not recorded'}: {formatNumber(c.count)}
                  {c.overTarget ? ` · ${formatNumber(c.overTarget)} over the target` : ''}
                </li>
              ))}
            </ul>
          )}
          {cs.data?.list && (
            <DataTable
              rows={cs.data.list.map((x) => ({ ...x, id: x.documentId }))}
              emptyText="No caesareans this month."
              columns={[
                { key: 'deliveredAt', header: 'Delivered', render: (r) => formatDateTime(r.deliveredAt) },
                { key: 'patient', header: 'Patient', render: (r) => <Link to={`/patients/${r.patientId}/stays/${r.admissionId}/docs/${r.documentId}`}>{`${r.fullName} · ${r.mrn}`}</Link> },
                { key: 'category', header: 'Category', render: (r) => r.category ?? '—' },
                { key: 'robsonGroup', header: 'Robson', render: (r) => r.robsonGroup ?? '—' },
                {
                  key: 'minutes',
                  header: 'Decision to delivery',
                  render: (r) =>
                    r.minutes == null ? (
                      'Not recorded'
                    ) : (
                      <StatusPill tone={r.red ? 'high' : r.overTarget ? 'watch' : 'stable'}>
                        {r.minutes} min{r.red ? ' – over 30' : r.overTarget ? ' – over target' : ''}
                      </StatusPill>
                    ),
                },
              ]}
            />
          )}
        </section>
      </div>
    </>
  );
}
