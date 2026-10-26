import { useEffect, useState } from 'react';
import { CalendarPlus, Check, ChevronRight, DoorOpen, PenLine, PhoneCall, Search, TriangleAlert, UserCheck, UserPlus, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Alert, StatusPill, formatTime, useDialogFocus } from '../components/ui.jsx';
import { EditPatientDialog, RegisterAndBook } from './appointments/RegisterAndBook.jsx';
import { DetailsMissing } from './DetailsMissing.jsx';

// Reception's Today, redesigned (26 Oct 2026: "simple, easy and attractive for the receptionist"):
//  - DeskSearch: one box first – her phone, name or patient number – each patient found with what the desk does next
//    (Mark arrived, Book, Edit details); nobody found: Register her in a dialog, the phone or name already typed in;
//  - TodoPanel: the desk's jobs as one short list – only those with someone in them – each opening its list or dialog.
// Identity details only: the same search, rights and dialogs as everywhere else.

const digitsOf = (s) => s.replace(/\D/g, '');

/** What was typed, as the first details of a new patient: digits are her phone, words her name. */
export function prefillFrom(text) {
  const t = text.trim();
  if (!t) return {};
  return digitsOf(t).length >= 6 && /^[\d\s+()-]+$/.test(t) ? { phone: t } : /\d/.test(t) ? {} : { fullName: t };
}

function Dialog({ id, title, onClose, children }) {
  const ref = useDialogFocus(onClose);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="modal modal-wide modal-register" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/**
 * The search box at the top of reception's Today. todayRows: today's patients (GET /api/today), to show who has
 * arrived; onArrive(patient), busyId: Mark arrived as on the list below; onSaved(message): a dialog saved.
 */
export function DeskSearch({ todayRows = [], onArrive, busyId = null, onSaved }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [editing, setEditing] = useState(null);
  const [registering, setRegistering] = useState(false);
  const term = text.trim();
  useEffect(() => {
    if (term.length < 2) {
      setResult(null);
      return undefined;
    }
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const res = await api('/patients', { query: { search: term, doctor: 'all', limit: 6, sort: 'fullName' } });
        if (current) setResult({ patients: res.patients });
      } catch (err) {
        if (current) setResult({ error: err.message });
      }
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [term]);
  const rowOf = (p) => todayRows.find((r) => r.patient.id === p.id);

  return (
    <section className="rc-search" aria-label="Find a patient">
      <label className="rc-search-box">
        <Search aria-hidden="true" />
        <span className="sr-only">Phone, name or patient number</span>
        <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Phone, name or patient number" autoComplete="off" />
      </label>
      {result?.error && <Alert type="error">{result.error}</Alert>}
      {result?.patients && (
        <ul className="rc-results" aria-label="Patients found">
          {result.patients.map((p) => {
            const row = rowOf(p);
            const usable = !p.closed && !p.duplicateOf;
            return (
              <li key={p.id} className="rc-result">
                <span className="rc-who">
                  <Link to={`/patients/${p.id}`}>{p.fullName}</Link>
                  <span className="muted tabular">{[p.mrn, p.phone, p.assignedDoctorName].filter(Boolean).join(' · ')}</span>
                  {p.duplicateOf && <span className="hint">Duplicate of {p.duplicateOf.mrn} – use {p.duplicateOf.mrn}</span>}
                  {p.closed && <span className="hint">Record closed – takes no appointment</span>}
                </span>
                {usable && (
                  <span className="rc-actions">
                    {row?.arrivedAt ? (
                      <StatusPill tone="stable" icon={UserCheck}>
                        Arrived · {formatTime(row.arrivedAt)}
                      </StatusPill>
                    ) : (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onArrive(p, row)} disabled={busyId === p.id}>
                        <UserCheck aria-hidden="true" /> Mark arrived
                      </button>
                    )}
                    <Link to={`/patients/${p.id}/appointments`} className="btn btn-secondary btn-sm">
                      <CalendarPlus aria-hidden="true" /> Book
                    </Link>
                    <button type="button" className="btn btn-link btn-sm" onClick={() => setEditing(p)} aria-label={`Edit the details of ${p.fullName}`}>
                      <PenLine aria-hidden="true" /> Edit details
                    </button>
                  </span>
                )}
              </li>
            );
          })}
          <li className="rc-result rc-new">
            <span className="muted">{result.patients.length ? 'Not the right person?' : 'No patient found.'}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRegistering(true)}>
              <UserPlus aria-hidden="true" /> Register new patient
            </button>
          </li>
        </ul>
      )}
      {editing && (
        <EditPatientDialog
          patientId={editing.id}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            setEditing(null);
            onSaved(`Saved: the details of ${p?.fullName ?? editing.fullName}.`);
          }}
        />
      )}
      {registering && (
        <Dialog id="rc-register" title="Register new patient" onClose={() => setRegistering(false)}>
          <RegisterAndBook
            registerOnly
            prefill={prefillFrom(text)}
            onBooked={(_, p) => {
              setRegistering(false);
              setText(p.mrn); // she is found at once, with Mark arrived and Book
              onSaved(`${p.fullName} is registered as ${p.mrn}.`);
            }}
            onCancel={() => setRegistering(false)}
          />
        </Dialog>
      )}
    </section>
  );
}

/**
 * The desk's jobs (counts from the page's lists): only rows with someone in them, each opening its list (a link
 * to "#…" opens the box further down) – Details missing opens its list in a dialog. All done: one calm line.
 */
export function TodoPanel({ calls = 0, incomplete = [], toRegister = 0, toCollect = 0, toConfirm = 0, discharges = 0, onSaved }) {
  const [missingOpen, setMissingOpen] = useState(false);
  const rows = [
    calls > 0 && { key: 'calls', icon: PhoneCall, label: 'Calls to make', sub: 'Visits due or overdue, babies – not booked', count: calls, to: '/follow-ups' },
    incomplete.length > 0 && { key: 'missing', icon: TriangleAlert, label: 'Details missing', sub: 'Registered without all their details', count: incomplete.length, onClick: () => setMissingOpen(true), watch: true },
    toRegister > 0 && { key: 'guests', icon: UserPlus, label: 'Bookings to register', sub: 'Booked by name and phone today', count: toRegister, to: '/#td-guests' },
    toCollect > 0 && { key: 'collect', icon: Wallet, label: 'Payments to collect', sub: 'Here today or discharged, bill not settled', count: toCollect, to: '/#td-collect' },
    toConfirm > 0 && { key: 'tomorrow', icon: CalendarPlus, label: 'Tomorrow – call to confirm', sub: "Tomorrow's bookings", count: toConfirm, to: '/#td-tomorrow' },
    discharges > 0 && { key: 'discharges', icon: DoorOpen, label: 'Discharges', sub: 'Being discharged today', count: discharges, to: '/#td-discharges' },
  ].filter(Boolean);
  return (
    <section className="card rc-todo" aria-labelledby="rc-todo-title">
      <h2 id="rc-todo-title">To do</h2>
      {rows.length === 0 ? (
        <p className="rc-done">
          <Check aria-hidden="true" /> Nothing waiting. All calls, details and payments are done.
        </p>
      ) : (
        <ul>
          {rows.map((r) => {
            const body = (
              <>
                <span className={`rc-todo-icon${r.watch ? ' is-watch' : ''}`} aria-hidden="true">
                  <r.icon />
                </span>
                <span className="rc-todo-text">
                  <strong>{r.label}</strong>
                  <span className="muted">{r.sub}</span>
                </span>
                <span className="rc-todo-count tabular">{r.count}</span>
                <ChevronRight aria-hidden="true" className="rc-todo-go" />
              </>
            );
            return (
              <li key={r.key}>
                {r.to ? (
                  <Link to={r.to} className="rc-todo-row">
                    {body}
                  </Link>
                ) : (
                  <button type="button" className="rc-todo-row" onClick={r.onClick}>
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {missingOpen && (
        <Dialog id="rc-missing" title={`Details missing (${incomplete.length})`} onClose={() => setMissingOpen(false)}>
          <DetailsMissing
            inDialog
            rows={incomplete}
            onSaved={(p) => {
              setMissingOpen(false);
              onSaved(`Saved: the details of ${p.fullName}.`);
            }}
          />
          <div className="row">
            <button type="button" className="btn btn-link" onClick={() => setMissingOpen(false)}>
              Close
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
