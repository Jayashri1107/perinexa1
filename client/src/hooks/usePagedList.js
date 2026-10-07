// State for any paged list: page, rows per page, search and filters, loading and errors.
// fetchPage must be stable (useCallback) and return the server's { items, pagination }.
import { useCallback, useEffect, useState } from 'react';
import { useAppConfig } from '../context/AppConfigContext.jsx';

export function usePagedList(fetchPage, initialFilters = {}) {
  const { pagination: settings } = useAppConfig();
  const [query, setQuery] = useState({ page: 1, limit: settings.defaultLimit, search: '', ...initialFilters });
  const [result, setResult] = useState({ items: [], pagination: null, loading: true, error: '' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setResult((r) => ({ ...r, loading: true, error: '' }));
    fetchPage(query)
      .then((data) => !cancelled && setResult({ items: data.items, pagination: data.pagination, summary: data.summary ?? null, loading: false, error: '' }))
      .catch((err) => !cancelled && setResult((r) => ({ ...r, loading: false, error: err.message })));
    return () => {
      cancelled = true;
    };
  }, [fetchPage, query, reloadKey]);

  const setFilter = useCallback((name, value) => setQuery((q) => ({ ...q, [name]: value, page: 1 })), []);
  const setPage = useCallback((page) => setQuery((q) => ({ ...q, page })), []);
  const setLimit = useCallback((limit) => setQuery((q) => ({ ...q, limit, page: 1 })), []);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return { ...result, query, setFilter, setPage, setLimit, reload };
}
