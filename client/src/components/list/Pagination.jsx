// Page buttons and "rows per page" for every list. The allowed sizes come from the server's settings.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAppConfig } from '../../context/AppConfigContext.jsx';

export function Pagination({ pagination, onPage, onLimit }) {
  const { pagination: settings } = useAppConfig();
  if (!pagination) return null;
  const { page, pages, total, limit } = pagination;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="pagination">
      <span className="muted">
        {from}–{to} of {total}
      </span>
      <label className="limit">
        Rows per page
        <select value={limit} onChange={(e) => onLimit(Number(e.target.value))}>
          {settings.limitOptions.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
      <div className="pager">
        <button type="button" className="icon-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft size={18} />
        </button>
        <span>
          Page {page} of {pages}
        </span>
        <button type="button" className="icon-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
