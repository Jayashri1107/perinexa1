import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

/**
 * Loads data from the server and reloads whenever the path or query changes.
 * While a new page loads, the previous rows stay on screen (no flicker when paging through big lists).
 * Pass path = null to skip loading.
 * On an error, `status` holds the server's HTTP status (e.g. 400, 403), or null when the server could not be reached.
 */
export function useFetch(path, query) {
  const key = path ? `${path}?${JSON.stringify(query ?? {})}` : null;
  const [state, setState] = useState({ data: null, error: null, status: null, loading: Boolean(path) });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    const [p, q] = [key.slice(0, key.indexOf('?')), JSON.parse(key.slice(key.indexOf('?') + 1))];
    api(p, { query: q })
      .then((data) => !cancelled && setState({ data, error: null, status: null, loading: false }))
      .catch((err) => !cancelled && setState((s) => ({ ...s, error: err.message, status: err.status || null, loading: false })));
    return () => {
      cancelled = true;
    };
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
