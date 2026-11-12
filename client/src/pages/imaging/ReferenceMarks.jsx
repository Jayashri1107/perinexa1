import { Link } from 'react-router-dom';
import { gaWords, weeksByDates, weeksDays } from './usgCalc.js';
import { BAND_WORDS, bandAt, bandOf, dopplerRows } from './referenceTables.js';

// Sonography stage 2 (docs/USG_APPS_REVIEW.md U1, U3): a scan's values against the hospital's approved reference tables
// – the Doppler indices with their band, and the centile bands for BPD, HC, AC and FL across her scans. Each says the
// published chart it comes from. With no approved table, it says so and judges nothing. On the scan's page and printed
// with its report.

/** The Doppler indices of this scan, each with its band for her weeks by dates. */
export function DopplerMarks({ values, on, eddByDates, references }) {
  const weeks = weeksByDates(eddByDates, on);
  const rows = dopplerRows(values, weeks, references);
  if (!rows.length) return null;
  return (
    <section className="gr-wrap" aria-labelledby="dop-title">
      <h2 id="dop-title" className="pdoc-sig-title">
        Doppler against the reference tables
      </h2>
      {!weeks && <p className="pdoc-small">No EDD on her record: the bands need her weeks by dates.</p>}
      <table className="ptable pdoc-table">
        <thead>
          <tr>
            <th scope="col">Index</th>
            <th scope="col" className="num">
              Value
            </th>
            <th scope="col">For {weeks ? gaWords(weeksDays(weeks)) : 'her weeks'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.band && r.band !== 'within' ? 'gr-row-current' : undefined}>
              <td>{r.name}</td>
              <td className="num pdoc-tabular">{r.value}</td>
              <td>{r.noTable ? 'No approved reference table' : r.band ? `${BAND_WORDS[r.band]}${r.band !== 'within' ? ' – outside the usual range' : ''}` : 'Outside the weeks of the table'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <SourcesNote keys={rows.map((r) => r.key)} references={references} />
    </section>
  );
}

function SourcesNote({ keys, references }) {
  const used = [...new Set(keys.filter((k) => references?.[k]).map((k) => references[k].source))];
  return (
    <p className="pdoc-small">
      {used.length ? `Reference: ${used.join('; ')} – as approved by the hospital's doctor. ` : ''}
      <Link className="no-print" to="/scans/references">
        Reference tables
      </Link>
    </p>
  );
}

/** One measurement across her scans on its 5th, 50th and 95th centile lines (an approved table only). */
export function MeasureGraph({ rows, valueKey, label, table }) {
  const pts = rows.filter((r) => r[valueKey] && r.weeks && bandAt(table, r.weeks));
  if (!table || !pts.length) return null;
  const first = table.rows[0].week;
  const last = table.rows[table.rows.length - 1].week;
  const x0 = Math.max(first, Math.floor(Math.min(...pts.map((p) => p.weeks)) - 2));
  const x1 = Math.min(last, Math.max(x0 + 4, Math.ceil(Math.max(...pts.map((p) => p.weeks)) + 2)));
  const yMax = Math.ceil(Math.max(bandAt(table, x1)?.p95 ?? 0, ...pts.map((p) => p[valueKey])) / 10) * 10 || 10;
  const W = 260;
  const H = 170;
  const pad = { l: 34, r: 30, t: 16, b: 24 };
  const X = (w) => pad.l + ((w - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const Y = (v) => H - pad.b - (v / yMax) * (H - pad.t - pad.b);
  const line = (k) => {
    const p = [];
    for (let w = x0; w <= x1 + 0.001; w += 0.5) {
      const b = bandAt(table, w);
      if (b) p.push(`${X(w).toFixed(1)},${Y(b[k]).toFixed(1)}`);
    }
    return p.join(' ');
  };
  return (
    <figure className="gr-measure">
      <svg className="gr-graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} of each scan on the 5th, 50th and 95th centile lines`}>
        <text className="gr-tick" x={pad.l} y={11}>
          {label} ({table.unit})
        </text>
        {['p95', 'p50', 'p5'].map((k) => (
          <polyline key={k} className={`gr-band gr-${k === 'p5' ? 'p10' : k === 'p95' ? 'p90' : 'p50'}`} points={line(k)} fill="none" />
        ))}
        {[x0, x1].map((w) => (
          <text key={w} className="gr-tick" x={X(w)} y={H - 8} textAnchor="middle">
            {w}
          </text>
        ))}
        {pts.map((p) => {
          const band = bandOf(table, p.weeks, p[valueKey]);
          return (
            <circle key={p.id} className={`gr-point${p.current ? ' gr-current' : ''}`} cx={X(p.weeks)} cy={Y(p[valueKey])} r="4">
              <title>{`${p[valueKey]} ${table.unit} · ${band ? BAND_WORDS[band] : ''}`}</title>
            </circle>
          );
        })}
      </svg>
    </figure>
  );
}

/** The centile bands for BPD, HC, AC and FL (those with an approved table), with their sources. */
export function MeasureBands({ rows, references }) {
  const shown = [
    ['bpd', 'BPD'],
    ['hc', 'HC'],
    ['ac', 'AC'],
    ['fl', 'FL'],
  ].filter(([k]) => references?.[k]);
  if (!shown.length) return <p className="pdoc-small">Centile bands for BPD, HC, AC and FL: no approved reference table yet.</p>;
  return (
    <>
      <div className="gr-measures">
        {shown.map(([k, label]) => (
          <MeasureGraph key={k} rows={rows} valueKey={k} label={label} table={references[k]} />
        ))}
      </div>
      <SourcesNote keys={shown.map(([k]) => k)} references={references} />
    </>
  );
}
