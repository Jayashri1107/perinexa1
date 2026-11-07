import { Link, useSearchParams } from 'react-router-dom';
import { formatNumber } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, KpiCard, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { Baby, Thermometer, Hospital } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { isReportMonth, monthWords, thisMonth } from '../analytics/analyticsFormat.js';
import { SimpleTable } from '../quality/SimpleTable.jsx';
import { NICU_OUTCOMES, NICU_REASONS, NICU_SOURCES, NICU_UNITS } from './newbornCareRules.js';

// The NICU / SNCU admission and outcome register of a month (Clinical Requirements Group B, item 13 – NEO-L-05, DRAFT):
// each admission in register order with its outcome, and the month's totals. Doctors, RMOs and nurses.

export function NicuRegisterPage() {
  const [params, setParams] = useSearchParams();
  const month = isReportMonth(params.get('month')) ? params.get('month') : thisMonth();
  const { data, error, loading } = useFetch('/newborn-care/register', { month });
  const t = data?.month === month ? data.totals : null;
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Newborn follow-up', to: '/newborn-follow-up' }, { label: 'NICU register' }]} title="NICU / SNCU register" documentTitle="NICU register" subtitle="Every admission of the month in register order, with how it ended." />
      <div className="pf-content stack">
        <Alert type="error">{error}</Alert>
        <div className="row reg-toolbar">
          <Field label="Month" id="nr-month">
            <input id="nr-month" type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setParams({ month: e.target.value }, { replace: true })} />
          </Field>
        </div>
        <div className="kpi-grid">
          <KpiCard icon={Hospital} label="Admissions" value={t ? formatNumber(t.admissions) : '–'} sub={t ? `${t.inborn} inborn · ${t.outborn} outborn` : monthWords(month)} />
          <KpiCard icon={Baby} label="Still admitted" value={t ? formatNumber(t.stillAdmitted) : '–'} sub={t ? Object.entries(t.outcomes).map(([k, n]) => `${NICU_OUTCOMES[k]}: ${n}`).join(' · ') : undefined} />
          <KpiCard icon={Thermometer} tone={t?.cold ? 'watch' : 'neutral'} label="Cold at admission" value={t ? formatNumber(t.cold) : '–'} sub="Under 36.5 °C" />
        </div>
        <section className="card">
          <SimpleTable
            loading={loading && !data}
            rows={data?.month === month ? data.rows : []}
            emptyText={`No admissions in ${monthWords(month)}.`}
            columns={[
              { key: 'serial', header: 'No.', render: (r) => r.serial },
              { key: 'baby', header: 'Baby', render: (r) => <Link to={`/patients/${r.baby.id}/newborn-care`}>{`${r.baby.fullName} · ${r.baby.mrn}`}</Link> },
              { key: 'admitted', header: 'Admitted', render: (r) => `${formatDateTime(r.admittedAt)} · ${NICU_UNITS[r.unit]} · ${NICU_SOURCES[r.source]}` },
              { key: 'why', header: 'Why', render: (r) => r.reasons.map((k) => NICU_REASONS[k]).join(', ') },
              { key: 'weight', header: 'Weight, temperature', render: (r) => [r.weightGrams && `${r.weightGrams / 1000} kg`, r.temperatureC != null && `${r.temperatureC} °C${r.cold ? ' (cold)' : ''}`].filter(Boolean).join(' · ') || '–' },
              {
                key: 'outcome',
                header: 'Outcome',
                render: (r) =>
                  r.cancelled ? (
                    `Entered in error: ${r.cancelled.reason}`
                  ) : (
                    <StatusPill tone={r.outcome ? (r.outcome.result === 'died' ? 'inactive' : 'stable') : 'due'}>{r.outcome ? `${NICU_OUTCOMES[r.outcome.result]} · ${r.stayDays} days` : 'Admitted now'}</StatusPill>
                  ),
              },
            ]}
          />
        </section>
        <p className="muted small">DRAFT until the Lead Neonatologist compares it with the manual's register (NEO-L-05).</p>
      </div>
    </>
  );
}
