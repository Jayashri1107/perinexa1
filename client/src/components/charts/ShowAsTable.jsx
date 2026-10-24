import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatCount } from '../../pages/analytics/analyticsFormat.js';
import { useDialogFocus } from '../ui.jsx';

// The table opens in a pop-up (owner, 24 Oct 2026), not under the chart; its focus handling only while it is open
function TablePopup({ title, onClose, children }) {
  const ref = useDialogFocus(onClose);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="modal an-table-modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
        <div className="row">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A chart with a "Show as table" text button under it that shows the same numbers as a real table
 * (for screen readers, for copying, and for anyone who prefers numbers to columns).
 * rows: [{ key, label, value, href? }]. labelHeader / valueHeader: the column headings.
 */
export function ShowAsTable({ rows, caption, labelHeader = 'Period', valueHeader = 'Number', children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="an-show-table">
      {children}
      <button type="button" className="btn btn-link btn-sm an-table-toggle" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Show as table
      </button>
      {open && (
        <TablePopup title={valueHeader === 'Number' ? (caption ?? 'The numbers') : valueHeader} onClose={() => setOpen(false)}>
        <div className="an-table-wrap">
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
        </TablePopup>
      )}
    </div>
  );
}
