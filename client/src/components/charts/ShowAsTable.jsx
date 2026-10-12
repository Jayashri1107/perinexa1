import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatCount } from '../../pages/analytics/analyticsFormat.js';

/**
 * A chart with a "Show as table" text button under it that shows the same numbers as a real table
 * (for screen readers, for copying, and for anyone who prefers numbers to columns).
 * rows: [{ key, label, value, href? }]. labelHeader / valueHeader: the column headings.
 */
export function ShowAsTable({ rows, caption, labelHeader = 'Period', valueHeader = 'Number', children }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="an-show-table">
      {children}
      <button type="button" className="btn btn-link btn-sm an-table-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide table' : 'Show as table'}
      </button>
      {open && (
        <div className="an-table-wrap" id={id}>
          <table className="dt an-table">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                <th scope="col">{labelHeader}</th>
                <th scope="col" className="num">
                  {valueHeader}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row" data-label={labelHeader}>
                    {r.label}
                  </th>
                  <td className="num" data-label={valueHeader}>
                    {r.href ? <Link to={r.href}>{formatCount(r.value)}</Link> : formatCount(r.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
