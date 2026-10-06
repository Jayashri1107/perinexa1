// Search the medicine list and pick one; shows what can be sold now and its MRP.
import { useEffect, useState } from 'react';
import { medicinesApi } from '../../api/index.js';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { formatMoney, labelOf } from '../../utils/format.js';

export function MedicineSearch({ onPick, label = 'Add a medicine', showStock = true }) {
  const { pharmacy } = useAppConfig();
  const [text, setText] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      medicinesApi
        .options(text.trim())
        .then((r) => !cancelled && setResults(r.items))
        .catch(() => !cancelled && setResults([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [text]);

  return (
    <div className="form-field picker">
      <label htmlFor="medicine-search">{label}</label>
      <div className="search">
        <input id="medicine-search" type="search" value={text} placeholder="Type a medicine name" onChange={(e) => setText(e.target.value)} autoComplete="off" />
      </div>
      {text && results.length > 0 && (
        <ul className="picker-results" role="listbox">
          {results.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected="false"
                disabled={showStock && m.available === 0}
                onClick={() => {
                  onPick(m);
                  setText('');
                }}
              >
                <strong>{m.name}</strong> {m.strength} <span className="muted">{labelOf(pharmacy.forms, m.form)}</span>
                {m.schedule !== pharmacy.schedules[0].key && <span className="badge badge-pending small">{labelOf(pharmacy.schedules, m.schedule)}</span>}
                {showStock && <span className="muted"> · {m.available} in stock{m.mrp ? ` · MRP ${formatMoney(m.mrp)}` : ''}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
