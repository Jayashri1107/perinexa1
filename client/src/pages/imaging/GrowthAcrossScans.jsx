import { estimatedWeight, gaWords, ordinal, reading, twinDiscordance, weeksByDates, weeksDays, weightBand, weightCentile } from './usgCalc.js';

// Growth across scans (owner's go-ahead, 10 Nov 2026 – docs/USG_APPS_REVIEW.md U1, stage 1): the estimated fetal weight
// of each of her scans of this pregnancy on the Hadlock 1991 weight curves (10th, 50th, 90th centile – the curve the
// app already uses for the weight centile), and a table of BPD, HC, AC, FL and weight across the scans. Weeks are by
// her dates. Centile bands for BPD, HC, AC and FL, Doppler ranges and a second chart wait for the owner's published
// tables (stage 2). Shown on the scan's page and printed with its report. DRAFT, as the calculations it uses.

const KEYS = [
  ['bpd', 'BPD'],
  ['hc', 'HC'],
  ['ac', 'AC'],
  ['fl', 'FL'],
];
const day = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

/** The rows of the graph and the table: one per scan, and per twin on a twins scan. */
export function growthRows(growth, eddByDates) {
  const rows = [];
  for (const g of growth ?? []) {
    const twins = g.study === 'usg_twins';
    for (const n of twins ? [1, 2] : ['']) {
      const v = Object.fromEntries(['bpd', 'hc', 'ac', 'fl', 'efw'].map((k) => [k, reading(g.values?.[`${k}${n}`])]));
      if (!Object.values(v).some((x) => x != null)) continue;
      const efw = v.efw ?? estimatedWeight(v);
      const w = weeksByDates(eddByDates, g.on);
      rows.push({ id: `${g.id}${n}`, on: g.on, current: g.current, twin: twins ? n : null, weeks: w, ...v, efw, centile: efw && w ? weightCentile(efw, w) : null });
    }
  }
  return rows;
}

/** The weight graph: x weeks by dates, y grams; the three centile lines and the points (twin 2 as squares). */
function WeightGraph({ rows }) {
  const pts = rows.filter((r) => r.efw && r.weeks);
  if (!pts.length) return null;
  const x0 = Math.max(16, Math.floor(Math.min(...pts.map((p) => p.weeks)) - 2));
  const x1 = Math.min(42, Math.max(x0 + 6, Math.ceil(Math.max(...pts.map((p) => p.weeks)) + 2)));
  const yMax = Math.ceil(Math.max(weightBand(x1).p90, ...pts.map((p) => p.efw)) / 500) * 500;
  const W = 520;
  const H = 260;
  const pad = { l: 46, r: 40, t: 10, b: 30 };
  const X = (w) => pad.l + ((w - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const Y = (g) => H - pad.b - (g / yMax) * (H - pad.t - pad.b);
  const line = (key) => {
    const p = [];
    for (let w = x0; w <= x1 + 0.001; w += 0.5) p.push(`${X(w).toFixed(1)},${Y(weightBand(w)[key]).toFixed(1)}`);
    return p.join(' ');
  };
  const weeks = [];
  for (let w = Math.ceil(x0 / 2) * 2; w <= x1; w += 2) weeks.push(w);
  const grams = [];
  for (let g = 0; g <= yMax; g += yMax > 3000 ? 1000 : 500) grams.push(g);
  return (
    <svg className="gr-graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Estimated fetal weight of each scan on the 10th, 50th and 90th centile lines">
      {grams.map((g) => (
        <g key={`y${g}`}>
          <line className="gr-grid" x1={pad.l} x2={W - pad.r} y1={Y(g)} y2={Y(g)} />
          <text className="gr-tick" x={pad.l - 6} y={Y(g) + 4} textAnchor="end">
            {g}
          </text>
        </g>
      ))}
      {weeks.map((w) => (
        <text key={`x${w}`} className="gr-tick" x={X(w)} y={H - pad.b + 16} textAnchor="middle">
          {w}
        </text>
      ))}
      <text className="gr-tick" x={W - pad.r} y={H - 4} textAnchor="end">
        weeks by dates
      </text>
      <text className="gr-tick" x={4} y={pad.t + 8}>
        g
      </text>
      {[
        ['p90', '90th'],
        ['p50', '50th'],
        ['p10', '10th'],
      ].map(([k, label]) => (
        <g key={k}>
          <polyline className={`gr-band gr-${k}`} points={line(k)} fill="none" />
          <text className="gr-tick" x={X(x1) + 4} y={Y(weightBand(x1)[k]) + 4}>
            {label}
          </text>
        </g>
      ))}
      {pts.map((p) =>
        p.twin === 2 ? (
          <rect key={p.id} className={`gr-point${p.current ? ' gr-current' : ''}`} x={X(p.weeks) - 4.5} y={Y(p.efw) - 4.5} width="9" height="9">
            <title>{`${day(p.on)} · twin 2 · ${p.efw} g`}</title>
          </rect>
        ) : (
          <circle key={p.id} className={`gr-point${p.current ? ' gr-current' : ''}`} cx={X(p.weeks)} cy={Y(p.efw)} r="5">
            <title>{`${day(p.on)}${p.twin ? ' · twin 1' : ''} · ${p.efw} g`}</title>
          </circle>
        ),
      )}
    </svg>
  );
}

/** The growth graph and the measurements across scans, or nothing when there is no measured scan. */
export function GrowthAcrossScans({ growth, eddByDates }) {
  const rows = growthRows(growth, eddByDates);
  if (!rows.length) return null;
  const twins = rows.some((r) => r.twin);
  const lastTwins = rows.filter((r) => r.twin && r.current);
  const diff = lastTwins.length === 2 ? twinDiscordance(lastTwins[0].efw, lastTwins[1].efw) : null;
  return (
    <section className="gr-wrap" aria-labelledby="gr-title">
      <h2 id="gr-title" className="pdoc-sig-title">
        Growth across scans
      </h2>
      {eddByDates ? <WeightGraph rows={rows} /> : <p className="pdoc-small">No EDD on her record: the weeks and the graph need her dates.</p>}
      {twins && <p className="pdoc-small">Twin 1 ● · twin 2 ■{diff != null ? ` · weight difference on this scan ${diff} %` : ''}</p>}
      <table className="ptable pdoc-table gr-table">
        <thead>
          <tr>
            <th scope="col">Scan</th>
            <th scope="col">Weeks by dates</th>
            {KEYS.map(([, label]) => (
              <th key={label} scope="col" className="num">
                {label} (mm)
              </th>
            ))}
            <th scope="col" className="num">
              Weight (g)
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.current ? 'gr-row-current' : undefined}>
              <td className="pdoc-tabular">
                {day(r.on)}
                {r.twin ? ` · twin ${r.twin}` : ''}
                {r.current ? ' · this scan' : ''}
              </td>
              <td className="pdoc-tabular">{r.weeks ? gaWords(weeksDays(r.weeks)) : '—'}</td>
              {KEYS.map(([k]) => (
                <td key={k} className="num pdoc-tabular">
                  {r[k] ?? '—'}
                </td>
              ))}
              <td className="num pdoc-tabular">
                {r.efw ?? '—'}
                {r.centile ? ` (${ordinal(r.centile)})` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pdoc-small">Weight curve: Hadlock 1991 (10th, 50th, 90th centile). DRAFT – for the hospital&apos;s doctor to check.</p>
    </section>
  );
}
