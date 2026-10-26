import { useEffect, useState } from 'react';
import { CalendarPlus, Check, CheckCircle2, ChevronRight, Clock, DoorOpen, Hourglass, PenLine, PhoneCall, Printer, RefreshCw, Search, Siren, Stethoscope, TriangleAlert, UserCheck, UserPlus, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Alert, StatusPill, formatTime, useDialogFocus } from '../components/ui.jsx';
import { EditPatientDialog, RegisterAndBook } from './appointments/RegisterAndBook.jsx';
import { timeLabel } from './appointments/appointmentFormat.js';
import { DetailsMissing } from './DetailsMissing.jsx';

// Reception's Today, redesigned (26 Oct 2026: "simple, easy and attractive for the receptionist"):
//  - DeskSearch: one box first – her phone, name or patient number – each patient found with what the desk does next
//    (Mark arrived, Book, Edit details); nobody found: Register her in a dialog, the phone or name already typed in;
//  - QueueBoard: the live queue – every patient of the day with her state (expected, waiting, with the doctor, done),
//    emergencies first, and the buttons for each (Mark arrived, Emergency, Mark done, Undo), refreshed every 30 s;
//  - TodoPanel: the desk's jobs as one short list – only those with someone in them – each opening its list or dialog.
// Identity details only: the same search, rights and dialogs as everywhere else.

const digitsOf = (s) => s.replace(/\D/g, '');

// ---------- The live queue (26 Oct 2026) ----------

/** Each state of a patient today, as colour + icon + word (GET /api/today: patients[].queue). */
export const QUEUE_LOOK = {
  expected: { tone: 'due', icon: Clock, label: 'Expected' },
  waiting: { tone: 'watch', icon: Hourglass, label: 'Waiting' },
  with_doctor: { tone: 'admitted', icon: Stethoscope, label: 'With the doctor' },
  done: { tone: 'stable', icon: CheckCircle2, label: 'Done' },
};
export const QUEUE_ORDER = ['expected', 'waiting', 'with_doctor', 'done'];

/** How many are in each state, and how many emergencies are still in the queue. */
export function queueCounts(rows = []) {
  const out = { all: rows.length, expected: 0, waiting: 0, with_doctor: 0, done: 0, emergency: 0 };
  for (const r of rows) {
    out[r.queue ?? (r.arrivedAt ? 'waiting' : 'expected')] += 1;
    if (r.emergency && r.queue !== 'done') out.emergency += 1;
  }
  return out;
}

/** Her time today: the booked time, the walk-in token, or what is still missing. */
export function queueWhen(r) {
  const a = r.appointment;
  if (!a) return r.booked ? 'Booked' : 'No booking';
  if (a.kind === 'token') return `Token ${a.token}`;
  return a.start ? timeLabel(a.start) : 'No time yet';
}

/** "Updated 10:32" – when the lists were last loaded. */
const updatedLabel = (at) => (at ? `Updated ${at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : '');

/**
 * Reception's queue board: everyone on today's list, one row each – her time or token, name, doctor, state and the
 * desk's buttons, without opening anything. The strip above filters by state. Emergencies come first (the server
 * orders the rows) and are marked in words and colour. onMark(p, row), onUndo(p), onFlag(p, 'emergency' | 'left', on),
 * onSlip(appointment); busy: the patient being saved; updatedAt / onRefresh: the automatic refresh.
 */
export function QueueBoard({ rows = [], canMark = true, onMark, onUndo, onFlag, onSlip, busy = null, updatedAt = null, onRefresh }) {
  const [filter, setFilter] = useState('');
  const n = queueCounts(rows);
  const shown = filter ? rows.filter((r) => (r.queue ?? 'expected') === filter) : rows;
  return (
    <section className="card rc-queue" id="td-patients" aria-labelledby="rc-queue-title" tabIndex={-1}>
      <div className="rc-queue-head">
        <h2 id="rc-queue-title">Today&apos;s queue</h2>
        {n.emergency > 0 && (
          <StatusPill tone="high" icon={Siren}>
            {n.emergency} emergency
          </StatusPill>
        )}
        <span className="rc-updated muted">
          {updatedLabel(updatedAt)} · refreshes every 30 seconds{' '}
          <button type="button" className="btn btn-link btn-sm" onClick={onRefresh}>
            <RefreshCw aria-hidden="true" /> Refresh now
          </button>
        </span>
      </div>
      <div className="rc-strip" role="group" aria-label="Show">
        <button type="button" aria-pressed={!filter} onClick={() => setFilter('')}>
          <span className="rc-strip-count tabular">{n.all}</span> All
        </button>
        {QUEUE_ORDER.map((k) => {
          const look = QUEUE_LOOK[k];
          return (
            <button key={k} type="button" className={`is-${k}`} aria-pressed={filter === k} onClick={() => setFilter(filter === k ? '' : k)}>
              <look.icon aria-hidden="true" />
              <span className="rc-strip-count tabular">{n[k]}</span> {look.label}
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? (
        <p className="panel-empty">{rows.length ? 'Nobody in this state right now.' : 'Nobody is booked for today, and nobody has arrived yet.'}</p>
      ) : (
        <ul className="rc-queue-list">
          {shown.map((r) => {
            const state = r.queue ?? (r.arrivedAt ? 'waiting' : 'expected');
            const look = QUEUE_LOOK[state];
            const p = r.patient;
            const saving = busy === p.id;
            const inQueue = state === 'waiting' || state === 'with_doctor';
            return (
              <li key={p.id} className={`rc-queue-row is-${state}${r.emergency && state !== 'done' ? ' is-emergency' : ''}`}>
                <span className="rc-queue-when tabular">{queueWhen(r)}</span>
                <span className="rc-who">
                  <Link to={`/patients/${p.id}`}>{p.fullName}</Link>
                  <span className="muted tabular">
                    {[p.mrn, p.phone, r.appointment?.doctorName ?? p.doctorName, r.arrivedAt ? `arrived ${formatTime(r.arrivedAt)}` : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="rc-queue-state">
                  {r.emergency && state !== 'done' && (
                    <StatusPill tone="high" icon={Siren}>
                      Emergency
                    </StatusPill>
                  )}
                  <StatusPill tone={look.tone} icon={look.icon}>
                    {look.label}
                  </StatusPill>
                </span>
                {canMark && (
                  <span className="rc-actions">
                    {state === 'expected' && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onMark(p, r)} disabled={saving}>
                        <UserCheck aria-hidden="true" /> Mark arrived
                      </button>
                    )}
                    {inQueue && r.arrivalMarked && (
                      <button
                        type="button"
                        className={`btn btn-sm ${r.emergency ? 'btn-link' : 'btn-secondary'}`}
                        onClick={() => onFlag(p, 'emergency', !r.emergency)}
                        disabled={saving}
                        aria-label={r.emergency ? `${p.fullName} is not an emergency` : `${p.fullName} is an emergency – see first`}
                      >
                        <Siren aria-hidden="true" /> {r.emergency ? 'Not an emergency' : 'Emergency'}
                      </button>
                    )}
                    {inQueue && r.arrivalMarked && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onFlag(p, 'left', true)} disabled={saving} aria-label={`${p.fullName} is done – she left`}>
                        <CheckCircle2 aria-hidden="true" /> Mark done
                      </button>
                    )}
                    {state === 'waiting' && r.arrivalMarked && !r.visitStarted && (
                      <button type="button" className="btn btn-link btn-sm" onClick={() => onUndo(p)} disabled={saving} aria-label={`Undo arrival of ${p.fullName}`}>
                        Undo arrival
                      </button>
                    )}
                    {state === 'done' && r.leftMarked && (
                      <button type="button" className="btn btn-link btn-sm" onClick={() => onFlag(p, 'left', false)} disabled={saving} aria-label={`Undo done for ${p.fullName}`}>
                        Undo done
                      </button>
                    )}
                    {r.appointment?.kind === 'token' && (
                      <button type="button" className="btn btn-link btn-sm" onClick={() => onSlip({ ...r.appointment, doctor: { name: r.appointment.doctorName } })} aria-label={`Print the slip for token ${r.appointment.token}`}>
                        <Printer aria-hidden="true" /> Slip
                      </button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

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
