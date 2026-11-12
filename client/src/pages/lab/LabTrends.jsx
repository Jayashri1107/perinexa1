import { LineChart } from 'lucide-react';
import { StatusPill, formatDate } from '../../components/ui.jsx';
import { CRITICAL_LOOK, FLAG_LOOK, GRAPH_VALUES, graphPoints, resultsOverTime } from './labFormat.js';
import { eddFromLmp } from '../patients/patientFormat.js';

// P6 (docs/LAB_BUILD_NOTE.md): under each date the weeks of pregnancy on that day (her EDD in use – the scan EDD, else
// from her LMP); a baby's bilirubin drawn against its age in hours (from the birth time on its record).
const BY_HOURS = ['nb_bilirubin.total', 'nb_bilirubin.direct'];
/** Her EDD in use (scan EDD first, then from the LMP) as a Date, or null. */
export function eddOf(patient) {
  const p = patient?.pregnancy ?? {};
  if (p.scanEdd) return new Date(`${String(p.scanEdd).slice(0, 10)}T00:00:00Z`);
  if (p.lmp) return eddFromLmp(String(p.lmp).slice(0, 10));
  return p.effectiveEdd ? new Date(p.effectiveEdd) : null;
}
/** "24w" – the weeks of pregnancy on a day by the EDD, or '' when out of a pregnancy's range. PURE. */
export function weeksOn(edd, at) {
  if (!edd || !at) return '';
  const days = 280 - Math.round((edd.getTime() - new Date(at).getTime()) / 86_400_000);
  return days >= 0 && days <= 300 ? `${Math.floor(days / 7)}w` : '';
}
/** A baby's age in whole hours at a time, or null. PURE. */
export const hoursOld = (birthAt, at) => (birthAt && at ? Math.max(0, Math.round((new Date(at) - new Date(birthAt)) / 3_600_000)) : null);

// P6 of docs/LAB_BUILD_NOTE.md on the patient's Lab tab (clinical users only – the lab never opens this tab):
//  - Results over time: one row per value, one column per sample date (the newest MAX_COLUMNS), reported and reviewed
//    orders only, each value with its flag (colour, icon and word). Confidential tests (HIV) are left out.
//  - A small graph for the values followed over time (labFormat.js GRAPH_VALUES – the proposed set, the owner
//    confirms it), from two results on. Inline SVG, no charting library; colours from tokens.css.

const MAX_COLUMNS = 8;
const W = 320;
const H = 120;
const PAD = { left: 40, right: 12, top: 12, bottom: 24 };

function Flag({ v }) {
  if (v.critical) {
    return (
      <StatusPill tone={CRITICAL_LOOK.tone} icon={CRITICAL_LOOK.icon}>
        {CRITICAL_LOOK.word}
      </StatusPill>
    );
  }
  const look = FLAG_LOOK[v.flag];
  if (!look) return null;
  return (
    <StatusPill tone={look.tone} icon={look.icon}>
      {look.word}
    </StatusPill>
  );
}

/** One value's graph: its results by sample date, oldest on the left. */
export function TrendGraph({ row, columns, edd = null, birthAt = null }) {
  const points = graphPoints(row, columns);
  if (points.length < 2) return null;
  // A baby's bilirubin: against its age in hours (the horizontal axis in hours from birth)
  const byHours = Boolean(birthAt) && BY_HOURS.includes(row.id);
  const times = points.map((p) => (byHours ? hoursOld(birthAt, p.at) : new Date(p.at).getTime()));
  const values = points.map((p) => p.value);
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.15;
  const vMin = lo - pad;
  const vMax = hi + pad;
  const x = (t) => PAD.left + (t1 === t0 ? (W - PAD.left - PAD.right) / 2 : ((t - t0) / (t1 - t0)) * (W - PAD.left - PAD.right));
  const y = (v) => PAD.top + (1 - (v - vMin) / (vMax - vMin)) * (H - PAD.top - PAD.bottom);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const label = `${row.name}${row.unit ? ` (${row.unit})` : ''}: ${points.map((p) => `${p.value} ${byHours ? `at ${hoursOld(birthAt, p.at)} hours of age` : `on ${formatDate(p.at)}`}`).join(', ')}`;
  const axisText = (p) => (byHours ? `${hoursOld(birthAt, p.at)} h` : formatDate(p.at));
  const weeksText = (p) => (!byHours && edd ? weeksOn(edd, p.at) : '');
  return (
    <figure className="lab-trend">
      <figcaption>
        <strong>{row.name}</strong>
        {row.unit ? <span className="muted"> {row.unit}</span> : null}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="lab-trend-svg">
        {[lo, hi].map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="lab-trend-grid" />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" className="lab-trend-axis">
              {v}
            </text>
          </g>
        ))}
        <path d={path} className="lab-trend-line" />
        {points.map((p, i) => (
          <circle key={p.at} cx={x(times[i])} cy={y(p.value)} r={FLAG_LOOK[p.flag] ? 4.5 : 3.5} className={FLAG_LOOK[p.flag] ? 'lab-trend-point lab-trend-point-flag' : 'lab-trend-point'} />
        ))}
        <text x={PAD.left} y={H - 6} className="lab-trend-axis">
          {axisText(points[0])}
          {weeksText(points[0]) ? ` · ${weeksText(points[0])}` : ''}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" className="lab-trend-axis">
          {axisText(points[points.length - 1])}
          {weeksText(points[points.length - 1]) ? ` · ${weeksText(points[points.length - 1])}` : ''}
        </text>
        {byHours && (
          <text x={(PAD.left + W - PAD.right) / 2} y={H - 6} textAnchor="middle" className="lab-trend-axis">
            hours of age
          </text>
        )}
      </svg>
    </figure>
  );
}

/** Results over time and the graphs, from the orders already on the Lab tab. */
export function ResultsOverTime({ orders, patient = null }) {
  const edd = patient?.careType === 'antenatal' ? eddOf(patient) : null;
  const birthAt = patient?.careType === 'newborn' ? (patient.newborn?.birthAt ?? null) : null;
  const { columns, rows } = resultsOverTime(orders);
  if (columns.length < 2 || !rows.length) return null;
  const shown = columns.slice(0, MAX_COLUMNS);
  const graphs = rows.filter((r) => GRAPH_VALUES.includes(r.id));
  return (
    <section className="card lab-over-time" aria-labelledby="lab-over-time-title">
      <h2 id="lab-over-time-title">
        <LineChart aria-hidden="true" /> Results over time
      </h2>
      <div className="lab-over-time-wrap">
        <table className="dt lab-over-time-table">
          <caption className="sr-only">Her results by sample date, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Value</th>
              {shown.map((c) => (
                <th key={c.id} scope="col" className="num tabular">
                  {formatDate(c.at)}
                  {edd && weeksOn(edd, c.at) ? <span className="lab-trend-weeks">{weeksOn(edd, c.at)}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row">
                  {r.name}
                  {r.unit ? <span className="muted"> {r.unit}</span> : null}
                </th>
                {shown.map((c) => {
                  const v = r.cells[c.id];
                  return (
                    <td key={c.id} className="num tabular">
                      {v ? (
                        <>
                          {v.value} <Flag v={v} />
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {columns.length > MAX_COLUMNS && <p className="hint">The newest {MAX_COLUMNS} sample dates are shown; every order is in the list above.</p>}
      {graphs.some((r) => graphPoints(r, columns).length >= 2) && (
        <div className="lab-trends">
          {graphs.map((r) => (
            <TrendGraph key={r.id} row={r} columns={columns} edd={edd} birthAt={birthAt} />
          ))}
        </div>
      )}
    </section>
  );
}
