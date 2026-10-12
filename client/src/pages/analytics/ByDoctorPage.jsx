import { useSearchParams } from 'react-router-dom';
import { FilterSelect, formatNumber } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PERIOD_OPTIONS, analyticsTabs } from './analyticsFormat.js';

// Analytics → By doctor (doctors only; server/src/routes/analytics.js): the headline numbers of Overview, worked out
// for each doctor's own patients, with the whole hospital in the last row. Counts only, never a name of a patient.

const PERIODS = PERIOD_OPTIONS.doctor.filter((o) => o.value !== 'custom');

export function ByDoctorPage() {
  const [params, setParams] = useSearchParams();
  const period = PERIODS.some((o) => o.value === params.get('period')) ? params.get('period') : '12m';
  const { data, error, loading } = useFetch('/analytics/doctors', { period });
  const columns = data?.columns ?? [];
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Analytics', to: '/analytics' }, { label: 'By doctor' }]}
        title="By doctor"
        documentTitle="Analytics by doctor"
        help="The headline numbers for each doctor's own patients, and for the whole hospital. Counts only."
        tabs={analyticsTabs('/analytics', '', { ask: true, report: true })}
      />
      <div className="pf-content an-page">
        <Alert type="error">{error}</Alert>
        <div className="an-filters">
          <div className="an-filter">
            <FilterSelect label="Period" value={period} onChange={(v) => setParams({ period: v }, { replace: true })} options={PERIODS} allLabel={null} />
            {data?.period?.label && <span className="an-caption">{data.period.label}</span>}
          </div>
        </div>
        {loading && !data && <p className="muted">Loading…</p>}
        {data && data.doctors.length === 0 && <section className="card">This hospital has no doctors yet.</section>}
        {data && data.doctors.length > 0 && (
          <section className="panel an-card an-wide" aria-labelledby="an-by-doctor">
            <header className="an-card-head">
              <h2 id="an-by-doctor">Numbers for each doctor's patients</h2>
            </header>
            <div className="an-card-body">
              <div className="an-table-wrap">
                <table className="dt an-table an-doctor-table">
                  <caption className="sr-only">Headline numbers for each doctor's patients</caption>
                  <thead>
                    <tr>
                      <th scope="col">Doctor</th>
                      {columns.map((c) => (
                        <th key={c.ref} scope="col" className="num">
                          {c.label}
                          <span className="t-caption muted an-doctor-when">{c.window === 'now' ? 'today' : 'in the period'}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.doctors.map((d) => (
                      <tr key={d.id}>
                        <th scope="row">
                          {d.name}
                          {d.you ? ' (you)' : ''}
                          {!d.active && <span className="t-caption muted"> · no longer at this hospital</span>}
                        </th>
                        {d.values.map((v, i) => (
                          <td key={columns[i].ref} className="num tabular">
                            {formatNumber(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr className="an-group-row">
                      <th scope="row">Whole hospital</th>
                      {data.hospital.map((v, i) => (
                        <td key={columns[i].ref} className="num tabular">
                          <strong>{formatNumber(v)}</strong>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="hint">
                A patient counts for the doctor she is assigned to; a baby also counts for its mother's doctor. Visits are the visits of that doctor's
                patients, whoever saw them. Patients with no doctor are only in the whole-hospital row, so the rows need not add up to it.
              </p>
              {data.leftOut > 0 && (
                <p className="hint">
                  Leaves out {formatNumber(data.leftOut)} sensitive record{data.leftOut === 1 ? '' : 's'} of other doctors.
                </p>
              )}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
