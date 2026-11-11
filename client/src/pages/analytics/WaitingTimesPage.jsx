import { useSearchParams } from 'react-router-dom';
import { FilterSelect, formatNumber } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { analyticsTabs } from './analyticsFormat.js';
import { WAIT_PERIOD_OPTIONS, WEEKDAY_WORDS, hourWords, timeCell } from './waitingFormat.js';

// Analytics → Waiting times (owner's decisions of 10 Nov 2026 – docs/PATIENT_FLOW_PLAN.md section 6;
// server/src/analytics/waitingTimes.js). How long each stage of an outpatient's day takes: the usual time (median) and
// the slow time (9 of 10 visits are within it), by hour of arrival, by weekday and by month. Stages only – never a
// person. Doctors: exact numbers for the patients they may see. Hospital admins and the super admin: whole finished
// months, numbers only, "Too few visits to show" below the minimum. platform: the super admin's page (per hospital).

export function WaitingTimesPage({ platform = false }) {
  const [params, setParams] = useSearchParams();
  const hospital = params.get('hospital') ?? 'all';
  const hospitals = useFetch(platform ? '/platform/analytics/hospitals' : null);
  const { data, error, loading } = useFetch(platform ? '/platform/analytics/waiting-times' : '/analytics/waiting-times', {
    period: params.get('period') ?? '',
    ...(platform ? { hospital } : {}),
  });
  const doctor = data?.audience === 'doctor';
  const periods = WAIT_PERIOD_OPTIONS.filter((o) => doctor || !o.doctorOnly);
  const set = (k, v) => setParams((p) => ({ ...Object.fromEntries(p), [k]: v }), { replace: true });
  const base = platform ? '/platform/analytics' : '/analytics';
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Analytics', to: base }, { label: 'Waiting times' }]}
        title="Waiting times"
        documentTitle="Analytics – waiting times"
        help="How long each stage of an outpatient's day takes, from the times the computer notes as staff work. Stages only – never a person."
        tabs={analyticsTabs(base, '', platform ? { waiting: true, pharmacyDoctors: true } : { ask: true, report: doctor, waiting: true })}
      />
      <div className="pf-content an-page">
        <Alert type="error">{error}</Alert>
        <div className="an-filters">
          <div className="an-filter">
            <FilterSelect label="Period" value={data?.period?.key ?? ''} onChange={(v) => set('period', v)} options={periods} allLabel={null} />
            {data?.period && <span className="an-caption">{data.period.label}</span>}
          </div>
          {platform && (
            <div className="an-filter">
              <FilterSelect
                label="Hospital"
                value={hospital}
                onChange={(v) => set('hospital', v)}
                options={[{ value: 'all', label: 'All hospitals' }, ...(hospitals.data?.hospitals ?? []).map((h) => ({ value: h.id, label: h.name }))]}
                allLabel={null}
              />
            </div>
          )}
        </div>
        {loading && !data && <p className="muted">Loading…</p>}
        {/* The analytics grid, as on the other Analytics pages: the cards were stacked full width with no gap between
            them; now each stage table across the top, the three "whole visit" tables side by side under it */}
        {data && (
          <div className="an-grid wt-grid">
            <section className="panel an-card an-wide" aria-labelledby="wt-stages">
              <header className="an-card-head">
                <h2 id="wt-stages">Each stage</h2>
                <p className="t-caption muted">
                  {formatNumber(data.visits)} OPD visits{doctor ? ' of the patients you may see' : ' (rounded to 5)'}. Usual = half the visits took less; slow = 9 of 10 took less.
                </p>
              </header>
              <div className="an-card-body an-table-wrap">
                <table className="dt an-table">
                  <caption className="sr-only">The usual and slow time of each stage</caption>
                  <thead>
                    <tr>
                      <th scope="col">Stage</th>
                      <th scope="col" className="num">
                        Usual
                      </th>
                      <th scope="col" className="num">
                        Slow
                      </th>
                      <th scope="col" className="num">
                        Visits
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stages.map((s) => (
                      <tr key={s.key}>
                        <th scope="row">
                          {s.label}
                          {data.longest === s.key && (
                            <>
                              {' '}
                              <StatusPill tone="watch">Longest wait</StatusPill>
                            </>
                          )}
                        </th>
                        <td className="num tabular">{timeCell(s, 'median')}</td>
                        <td className="num tabular">{timeCell(s, 'p90')}</td>
                        <td className="num tabular">{s.tooFew ? '—' : formatNumber(s.n)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {[
              ['wt-hour', 'Whole visit by hour of arrival', data.byHour, (c) => hourWords(c.key)],
              ['wt-day', 'Whole visit by day of the week', data.byWeekday, (c) => WEEKDAY_WORDS[c.key]],
              ['wt-month', 'Whole visit by month', data.byMonth, (c) => c.label],
            ].map(([id, title, cells, label]) => (
              <section key={id} className="panel an-card" aria-labelledby={id}>
                <header className="an-card-head">
                  <h2 id={id}>{title}</h2>
                </header>
                <div className="an-card-body an-table-wrap">
                  {cells.length === 0 ? (
                    <p className="muted">No visits with an arrival time in this period.</p>
                  ) : (
                    <table className="dt an-table">
                      <thead>
                        <tr>
                          <th scope="col">When</th>
                          <th scope="col" className="num">
                            Usual
                          </th>
                          <th scope="col" className="num">
                            Slow
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {cells.map((c) => (
                          <tr key={c.key}>
                            <th scope="row">{label(c)}</th>
                            <td className="num tabular">{timeCell(c, 'median')}</td>
                            <td className="num tabular">{timeCell(c, 'p90')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            ))}

            {platform && data.hospitals?.length > 1 && (
              <section className="panel an-card an-wide" aria-labelledby="wt-hospitals">
                <header className="an-card-head">
                  <h2 id="wt-hospitals">Usual time by hospital</h2>
                </header>
                <div className="an-card-body an-table-wrap">
                  <table className="dt an-table">
                    <thead>
                      <tr>
                        <th scope="col">Hospital</th>
                        <th scope="col" className="num">
                          Visits
                        </th>
                        {data.stages.map((s) => (
                          <th key={s.key} scope="col" className="num">
                            {s.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.hospitals.map((h) => (
                        <tr key={h.id}>
                          <th scope="row">{h.name}</th>
                          <td className="num tabular">{formatNumber(h.visits)}</td>
                          {h.stages.map((s) => (
                            <td key={s.key} className="num tabular">
                              {timeCell(s, 'median')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="panel an-card an-wide" aria-labelledby="wt-complete">
              <header className="an-card-head">
                <h2 id="wt-complete">How complete these numbers are</h2>
              </header>
              <div className="an-card-body">
                <ul className="an-list">
                  <li>
                    Arrival time known: <strong className="tabular">{data.completeness.arrivalMarked ?? '—'}%</strong> of visits (reception presses “Mark arrived”, or she was registered that day)
                  </li>
                  <li>
                    Finished the same day: <strong className="tabular">{data.completeness.finishedSameDay ?? '—'}%</strong> (prescription printed, saved or sent, or the visit signed)
                  </li>
                  <li>
                    Medicines from the pharmacy: <strong className="tabular">{data.completeness.withSale ?? '—'}%</strong>
                  </li>
                </ul>
                <p className="hint help">A low share means that stage is measured on few visits. Times are noted from 10 Nov 2026 on; earlier visits have no RMO, doctor or vitals times.</p>
              </div>
            </section>
          </div>
        )}
      </div>
    </>
  );
}
