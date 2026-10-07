// Find a patient by name, number or phone and pick her (name and number only). `search` returns { items }.
import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export function PatientPicker({ search, value, onChange, label = 'Patient', error }) {
  const [text, setText] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (value || text.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      search(text.trim())
        .then((r) => !cancelled && setResults(r.items))
        .catch(() => !cancelled && setResults([]))
        .finally(() => !cancelled && setSearching(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [text, value, search]);

  if (value) {
    return (
      <div className="form-field">
        <span className="field-label">{label}</span>
        <div className="picked">
          <strong>{value.name}</strong> <span className="muted">{value.patientNumber}</span>
          <button type="button" className="icon-btn" aria-label="Choose another patient" onClick={() => onChange(null)}>
            <X size={15} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`form-field picker${error ? ' has-error' : ''}`}>
      <label htmlFor="patient-search">{label}</label>
      <div className="search">
        <Search size={16} aria-hidden />
        <input id="patient-search" type="search" value={text} placeholder="Name, patient number or phone" onChange={(e) => setText(e.target.value)} autoComplete="off" />
      </div>
      {results.length > 0 && (
        <ul className="picker-results" role="listbox">
          {results.map((p) => (
            <li key={p.id}>
              <button type="button" role="option" aria-selected="false" onClick={() => onChange(p)}>
                <strong>{p.name}</strong> <span className="muted">{p.patientNumber}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {text.trim().length >= 2 && searching && <span className="field-help">Searching…</span>}
      {text.trim().length >= 2 && !searching && results.length === 0 && (
        <span className="field-help">No patient found in this hospital. Check the spelling, or register her first.</span>
      )}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
