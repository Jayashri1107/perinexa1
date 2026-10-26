import { useState } from 'react';
import { CalendarPlus, Check, CheckCircle2, ChevronRight, Clock, DoorOpen, Hourglass, PhoneCall, Stethoscope, TriangleAlert, UserPlus, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDialogFocus } from '../components/ui.jsx';
import { RegisterAndBook } from './appointments/RegisterAndBook.jsx';
import { timeLabel } from './appointments/appointmentFormat.js';
import { DetailsMissing } from './DetailsMissing.jsx';

// Reception's desk (26 Oct 2026): the live queue's states and words (expected, waiting, in consultation – her visit
// started –, completed), the Register dialog of the search boxes, and To do – the desk's jobs as one short list, only
// those with someone in them, each opening its list or dialog. The dashboard itself: ReceptionDashboard.jsx.
// Identity details only: the same search, rights and dialogs as everywhere else.

const digitsOf = (s) => s.replace(/\D/g, '');

// ---------- The live queue (26 Oct 2026) ----------

/** Each state of a patient today, as colour + icon + word (GET /api/today: patients[].queue). */
export const QUEUE_LOOK = {
  expected: { tone: 'due', icon: Clock, label: 'Expected' },
  waiting: { tone: 'watch', icon: Hourglass, label: 'Waiting' },
  with_doctor: { tone: 'admitted', icon: Stethoscope, label: 'In consultation' },
  done: { tone: 'stable', icon: CheckCircle2, label: 'Completed' },
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

/** Register the patient of a booking made by name and phone (reception's table): her booking joins her record. */
export function RegisterBookingDialog({ appointment: a, onClose, onRegistered }) {
  return (
    <Dialog id="rc-register-booking" title={`Fill info – ${a.guest?.name ?? 'the patient'}`} onClose={onClose}>
      <p className="muted">Booked by name and phone. Fill in her details and save: her booking joins her record.</p>
      <RegisterAndBook doctor={{ id: a.doctorId, name: a.doctorName }} appointment={a} defaultCareType="gynaecology" onBooked={(_, p) => onRegistered(p)} onCancel={onClose} />
    </Dialog>
  );
}

/** Register a new patient in a dialog, with the phone or name already typed (reception's search boxes). */
export function RegisterDialog({ text = '', onClose, onRegistered }) {
  return (
    <Dialog id="rc-register" title="Register new patient" onClose={onClose}>
      <RegisterAndBook registerOnly prefill={prefillFrom(text)} onBooked={(_, p) => onRegistered(p)} onCancel={onClose} />
    </Dialog>
  );
}

/**
 * The desk's jobs (counts from the page's lists): only rows with someone in them, each opening its list (a link
 * to "#…" opens the box further down) – Details missing opens its list in a dialog. All done: one calm line.
 */
export function TodoPanel({ calls = 0, incomplete = [], toRegister = 0, toCollect = 0, toConfirm = 0, discharges = 0, onOpenList = null, onSaved }) {
  const [missingOpen, setMissingOpen] = useState(false);
  const rows = [
    calls > 0 && { key: 'calls', icon: PhoneCall, label: 'Calls to make', sub: 'Visits due or overdue, babies – not booked', count: calls, to: '/follow-ups' },
    incomplete.length > 0 && { key: 'missing', icon: TriangleAlert, label: 'Details missing', sub: 'Registered without all their details', count: incomplete.length, onClick: () => setMissingOpen(true), watch: true },
    toRegister > 0 && { key: 'guests', icon: UserPlus, label: 'Details to fill', sub: 'Booked by name and phone today', count: toRegister, to: '/#td-guests', list: 'guests' },
    toCollect > 0 && { key: 'collect', icon: Wallet, label: 'Payments to collect', sub: 'Here today or discharged, bill not settled', count: toCollect, to: '/#td-collect', list: 'collect' },
    toConfirm > 0 && { key: 'tomorrow', icon: CalendarPlus, label: 'Tomorrow – call to confirm', sub: "Tomorrow's bookings", count: toConfirm, to: '/#td-tomorrow', list: 'tomorrow' },
    discharges > 0 && { key: 'discharges', icon: DoorOpen, label: 'Discharges', sub: 'Being discharged today', count: discharges, to: '/#td-discharges', list: 'discharges' },
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
                {r.list && onOpenList ? (
                  <button type="button" className="rc-todo-row" onClick={() => onOpenList(r.list)}>
                    {body}
                  </button>
                ) : r.to ? (
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
