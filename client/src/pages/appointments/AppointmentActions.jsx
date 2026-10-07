// The buttons for one appointment (what this person may do with it now) and the dialog they open.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { appointmentsApi } from '../../api/index.js';
import { CancelDialog, LinkDialog, MoveDialog } from './AppointmentDialogs.jsx';

export function AppointmentActions({ appointment: a, today, canBook, canMarkSeen, doctors, onChanged, onError, showPatientLink = true }) {
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const isToday = a.date === today;
  const ahead = a.date >= today;

  const quick = async (action) => {
    setBusy(true);
    try {
      onChanged((await action(a.id)).appointment);
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(false);
    }
  };
  const done = (appointment) => {
    setDialog(null);
    onChanged(appointment);
  };

  return (
    <div className="row-actions">
      {isToday && a.status === 'booked' && a.patient && (
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => quick(appointmentsApi.arrive)}>Arrived</button>
      )}
      {isToday && a.status === 'arrived' && canMarkSeen && (
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => quick(appointmentsApi.seen)}>Seen</button>
      )}
      {isToday && a.status === 'arrived' && (
        <button type="button" className="btn btn-link btn-sm" disabled={busy} onClick={() => quick(appointmentsApi.undoArrival)}>Undo arrival</button>
      )}
      {canBook && a.status === 'booked' && !a.patient && a.guest && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog('link')}>Link to record</button>
      )}
      {canBook && a.kind === 'slot' && a.status === 'booked' && ahead && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog('move')}>{a.needsTime ? 'Give a time' : 'Move'}</button>
      )}
      {canBook && ['booked', 'arrived'].includes(a.status) && ahead && a.kind === 'slot' && (
        <button type="button" className="btn btn-link btn-sm btn-danger-text" onClick={() => setDialog('cancel')}>Cancel</button>
      )}
      {showPatientLink && a.patient && <Link className="btn btn-link btn-sm" to={`/hospital/patients/${a.patient.id}`}>Record</Link>}

      {dialog === 'move' && <MoveDialog appointment={a} doctors={doctors} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'cancel' && <CancelDialog appointment={a} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'link' && <LinkDialog appointment={a} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}
