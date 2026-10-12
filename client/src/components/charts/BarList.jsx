import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatCount, isExact } from '../../pages/analytics/analyticsFormat.js';
import { StatusPill } from '../ui.jsx';

/**
 * Counts by category as a real table: label | value | bar (brand: one series colour; a status is carried by the
 * row's pill – colour, icon and word – never by the bar). "Not recorded" rows come last, after a hairline, in the
 * de-emphasis grey. Rows keep the order they are given in (a hospital admin's rows arrive in the order to show
 * them, and are never sorted again by value here).
 *
 * rows: [{ key, label, sub?, value, unknown?, status? ({ tone, icon, word }), href?, share? }]
 * scale: the value a full-width bar stands for (the largest value, or a shared total such as all active
 * pregnancies). caption: what the table shows, for screen readers.
 */
export function BarList({ rows, scale, caption }) {
  const known = rows.filter((r) => !r.unknown);
  const unknown = rows.filter((r) => r.unknown);
  const ordered = [...known, ...unknown];
  const top = scale ?? Math.max(0, ...rows.map((r) => (isExact(r.value) ? r.value : 0)));
  return (
    <table className="barlist">
      {caption && <caption className="sr-only">{caption}</caption>}
      <tbody>
        {ordered.map((r, i) => {
          const exact = isExact(r.value);
          const width = exact && top > 0 ? Math.min(100, (r.value / top) * 100) : 0;
          const label = r.status ? (
            <StatusPill tone={r.status.tone} icon={r.status.icon}>
              {r.label}
            </StatusPill>
          ) : (
            <span className="barlist-text">{r.label}</span>
          );
          return (
            <tr key={r.key} className={[r.href ? 'barlist-row-link' : '', r.unknown && i === known.length && known.length > 0 ? 'barlist-sep' : ''].join(' ').trim() || undefined}>
              <th scope="row" className="barlist-label">
                {r.href ? (
                  <Link to={r.href} className="barlist-link">
                    {label}
                    <ChevronRight className="barlist-chevron" aria-hidden="true" />
                    {r.sub && <span className="barlist-sub">{r.sub}</span>}
                    <span className="sr-only">: open the list of patients</span>
                  </Link>
                ) : (
                  <>
                    {label}
                    {r.sub && <span className="barlist-sub">{r.sub}</span>}
                  </>
                )}
              </th>
              <td className={`barlist-value ${exact ? '' : 'barlist-value-text'}`.trim()}>
                {formatCount(r.value)}
                {r.share && <span className="barlist-share"> · {r.share}</span>}
              </td>
              <td className="barlist-bar" aria-hidden="true">
                {width > 0 && <span className={`barlist-fill ${r.unknown ? 'barlist-fill-unknown' : ''}`.trim()} style={{ width: `${width}%` }} />}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
