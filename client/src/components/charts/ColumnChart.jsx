import { useEffect, useRef, useState } from 'react';
import { formatCount, isExact } from '../../pages/analytics/analyticsFormat.js';
import { niceTicks } from './niceTicks.js';
import { ShowAsTable } from './ShowAsTable.jsx';

// Sizes in screen pixels: the SVG's viewBox is the size of its box, so 1 unit is 1 px and text takes the
// type tokens from CSS (the person's text size applies).
// The chart is a little lower on a narrow card and never taller than 200 px, so it fits its card.
const MIN_HEIGHT = 150;
const MAX_HEIGHT = 200;
const chartHeight = (width) => Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, width * 0.32)));
const PAD = { top: 24, right: 8, bottom: 32, left: 44 };
const MAX_COL = 24; // column width at most
const GAP = 2;
const RADIUS = 4;
const MIN_LABEL_PX = 60; // room for one x-axis label ("Nov 2025")

/** The width of an element, followed as it changes. */
function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** A column with a 4 px rounded top and a square base. */
function columnPath(x, y, w, h) {
  const r = Math.min(RADIUS, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** The column a key moves the focus to (Left/Right one column, Home/End the first/last), or null for other keys. */
export function nextColumn(key, current, n) {
  const next = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: n - 1 }[key];
  if (next === undefined || n < 1) return null;
  return Math.min(Math.max(next, 0), n - 1);
}

/** "Babies registered per month of birth, Nov 2025 to Oct 2026: total 5, highest 2 in Jun 2026". */
export function columnSummary(title, columns, total) {
  if (!columns.length) return title;
  const exact = columns.filter((c) => isExact(c.value));
  const top = exact.reduce((a, c) => (c.value > (a?.value ?? -1) ? c : a), null);
  const parts = [];
  if (total !== undefined) parts.push(`total ${formatCount(total)}`);
  if (top) parts.push(`highest ${formatCount(top.value)} in ${top.label}`);
  if (exact.length < columns.length) parts.push(`${columns.length - exact.length} not shown as numbers`);
  return `${title}, ${columns[0].label} to ${columns[columns.length - 1].label}${parts.length ? `: ${parts.join(', ')}` : ''}`;
}

/**
 * Columns over time (or over the next weeks), one series. A column with no exact number (a hospital admin's
 * "fewer than 5" or "Not shown") has no column: a small marker at the baseline, and the words in the tooltip and
 * in the table. Always has "Show as table".
 * Keyboard: one Tab stop (the svg is a group named by the summary); Left/Right/Home/End move between columns,
 * each column an image named "label: value", with the same tooltip as on hover.
 * columns: [{ key, label, value, href? }]. color: 'bar' | 'scheduled' (future dates). summary: the chart in words.
 */
export function ColumnChart({ columns, color = 'bar', summary, caption, labelHeader = 'Period', valueHeader = 'Number' }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const colRefs = useRef([]);
  const n = columns.length;
  // One Tab stop for the whole chart (roving tabindex); kept inside the columns when the period changes n.
  const stop = Math.min(Math.max(focusIdx, 0), Math.max(0, n - 1));
  function onKeyDown(e) {
    const i = nextColumn(e.key, stop, n);
    if (i === null) return;
    e.preventDefault();
    setFocusIdx(i);
    colRefs.current[i]?.focus();
  }
  const values = columns.map((c) => (isExact(c.value) ? c.value : 0));
  const ticks = niceTicks(Math.max(0, ...values));
  const yMax = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const HEIGHT = chartHeight(width);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = n ? plotW / n : 0;
  const colW = Math.max(2, Math.min(MAX_COL, band - GAP));
  const y = (v) => PAD.top + plotH - (v / yMax) * plotH;
  const labelEvery = Math.max(1, Math.ceil(MIN_LABEL_PX / Math.max(band, 1)));
  const highest = values.indexOf(Math.max(...values));
  const direct = new Set([highest, n - 1].filter((i) => i >= 0 && isExact(columns[i].value) && columns[i].value > 0));
  const tip = active !== null ? columns[active] : null;

  return (
    <ShowAsTable rows={columns} caption={caption ?? summary} labelHeader={labelHeader} valueHeader={valueHeader}>
      <div className="colchart" ref={ref}>
        {width > 0 && (
          <svg className={`colchart-svg colchart-${color}`} viewBox={`0 0 ${width} ${HEIGHT}`} width={width} height={HEIGHT} role="group" aria-label={summary} onKeyDown={onKeyDown}>
            <g aria-hidden="true">
              {ticks.map((t) => (
                <g key={t} className="colchart-tick">
                  <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
                  <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                    {formatCount(t)}
                  </text>
                </g>
              ))}
            </g>
            {columns.map((c, i) => {
              const cx = PAD.left + i * band + band / 2;
              const exact = isExact(c.value);
              const h = exact && yMax > 0 ? (c.value / yMax) * plotH : 0;
              return (
                <g
                  key={c.key}
                  ref={(el) => {
                    colRefs.current[i] = el;
                  }}
                  className={`colchart-col ${active === i ? 'is-active' : ''}`.trim()}
                  role="img"
                  aria-label={`${c.label}: ${formatCount(c.value)}`}
                  tabIndex={i === stop ? 0 : -1}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => {
                    setActive(i);
                    setFocusIdx(i);
                  }}
                  onBlur={() => setActive(null)}
                >
                  <rect className="colchart-hit" x={PAD.left + i * band} y={PAD.top} width={band} height={plotH} />
                  {exact && h > 0 && <path className="colchart-bar" d={columnPath(cx - colW / 2, PAD.top + plotH - h, colW, h)} />}
                  {!exact && <rect className="colchart-masked" x={cx - colW / 2} y={PAD.top + plotH - 3} width={colW} height={3} />}
                  {direct.has(i) && (
                    <text className="colchart-direct" x={cx} y={PAD.top + plotH - h - 6} textAnchor="middle">
                      {formatCount(c.value)}
                    </text>
                  )}
                  {(i % labelEvery === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= labelEvery) && (
                    <text className="colchart-xlabel" x={cx} y={HEIGHT - PAD.bottom + 18} textAnchor="middle">
                      {c.label}
                    </text>
                  )}
                </g>
              );
            })}
            <line className="colchart-base" aria-hidden="true" x1={PAD.left} x2={width - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} />
          </svg>
        )}
        {tip && (
          <div
            className="colchart-tip"
            role="presentation"
            style={{ left: `${Math.min(Math.max(PAD.left + active * band + band / 2, 60), Math.max(60, width - 60))}px` }}
          >
            {tip.label} · {formatCount(tip.value)}
          </div>
        )}
      </div>
    </ShowAsTable>
  );
}
