import { useEffect, useId, useRef, useState } from 'react';
import { Lock, Search } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { CARE_TYPE_SHORT, ageText } from '../pages/patients/patientFormat.js';
import { RiskBadge } from '../pages/patients/RiskCard.jsx';

// "Find a patient" in the title bar of every screen (for those who work with patient records): type a name, phone
// or patient number, then choose from the list (arrow keys and Enter, or click). Press "/" anywhere to start typing.
// What is typed never goes into the page address (it would stay in the browser's history); the list is the same
// search as on the Patients page, so who may see what follows the same rules.

const MAX_SHOWN = 8;
const WAIT_MS = 250;

export function PatientSearch() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const listId = useId();
  const inputRef = useRef(null);
  const boxRef = useRef(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(null); // { for, patients, total } | { for, error }
  const [active, setActive] = useState(0);
  const term = text.trim();

  // Search after a short pause in typing; an older answer never replaces a newer one.
  useEffect(() => {
    if (term.length < 2) {
      setResult(null);
      return undefined;
    }
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const res = await api('/patients', { query: { search: term, doctor: 'all', limit: MAX_SHOWN, sort: 'fullName' } });
        if (current) setResult({ for: term, patients: res.patients, total: res.total });
      } catch (err) {
        if (current) setResult({ for: term, error: err.message });
      }
      if (current) setActive(0);
    }, WAIT_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [term]);

  // Another page: start again.
  useEffect(() => {
    setText('');
    setOpen(false);
  }, [pathname]);

  // "/" anywhere (not while typing in a field) puts the cursor in the search box.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (document.querySelector('[aria-modal="true"]')) return; // a dialog is open
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // A click outside closes the list.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!boxRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const patients = result?.patients ?? [];
  const showList = open && term.length >= 2 && result?.for === term;
  const choose = (p) => {
    setText('');
    setOpen(false);
    inputRef.current?.blur();
    navigate(`/patients/${p.id}`);
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (open && text) setOpen(false);
      else {
        setText('');
        inputRef.current?.blur();
      }
      return;
    }
    if (!showList || !patients.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % patients.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + patients.length) % patients.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(patients[active] ?? patients[0]);
    }
  };

  const optionId = (i) => `${listId}-opt-${i}`;
  return (
    <div className="ps" ref={boxRef}>
      <Search className="ps-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        className="ps-input"
        role="combobox"
        aria-label="Find a patient"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && patients.length ? optionId(active) : undefined}
        placeholder="Find a patient: name, phone or patient no."
        autoComplete="off"
        spellCheck={false}
        maxLength={100}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {!text && (
        <kbd className="ps-key" aria-hidden="true">
          /
        </kbd>
      )}
      {showList && (
        <div className="ps-pop">
          {result.error ? (
            <p className="ps-note" role="alert">
              {result.error}
            </p>
          ) : patients.length === 0 ? (
            <p className="ps-note" role="status">
              No patient found for “{term}”.
            </p>
          ) : (
            <>
              <ul id={listId} role="listbox" aria-label="Patients found" className="ps-list">
                {patients.map((p, i) => (
                  <li
                    key={p.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? 'ps-opt is-active' : 'ps-opt'}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(p)}
                  >
                    <span className="ps-name">
                      <strong>{p.fullName}</strong>
                      {p.sensitive && <Lock className="ps-lock" aria-label="Sensitive record" />}
                    </span>
                    {/* A record marked as a duplicate is found only by its own patient number: it says where the main record is */}
                    <span className="ps-sub tabular">
                      {[p.mrn, ageText(p), CARE_TYPE_SHORT[p.careType], p.phone, p.duplicateOf ? `Duplicate of ${p.duplicateOf.mrn}` : null, p.closed ? 'Record closed' : null].filter((x) => x && x !== '—').join(' · ')}
                    </span>
                    {p.risk?.level && <RiskBadge risk={p.risk} />}
                  </li>
                ))}
              </ul>
              {result.total > patients.length && (
                <p className="ps-note" role="status">
                  {patients.length} of {result.total} shown – type more of the name, or the patient number.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
