// Columns per month (or any category), one or two series on ONE axis (same unit). Hover or focus a month for its values.
// Marks follow the chart rules: ≤ 24 px columns with a 4 px rounded top and a square base, a 2 px gap between the
// columns of a group, hairline gridlines, round tick numbers; a legend whenever there are two series.
// data: [{ label, values: [n, n?] }]  series: [{ label, color }]  format: number → text
import { useId, useState } from 'react';

// A compact drawing area, so the axis text stays readable when the chart is shown in half a page.
const W = 480;
const H = 230;
const PAD = { top: 12, right: 6, bottom: 28, left: 52 };

// 0 … a round number above the maximum, in about 4 steps (1, 2, 2.5 or 5 × 10ⁿ). integer: counts never get 0.5.
function niceTicks(max, integer) {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough);
  if (integer) step = Math.max(1, Math.ceil(step));
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

// A column with a rounded top and a square base.
function column(x, y, w, h) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

const shortNumber = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });

// integer: the values are counts (whole numbers on the axis). empty: what to say when every value is 0.
// A data item may carry texts: [string] – shown instead of the value (e.g. "fewer than 5" for a hidden small count,
// drawn as 0).
export function ColumnChart({ data, series, format = (n) => String(n), title, integer = false, empty = 'Nothing yet.' }) {
  const id = useId();
  const [active, setActive] = useState(null);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const max = Math.max(0, ...data.flatMap((d) => d.values));
  const valueText = (d, s) => d.texts?.[s] ?? format(d.values[s]);
  if (max === 0) {
    const hidden = data.some((d) => d.texts?.some(Boolean));
    return <p className="chart-empty muted">{hidden ? 'Each month is below 5 – hidden to protect privacy.' : empty}</p>;
  }
  const ticks = niceTicks(max, integer);
  const top = ticks.at(-1);
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.min(24, (slot * 0.6 - (series.length - 1) * 2) / series.length);
  const groupW = barW * series.length + (series.length - 1) * 2;
  const y = (v) => PAD.top + plotH - (v / top) * plotH;
  // month labels: every other one when there are many – always including the latest
  const labelled = (i) => data.length <= 8 || (data.length - 1 - i) % 2 === 0;

  return (
    <div className="chart">
      {series.length > 1 && (
        <ul className="chart-legend" aria-label="Legend">
          {series.map((s) => (
            <li key={s.label}>
              <span className="chart-swatch" style={{ background: s.color }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div className="chart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t`}>
          <title id={`${id}-t`}>{title}</title>
          {ticks.map((t) => (
            <g key={t}>
              <line className="chart-grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="chart-tick" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">{shortNumber.format(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x0 = PAD.left + i * slot + (slot - groupW) / 2;
            return (
              <g key={d.label} className={active === i ? 'chart-col is-active' : 'chart-col'}>
                {d.values.map((v, s) => (
                  <path key={series[s].label} d={column(x0 + s * (barW + 2), y(v), barW, PAD.top + plotH - y(v))} fill={series[s].color} />
                ))}
                {labelled(i) && (
                  <text className="chart-tick" x={PAD.left + i * slot + slot / 2} y={H - 8} textAnchor="middle">{d.label}</text>
                )}
                {/* the hit area is the whole month, not just the painted column */}
                <rect
                  className="chart-hit"
                  x={PAD.left + i * slot}
                  y={PAD.top}
                  width={slot}
                  height={plotH}
                  tabIndex={0}
                  aria-label={`${d.label}: ${d.values.map((_, s) => `${series[s].label} ${valueText(d, s)}`).join(', ')}`}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              </g>
            );
          })}
        </svg>
        {active !== null && (
          <div className="chart-tip" style={{ left: `${((PAD.left + active * slot + slot / 2) / W) * 100}%` }} role="status">
            <div className="chart-tip-title">{data[active].label}</div>
            {data[active].values.map((_, s) => (
              <div key={series[s].label} className="chart-tip-row">
                <span className="chart-key" style={{ background: series[s].color }} aria-hidden />
                <strong>{valueText(data[active], s)}</strong> <span className="muted">{series[s].label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)'];
