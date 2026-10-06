// Search box and filters above every list. filters: [{ name, label, options: [{ value, label }] }].
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';

const SEARCH_DELAY_MS = 350;

export function ListToolbar({ query, onFilter, searchPlaceholder = 'Search', filters = [] }) {
  const [text, setText] = useState(query.search ?? '');

  // Search after typing pauses, not on every key.
  useEffect(() => {
    if (text === (query.search ?? '')) return undefined;
    const t = setTimeout(() => onFilter('search', text.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [text, query.search, onFilter]);

  return (
    <div className="toolbar">
      <label className="search">
        <Search size={16} aria-hidden />
        <input type="search" value={text} placeholder={searchPlaceholder} aria-label={searchPlaceholder} onChange={(e) => setText(e.target.value)} />
      </label>
      {filters.map((f) => (
        <label key={f.name} className="filter">
          <span>{f.label}</span>
          <select value={query[f.name] ?? ''} onChange={(e) => onFilter(f.name, e.target.value)}>
            <option value="">All</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
