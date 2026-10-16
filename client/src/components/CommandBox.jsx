import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, CalendarPlus, Search, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { CARE_TYPE_SHORT, NEW_PATIENT_LINKS, ageText } from '../pages/patients/patientFormat.js';
import { canRegisterPatients, canSeePatients } from '../platform/modules.js';
import { bookingDay, commandsFrom, matchCommands, patientTerm } from './commandBox.js';
import { formatDate, useDialogFocus } from './ui.jsx';

// One box for everything (doctor ideas, 16 Oct 2026 – docs/IDEAS_FOR_LATER.md #1): Ctrl+K (or ⌘K) anywhere opens it.
// Type a page or an action from your own menu, "book Friday", or a patient (name, phone or patient number – "P-000003
// anaemia" finds P-000003); arrow keys and Enter, or click. Only your own menu is offered, and the patient search is
// the Patients page's own (the same rules for who sees what). Nothing typed goes into the page address.

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function Box({ modules, roles, onClose }) {
  const navigate = useNavigate();
  const ref = useDialogFocus(onClose);
  const listId = useId();
  const [text, setText] = useState('');
  const [found, setFound] = useState(null); // { for, patients }
  const [active, setActive] = useState(0);
  const commands = useMemo(
    () =>
      commandsFrom(
        modules,
        canRegisterPatients(roles) ? NEW_PATIENT_LINKS.map((l) => ({ label: `New patient – ${l.label}`, to: l.to, keywords: `new patient register ${l.label}` })) : [],
      ),
    [modules, roles],
  );
  const term = patientTerm(text);
  const seesPatients = canSeePatients(roles);
  useEffect(() => {
    if (!seesPatients || term.length < 2) {
      setFound(null);
      return undefined;
    }
    let current = true;
    const t = setTimeout(async () => {
      try {
        const res = await api('/patients', { query: { search: term, doctor: 'all', limit: 5, sort: 'fullName' } });
        if (current) setFound({ for: term, patients: res.patients });
      } catch {
        if (current) setFound({ for: term, patients: [] });
      }
    }, 250);
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [term, seesPatients]);

  const day = bookingDay(text, localToday());
  const items = [
    ...(day && roles.some((r) => ['receptionist', 'doctor'].includes(r)) ? [{ key: 'book', icon: CalendarPlus, label: `Book an appointment on ${formatDate(day)}`, to: `/appointments?date=${day}` }] : []),
    ...matchCommands(text, commands, text.trim() ? 6 : 8).map((c) => ({ key: `c-${c.to}-${c.label}`, icon: ArrowRight, label: c.label, to: c.to })),
    ...(found?.for === term ? found.patients : []).map((p) => ({
      key: `p-${p.id}`,
      icon: User,
      label: p.fullName,
      sub: [p.mrn, ageText(p), CARE_TYPE_SHORT[p.careType]].filter((x) => x && x !== '—').join(' · '),
      to: `/patients/${p.id}`,
    })),
  ];
  useEffect(() => setActive(0), [text]);
  const go = (item) => {
    onClose();
    navigate(item.to);
  };
  const onKeyDown = (e) => {
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(items[active] ?? items[0]);
    }
  };
  return (
    <div className="modal-backdrop cmd-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="cmd-box" role="dialog" aria-modal="true" aria-label="Go to">
        <div className="cmd-input">
          <Search aria-hidden="true" />
          <input
            autoFocus
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls={listId}
            aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
            placeholder={seesPatients ? 'A page, "book Friday", or a patient' : 'A page or an action'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={100}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd aria-hidden="true">Esc</kbd>
        </div>
        {items.length ? (
          <ul id={listId} role="listbox" className="cmd-list" aria-label="Go to">
            {items.map((it, i) => {
              const Icon = it.icon;
              return (
                <li
                  key={it.key}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? 'cmd-opt is-active' : 'cmd-opt'}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(it)}
                >
                  <Icon aria-hidden="true" />
                  <span>
                    <strong>{it.label}</strong>
                    {it.sub && <span className="muted tabular"> {it.sub}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="cmd-empty muted">Nothing found. Try a page name, "book tomorrow", or a patient's name or number.</p>
        )}
      </div>
    </div>
  );
}

/** Ctrl+K / ⌘K opens the box; also the small button in the title bar. */
export function CommandBox({ modules, roles = [] }) {
  const [open, setOpen] = useState(false);
  const opener = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        if (document.querySelector('[aria-modal="true"]') && !open) return; // another dialog is open
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  if (!modules.length) return null;
  return (
    <>
      <button ref={opener} type="button" className="cmd-open" onClick={() => setOpen(true)} title="Go to anything (Ctrl+K)">
        <kbd>Ctrl K</kbd>
        <span className="sr-only">Go to anything</span>
      </button>
      {open && (
        <Box
          modules={modules}
          roles={roles}
          onClose={() => {
            setOpen(false);
            opener.current?.focus();
          }}
        />
      )}
    </>
  );
}
