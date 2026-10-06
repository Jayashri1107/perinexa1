// Loads a drop-down list from an "options" address ({ items: [{ id, code, name }] }) as [{ value, label }].
import { useEffect, useState } from 'react';

export function useOptions(fetchOptions) {
  const [options, setOptions] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetchOptions()
      .then(({ items }) => !cancelled && setOptions(items.map((i) => ({ value: i.id, label: i.code ? `${i.name} (${i.code})` : i.name }))))
      .catch(() => !cancelled && setOptions([]));
    return () => {
      cancelled = true;
    };
  }, [fetchOptions]);
  return options;
}
