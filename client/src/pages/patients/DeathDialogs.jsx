import { useState } from 'react';
import { Archive } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, Field, FieldError, StatusPill, formatDate, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';
import { timeLabel } from '../appointments/appointmentFormat.js';
import { CLOSED_TAKES_NOTHING, DEATH_PLACES, DEATH_TIMINGS, TIMING_HINT, ageHint, deathFacts, diedOnText, localDay, recordedMessage, undoReasonProblem, undoneLine, undoneMessage } from './deathFormat.js';

// A death recorded on a record, with great care (5 Oct 2026). Only a doctor of the record records it (or undoes one
// recorded in error), after a confirmation that names the patient; the server checks who may, and the date. The
// record is then CLOSED: it stays readable but takes nothing new, and gets no reminder or message of any kind. The
// banner is quiet – a grey status with an icon and words, nothing alarming. Those who may not see the medical details
// (reception) read only that the record is closed, never why.

/** On a closed record, on every tab: "Died on …" for those who see the medical details, "Record closed" for the rest. */
export function ClosedBanner({ patient, onUndo }) {
  if (!patient.closed) return null;
  const d = patient.death;
  const baby = patient.careType === 'newborn';
  return (
    <Alert type="neutral" icon={null}>
      <div className="closed-banner">
        <StatusPill tone="inactive" icon={Archive}>
          {d ? diedOnText(d, formatDate) : 'Record closed'}
        </StatusPill>
        <span className="closed-banner-text">
          {d && deathFacts(d, { baby }) ? `${deathFacts(d, { baby })}. ` : ''}
          {d ? 'This record is closed. ' : ''}
          {CLOSED_TAKES_NOTHING}
          {d?.byName ? (
            <span className="dup-meta">
              Recorded by {d.byName}
              {d.at ? ` on ${formatDateTime(d.at)}` : ''}.
            </span>
          ) : null}
        </span>
        {patient.access?.canUndoDeath && (
          <button type="button" className="btn btn-secondary btn-sm dup-undo" onClick={onUndo}>
            Undo – recorded in error
          </button>
        )}
      </div>
    </Alert>
  );
}

/** Deaths recorded on this record in error and undone (for those who see the medical details). */
export function DeathHistory({ patient }) {
  const history = patient.deathHistory ?? [];
  if (!history.length) return null;
  const baby = patient.careType === 'newborn';
  return (
    <details className="override-history">
      <summary>Deaths recorded in error and undone ({history.length})</summary>
      <ul>
        {history.map((h, i) => (
          <li key={i}>{undoneLine(h, { formatDate, formatDateTime, baby })}</li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Pop-up: record a death (a doctor of the record). A baby's record: the date and the place – the age in days is
 * worked out from the date of birth. Every other record: the date and when it was in relation to the pregnancy.
 * There is no cause-of-death field. Saved only after the doctor ticks that this is the right patient.
 * onDone(message): recorded; the page reloads the record.
 */
export function RecordDeathDialog({ patient, onDone, onCancel }) {
  const baby = patient.careType === 'newborn';
  const today = localDay(new Date());
  const [on, setOn] = useState('');
  const [place, setPlace] = useState('');
  const [timing, setTiming] = useState('');
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const ref = useDialogFocus(busy ? undefined : onCancel);
  const birthAt = patient.newborn?.birthAt ?? null;

  const save = async (e) => {
    e.preventDefault();
    const problems = {
      ...(on ? {} : { on: 'Enter the date of death.' }),
      ...(baby && !place ? { place: 'Choose where the baby died.' } : {}),
      ...(!baby && !timing ? { timing: 'Choose when it was.' } : {}),
      ...(sure ? {} : { confirmed: `Tick to confirm that this is the record of ${patient.fullName}.` }),
    };
    setFieldErrors(problems);
    setError(null);
    if (Object.keys(problems).length) return;
    setBusy(true);
    try {
      const result = await api(`/patients/${patient.id}/death`, { method: 'PUT', body: { on, ...(baby ? { place } : { timing }), confirmed: true } });
      onDone(recordedMessage(result, { baby }));
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
      setBusy(false);
    }
  };

  const fieldProblem = fieldErrors.on || fieldErrors.place || fieldErrors.timing || fieldErrors.confirmed;
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="death-title" onSubmit={save} noValidate>
        <h2 id="death-title">Record a death</h2>
        <p className="hint">
          {patient.fullName} · <span className="tabular">{patient.mrn}</span>
        </p>
        <p className="hint">
          Only when the death is certain. The record is then closed: it stays readable, but takes nothing new. {baby ? "The baby's" : 'Her'} booked appointments from today on are
          cancelled without a message, the messages waiting for {baby ? 'the family' : 'her'} are stopped, and patient portal access ends. There is no cause of death here: write it in
          the notes of the stay or the discharge card. If it was recorded in error, a doctor can undo it.
        </p>
        <Alert type="error">{fieldProblem ? null : error}</Alert>
        {/* (a mother's record: one field under the other – the timings are long, and half the width cut off the chosen one) */}
        <div className={baby ? 'form-grid' : undefined}>
          <Field label="Date of death" id="death-on" error={fieldErrors.on} hint={baby ? ageHint(birthAt, on, formatDate) : undefined} keepHint={baby}>
            <input id="death-on" type="date" value={on} max={today} onChange={(e) => setOn(e.target.value)} disabled={busy} autoFocus />
          </Field>
          {baby ? (
            <Field label="Where the baby died" id="death-place" error={fieldErrors.place}>
              <select id="death-place" value={place} onChange={(e) => setPlace(e.target.value)} disabled={busy}>
                <option value="">Choose…</option>
                {Object.entries(DEATH_PLACES).map(([k, w]) => (
                  <option key={k} value={k}>
                    {w}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="When was it?" id="death-timing" error={fieldErrors.timing} hint={TIMING_HINT} keepHint>
              <select id="death-timing" value={timing} onChange={(e) => setTiming(e.target.value)} disabled={busy}>
                <option value="">Choose…</option>
                {Object.entries(DEATH_TIMINGS).map(([k, w]) => (
                  <option key={k} value={k}>
                    {w}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <div className={`field ${fieldErrors.confirmed ? 'has-error' : ''}`}>
          <label className="check">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} disabled={busy} aria-describedby={fieldErrors.confirmed ? 'death-confirm-error' : undefined} />
            <span>
              I have checked that this is the record of {patient.fullName} ({patient.mrn}), and that the details are right.
            </span>
          </label>
          <FieldError id="death-confirm-error">{fieldErrors.confirmed}</FieldError>
        </div>
        <div className="row">
          <button type="submit" className="btn btn-danger" disabled={busy}>
            {busy ? 'Saving…' : 'Record the death'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Pop-up: undo a death recorded in error (a doctor of the record), with a reason. onDone(message) when undone –
 * the message lists the appointments to book again; nothing that was cancelled comes back by itself.
 */
export function UndoDeathDialog({ patient, onDone, onCancel }) {
  const baby = patient.careType === 'newborn';
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ref = useDialogFocus(busy ? undefined : onCancel);
  const save = async (e) => {
    e.preventDefault();
    const problem = undoReasonProblem(reason) ?? (!baby && mentionsFetalSex(reason) ? PCPNDT_MESSAGE : null);
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      const result = await api(`/patients/${patient.id}/death/undo`, { method: 'POST', body: { reason: reason.trim() } });
      onDone(undoneMessage(result, { formatDate, timeLabel }));
    } catch (err) {
      setError(err.fields?.reason ?? err.message);
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="undo-death-title" onSubmit={save} noValidate>
        <h2 id="undo-death-title">Undo the recorded death?</h2>
        <p className="hint">
          {patient.fullName} · <span className="tabular">{patient.mrn}</span>
        </p>
        <p>
          Only when it was recorded in error. The record will be in use again. Nothing that was cancelled comes back by itself – appointments, messages and portal access. The
          appointments to book again are listed after this. The entry stays in the record's history with your reason.
        </p>
        <Field label="Why was it recorded in error?" id="undo-death-reason" error={error} hint='e.g. "Recorded on the wrong record – the mother and baby were both in the ward"'>
          <textarea id="undo-death-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} disabled={busy} autoFocus />
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Undo – recorded in error'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
