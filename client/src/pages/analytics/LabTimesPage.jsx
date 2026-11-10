import { useSearchParams } from 'react-router-dom';
import { FilterSelect, formatNumber } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { departmentName } from '../lab/labFormat.js';
import { analyticsTabs } from './analyticsFormat.js';
import { WAIT_PERIOD_OPTIONS, WEEKDAY_WORDS, hourWords, timeCell } from './waitingFormat.js';

// Analytics → Lab times (P9 of docs/LAB_BUILD_NOTE.md; server/src/analytics/labTimes.js). How long lab orders take:
// order to sample, sample to report, report to the doctor's review, and the whole – the usual time (median) and the
// slow time (9 of 10 within it), and the share reported after their due time. By urgency, lab department, hour and
// day of the order, and month. Stages only – never a technician or a doctor. Doctors: exact numbers for the patients
// they may see. Hospital admins and the super admin: whole finished months, numbers only, "Too few" below the minimum.

const lateWords = (s) => (s?.tooFew ? 'Too few orders to show' : s?.late == null ? '—' : `${s.late}%`);
const tooFewOrders = (cell, which) => (cell.tooFew ? 'Too few orders to show' : timeCell(cell, which));

function TimesTable({ id, caption, first, rows, label }) {
  return (
    <table className="dt an-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{first}</th>
          <th scope="col" className="num">
            Usual
          </th>
          <th scope="col" className="num">
            Slow
          </th>
          <th scope="col" className="num">
            Late
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.key}>
            <th scope="row">{label(c)}</th>
            <td className="num tabular">{tooFewOrders(c, 'median')}</td>
            <td className="num tabular">{tooFewOrders(c, 'p90')}</td>
            <td className="num tabular">{lateWords(c.lateShare)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LabTimesPage({ platform = false }) {
  const [params, setParams] = useSearchParams();
  const hospital = params.get('hospital') ?? 'all';
  const hospitals = useFetch(platform ? '/platform/analytics/hospitals' : null);
  const { data, error, loading } = useFetch(platform ? '/platform/analytics/lab-times' : '/analytics/lab-times', {
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
        breadcrumbs={[{ label: 'Analytics', to: base }, { label: 'Lab times' }]}
        title="Lab times"
        documentTitle="Analytics – lab times"
        help="How long lab orders take, from the times the computer notes as staff work. Stages only – never a person."
        tabs={analyticsTabs(base, '', platform ? { waiting: true } : { ask: true, report: doctor, waiting: true })}
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
        {data && (
          <div className="an-grid wt-grid">
            <section className="panel an-card an-wide" aria-labelledby="lt-stages">
              <header className="an-card-head">
                <h2 id="lt-stages">Each stage</h2>
                <p className="t-caption muted">
                  {formatNumber(data.orders)} lab orders{doctor ? ' of the patients you may see' : ' (rounded to 5)'}. Usual = half the orders took less; slow = 9 of 10 took less. Reported after
                  the due time: <strong className="tabular">{lateWords(data.late)}</strong>.
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
                        Orders
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stages.map((s) => (
                      <tr key={s.key}>
                        <th scope="row">{s.label}</th>
                        <td className="num tabular">{tooFewOrders(s, 'median')}</td>
                        <td className="num tabular">{tooFewOrders(s, 'p90')}</td>
                        <td className="num tabular">{s.tooFew ? '—' : formatNumber(s.n)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {[
              ['lt-urgency', 'Order to report: routine and urgent', 'Orders', data.byUrgency, (c) => c.label],
              ['lt-dept', 'Order to report by lab department', 'Department', data.byDepartment, (c) => departmentName(c.key)],
              ['lt-hour', 'Order to report by hour of the order', 'When', data.byHour, (c) => hourWords(c.key)],
              ['lt-day', 'Order to report by day of the week', 'When', data.byWeekday, (c) => WEEKDAY_WORDS[c.key]],
              ['lt-month', 'Order to report by month', 'Month', data.byMonth, (c) => c.label],
            ].map(([id, title, first, rows, label]) => (
              <section key={id} className="panel an-card" aria-labelledby={id}>
                <header className="an-card-head">
                  <h2 id={id}>{title}</h2>
                </header>
                <div className="an-card-body an-table-wrap">
                  {rows.length === 0 ? <p className="muted">No lab orders in this period.</p> : <TimesTable id={id} caption={title} first={first} rows={rows} label={label} />}
                </div>
              </section>
            ))}

            {platform && data.hospitals?.length > 1 && (
              <section className="panel an-card an-wide" aria-labelledby="lt-hospitals">
                <header className="an-card-head">
                  <h2 id="lt-hospitals">Usual time by hospital</h2>
                </header>
                <div className="an-card-body an-table-wrap">
                  <table className="dt an-table">
                    <thead>
                      <tr>
                        <th scope="col">Hospital</th>
                        <th scope="col" className="num">
                          Orders
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
                          <td className="num tabular">{formatNumber(h.orders)}</td>
                          {h.stages.map((s) => (
                            <td key={s.key} className="num tabular">
                              {tooFewOrders(s, 'median')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="panel an-card an-wide" aria-labelledby="lt-complete">
              <header className="an-card-head">
                <h2 id="lt-complete">How complete these numbers are</h2>
              </header>
              <div className="an-card-body">
                <ul className="an-list">
                  <li>
                    Sample time known: <strong className="tabular">{data.completeness.sampleTimeKnown ?? '—'}%</strong> of orders (the sample was marked taken before the results)
                  </li>
                  <li>
                    Report time known: <strong className="tabular">{data.completeness.reportTimeKnown ?? '—'}%</strong> (orders reported; an order changed after its report before 10 Nov 2026 has lost its first report
                    time)
                  </li>
                </ul>
                <p className="hint help">Clock time, day and night. The due times are the hospital's own turnaround times in Lab setup.</p>
              </div>
            </section>
          </div>
        )}
      </div>
    </>
  );
}
