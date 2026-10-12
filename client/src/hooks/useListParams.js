import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Keeps a list's search, filters, sorting and page in the web address (e.g. ?search=ann&page=3),
 * so the Back button, page reloads and bookmarks keep them.
 * `defaults` lists every parameter with its default value (numbers stay numbers).
 * Changing any filter goes back to page 1.
 */
export function useListParams(defaults) {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultsKey = JSON.stringify(defaults);

  const params = useMemo(() => {
    const base = JSON.parse(defaultsKey);
    const out = { ...base };
    for (const key of Object.keys(base)) {
      const raw = searchParams.get(key);
      if (raw === null) continue;
      if (typeof base[key] === 'number') {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) out[key] = n;
      } else {
        out[key] = raw;
      }
    }
    return out;
  }, [searchParams, defaultsKey]);

  const setParams = useCallback(
    (changes) => {
      const base = JSON.parse(defaultsKey);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(changes)) {
            if (value === '' || value === null || value === undefined || value === base[key]) next.delete(key);
            else next.set(key, String(value));
          }
          if (!('page' in changes)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, defaultsKey],
  );

  const reset = useCallback(() => {
    const base = JSON.parse(defaultsKey);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of Object.keys(base)) next.delete(key);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams, defaultsKey]);

  return [params, setParams, reset];
}
