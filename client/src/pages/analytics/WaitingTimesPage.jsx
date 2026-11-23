import { Clock, Hourglass, Users } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { FilterSelect, formatNumber } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, KpiCard, StatusPill, formatDate } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { durationWords } from '../visits/visitTimelineFormat.js';
import { analyticsTabs } from './analyticsFormat.js';
import { WAIT_PERIOD_OPTIONS, WEEKDAY_WORDS, barScale, barWidths, hasTimes, hourWords, slowestKey, stageGroups, timeCell } from './waitingFormat.js';

// Analytics → Waiting times (owner's decisions of 10 Nov 2026 – docs/PATIENT_FLOW_PLAN.md section 6;
// server/src/analytics/waitingTimes.js). How long each stage of an outpatient's day takes: the usual time (median) and
// the slow time (9 of 10 visits are within it), by hour of arrival, by weekday and by month. Stages only – never a
// person. Doctors: exact numbers for the patients they may see. Hospital admins and the super admin: whole finished
// months, numbers only, "Too few visits to show" below the minimum. platform: the super admin's page (per hospital).
//
// The look (23 Nov 2026, look only – the numbers and who sees them are unchanged): four headline figures; the stages
// in three groups, the stages inside a visit also as bars on one scale (solid = usual, pale = slow); a mark on the
// slowest hour and day; the completeness shares as meters. On a phone every value sits under its own label.

/** The usual (solid) and slow (pale) time of a row as one bar. Decoration: the numbers are in the cells beside it. */
function TimeBar({ cell, scale }) {
  const w = barWidths(cell, scale);
  return (
    <td className="wt-bar" aria-hidden="true">
      {w && (
        <span className="wt-track">
          <span className="wt-slow" style={{ width: `${w.slow}%` }} />
          <span className="wt-usual" style={{ width: `${w.usual}%` }} />
        </span>
      )}
    </td>
  );
}

/** The heading of the bar column: which shade is which (the small tables under "Each stage" leave the words out). */
function BarHead({ words = true }) {
  return (
    <th scope="col" className="wt-bar-head">
      {words ? (
        <span className="wt-key">
          <span className="wt-swatch wt-usual" aria-hidden="true" />
          Usual
          <span className="wt-swatch wt-slow" aria-hidden="true" />
          Slow
        </span>
      ) : (
        <span className="sr-only">Usual and slow time as a bar</span>
      )}
    </th>
  );
}

/** A row's usual and slow time; below the minimum, one cell that says so instead of the same words twice. */
function TimeCells({ cell, extra = 0 }) {
  if (cell.tooFew) {
    return (
      <td colSpan={2 + extra} className="wt-few">
        {timeCell(cell, 'median')}
      </td>
    );
  }
  return (
    <>
      <td className="num tabular" data-label="Usual">
        {timeCell(cell, 'median')}
      </td>
      <td className="num tabular" data-label="Slow">
        {timeCell(cell, 'p90')}
      </td>
    </>
  );
}

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
  const stages = data?.stages ?? [];
  const groups = stageGroups(stages);
  const partsScale = barScale(groups.find((g) => g.bars)?.rows);
  const whole = stages.find((s) => s.key === 'whole') ?? null;
  const longest = stages.find((s) => s.key === data?.longest) ?? null;
  const measured = hasTimes(stages);
  const shares = data
    ? [
        ['Arrival time known', data.completeness.arrivalMarked, 'Reception presses “Mark arrived”, or she was registered that day'],
        ['Finished the same day', data.completeness.finishedSameDay, 'Prescription printed, saved or sent, or the visit signed'],
        ['Medicines from the pharmacy', data.completeness.withSale, 'A pharmacy sale to her that day'],
      ]
    : [];
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
            {data?.period && (
              <span className="an-caption">
                {formatDate(data.period.from)} to {formatDate(data.period.to)}
              </span>
            )}
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
        {data && !measured && (
          <section className="panel an-card" aria-labelledby="wt-none">
            <header className="an-card-head">
              <h2 id="wt-none">No times in this period</h2>
            </header>
            <p className="panel-empty">No OPD visit in this period has a time noted. Times are noted from 10 Nov 2026 on, so an earlier period stays empty.</p>
          </section>
        )}
        {data && measured && (
          <>
            <div className="kpi-grid wt-kpis">
              <KpiCard icon={Users} label="OPD visits" value={formatNumber(data.visits)} sub={doctor ? 'Of the patients you may see' : 'Rounded to 5'} />
              <KpiCard icon={Clock} label="Whole visit, usual" value={whole ? timeCell(whole, 'median') : '—'} textValue={Boolean(whole?.tooFew)} sub="Arrival to leaving: half the visits took less" />
              <KpiCard icon={Hourglass} label="Whole visit, slow" value={whole ? timeCell(whole, 'p90') : '—'} textValue={Boolean(whole?.tooFew)} sub="9 of 10 visits took less" />
              <KpiCard
                tone={longest ? 'watch' : 'neutral'}
                icon={longest ? undefined : Clock}
                label="Longest wait"
                value={longest ? longest.label : '—'}
                textValue={Boolean(longest)}
                sub={longest ? `Usual ${durationWords(longest.median)}` : 'No waiting stage has a time yet'}
              />
            </div>
            {/* The analytics grid, as on the other Analytics pages: the stages across the top, the three "whole visit"
                tables side by side under it */}
            <div className="an-grid wt-grid wt-times">
              <section className="panel an-card an-wide" aria-labelledby="wt-stages">
                <header className="an-card-head">
                  <h2 id="wt-stages">Each stage</h2>
                  <p className="t-caption muted">Usual = half the visits took less; slow = 9 of 10 took less.</p>
                </header>
                <div className="an-card-body an-table-wrap">
                  <table className="dt an-table wt-table">
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
                        <BarHead />
                      </tr>
                    </thead>
                    {groups.map((g) => (
                      <tbody key={g.key}>
                        <tr className="an-group-row">
                          <th scope="colgroup" colSpan={5}>
                            {g.label}
                          </th>
                        </tr>
                        {g.rows.map((s) => (
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
                            <TimeCells cell={s} extra={1} />
                            {!s.tooFew && (
                              <td className="num tabular" data-label="Visits">
                                {formatNumber(s.n)}
                              </td>
                            )}
                            <TimeBar cell={g.bars ? s : null} scale={partsScale} />
                          </tr>
                        ))}
                      </tbody>
                    ))}
                  </table>
                </div>
              </section>

              {[
                ['wt-hour', 'Whole visit by hour of arrival', 'Hour', data.byHour, (c) => hourWords(c.key), true],
                ['wt-day', 'Whole visit by day of the week', 'Day', data.byWeekday, (c) => WEEKDAY_WORDS[c.key], true],
                ['wt-month', 'Whole visit by month', 'Month', data.byMonth, (c) => c.label, false],
              ].map(([id, title, when, cells, label, mark]) => {
                const scale = barScale(cells);
                const slowest = mark ? slowestKey(cells) : null;
                return (
                  <section key={id} className={`panel an-card ${id}`} aria-labelledby={id}>
                    <header className="an-card-head">
                      <h2 id={id}>{title}</h2>
                    </header>
                    <div className="an-card-body an-table-wrap">
                      {!hasTimes(cells) ? (
                        <p className="muted">No visits with an arrival time in this period.</p>
                      ) : (
                        <table className="dt an-table wt-table">
                          <thead>
                            <tr>
                              <th scope="col">{when}</th>
                              <th scope="col" className="num">
                                Usual
                              </th>
                              <th scope="col" className="num">
                                Slow
                              </th>
                              <BarHead words={false} />
                            </tr>
                          </thead>
                          <tbody>
                            {cells.map((c) => (
                              <tr key={c.key}>
                                <th scope="row">
                                  <span className="wt-when">{label(c)}</span>
                                  {slowest === c.key && (
                                    <>
                                      {' '}
                                      <StatusPill tone="watch">Slowest</StatusPill>
                                    </>
                                  )}
                                </th>
                                <TimeCells cell={c} />
                                <TimeBar cell={c} scale={scale} />
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </section>
                );
              })}

              {platform && data.hospitals?.length > 1 && (
                <section className="panel an-card an-wide" aria-labelledby="wt-hospitals">
                  <header className="an-card-head">
                    <h2 id="wt-hospitals">Usual time by hospital</h2>
                  </header>
                  <div className="an-card-body an-table-wrap">
                    <table className="dt an-table wt-hospitals">
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
                            <td className="num tabular" data-label="Visits">
                              {formatNumber(h.visits)}
                            </td>
                            {h.stages.map((s, i) => (
                              <td key={s.key} className="num tabular" data-label={data.stages[i]?.label ?? s.key}>
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
                  <p className="t-caption muted">A low share means that stage is measured on few visits.</p>
                </header>
                <div className="an-card-body">
                  {shares.map(([label, share, note]) => (
                    <div key={label} className="meter wt-meter">
                      <span className="meter-label">
                        {label}
                        <span className="wt-note">{note}</span>
                      </span>
                      <span className="meter-track" aria-hidden="true">
                        {share != null && <span className="meter-fill" style={{ width: `${share}%` }} />}
                      </span>
                      <span className="meter-text">{share == null ? '—' : `${share}% of visits`}</span>
                    </div>
                  ))}
                  <p className="hint help">Times are noted from 10 Nov 2026 on; earlier visits have no RMO, doctor or vitals times.</p>
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </>
  );
}
