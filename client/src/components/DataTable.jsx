import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search, X } from 'lucide-react';

// One number format for everyone (Indian grouping, e.g. 1,23,456).
const nf = new Intl.NumberFormat('en-IN');
export const formatNumber = (n) => nf.format(n ?? 0);

/**
 * A table built for long lists: sortable column headers, a header row that stays visible while
 * scrolling, loading placeholders, and an empty state.
 *
 * columns: [{ key, header, render?(row), sortKey?, sortFirst?: 'asc'|'desc', align?: 'right', width?, className? }]
 * sort / onSort: current sort ("name" or "-name") and a function to change it.
 */
export function DataTable({
  columns,
  rows,
  rowKey = 'id',
  loading = false,
  emptyText = 'No records.',
  sort,
  onSort,
  onRowClick,
  rowClassName,
  toolbar,
  footer,
  caption,
}) {
  const nextSort = (col) => {
    if (sort === col.sortKey) return `-${col.sortKey}`;
    if (sort === `-${col.sortKey}`) return col.sortKey;
    return col.sortFirst === 'desc' ? `-${col.sortKey}` : col.sortKey;
  };

  return (
    <section className="dt-card">
      {toolbar && <div className="dt-toolbar">{toolbar}</div>}
      <div className="dt-wrap" aria-busy={loading}>
        {loading && rows && <div className="dt-progress" aria-hidden="true" />}
        <table className="dt">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort === c.sortKey || sort === `-${c.sortKey}`;
                const desc = sort === `-${c.sortKey}`;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    style={c.width ? { width: c.width } : undefined}
                    className={[c.align === 'right' ? 'num' : '', c.className ?? ''].join(' ')}
                    aria-sort={active ? (desc ? 'descending' : 'ascending') : undefined}
                  >
                    {c.sortKey && onSort ? (
                      <button type="button" className={`dt-sort ${active ? 'active' : ''}`} onClick={() => onSort(nextSort(c))}>
                        {c.header}
                        {active ? desc ? <ArrowDown size={13} /> : <ArrowUp size={13} /> : <ArrowUpDown size={13} className="dt-sort-idle" />}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {!rows &&
              loading &&
              Array.from({ length: 6 }, (_, i) => (
                <tr key={`sk-${i}`} className="dt-skeleton">
                  {columns.map((c) => (
                    <td key={c.key}>
                      <span />
                    </td>
                  ))}
                </tr>
              ))}
            {rows?.map((r) => (
              <tr
                key={r[rowKey]}
                className={[onRowClick ? 'dt-clickable' : '', rowClassName?.(r) ?? ''].join(' ')}
                onClick={onRowClick ? (e) => !e.target.closest('a,button,select,input,label') && onRowClick(r) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} data-label={typeof c.header === 'string' ? c.header : undefined} className={[c.align === 'right' ? 'num' : '', c.className ?? ''].join(' ')}>
                    {c.render ? c.render(r) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="dt-empty">
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {footer}
    </section>
  );
}

// "Showing 26–50 of 1,234 · Rows per page [25] · « ‹ Page [2] of 50 › »"
export function TablePagination({ page, totalPages, total, limit, onPage, onLimit, label = 'items', sizes = [10, 25, 50, 100] }) {
  const [pageInput, setPageInput] = useState(String(page));
  useEffect(() => setPageInput(String(page)), [page]);
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);

  const goTo = (p) => {
    const n = Math.min(Math.max(1, p), totalPages);
    if (n !== page) onPage(n);
    else setPageInput(String(page));
  };

  return (
    <div className="dt-footer">
      <span className="dt-range">
        Showing <strong>{formatNumber(from)}</strong>–<strong>{formatNumber(to)}</strong> of <strong>{formatNumber(total)}</strong> {label}
      </span>
      <div className="dt-pager">
        {onLimit && (
          <label className="dt-size">
            Rows per page
            <select value={limit} onChange={(e) => onLimit(Number(e.target.value))}>
              {sizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="dt-pager-buttons">
          <button type="button" className="icon-btn" onClick={() => goTo(1)} disabled={page <= 1} aria-label="First page" title="First page">
            <ChevronsLeft size={16} />
          </button>
          <button type="button" className="icon-btn" onClick={() => goTo(page - 1)} disabled={page <= 1} aria-label="Previous page" title="Previous page">
            <ChevronLeft size={16} />
          </button>
          <form
            className="dt-page-input"
            onSubmit={(e) => {
              e.preventDefault();
              goTo(Number(pageInput) || 1);
            }}
          >
            <label>
              <span className="sr-only">Page number</span>
              Page{' '}
              <input
                inputMode="numeric"
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
                onBlur={() => goTo(Number(pageInput) || 1)}
                size={Math.max(2, String(totalPages).length)}
              />{' '}
              of {formatNumber(totalPages)}
            </label>
          </form>
          <button type="button" className="icon-btn" onClick={() => goTo(page + 1)} disabled={page >= totalPages} aria-label="Next page" title="Next page">
            <ChevronRight size={16} />
          </button>
          <button type="button" className="icon-btn" onClick={() => goTo(totalPages)} disabled={page >= totalPages} aria-label="Last page" title="Last page">
            <ChevronsRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// Search box that waits until typing pauses before searching.
export function SearchInput({ value, onChange, placeholder = 'Search…', label = 'Search' }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return undefined;
    const t = setTimeout(() => onChange(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text, value, onChange]);

  const id = useId();
  const inputRef = useRef(null);
  return (
    <div className="dt-search">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search size={16} aria-hidden="true" />
      <input id={id} ref={inputRef} type="search" value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} />
      {text && (
        <button
          type="button"
          className="dt-search-clear"
          onClick={() => {
            setText('');
            inputRef.current?.focus(); // the button disappears, so keep the keyboard in the search box
          }}
          aria-label="Clear search"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

// Compact labelled dropdown for toolbars.
export function FilterSelect({ label, value, onChange, options, allLabel = 'All' }) {
  return (
    <label className="dt-filter">
      <span className="dt-filter-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {allLabel !== null && <option value="">{allLabel}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DateFilter({ label, value, onChange, min, max }) {
  return (
    <label className="dt-filter">
      <span className="dt-filter-label">{label}</span>
      <input type="date" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function ClearFilters({ show, onClick }) {
  if (!show) return null;
  return (
    <button type="button" className="btn btn-link btn-sm" onClick={onClick}>
      <X size={14} /> Clear filters
    </button>
  );
}
