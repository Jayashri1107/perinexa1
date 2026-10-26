import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, Field, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PatientFinder } from '../appointments/AppointmentDialogs.jsx';
import { PURPOSE_LABELS, PURPOSE_NOTE_MAX, VISIT_PURPOSES } from '../appointments/appointmentFormat.js';

// Follow-ups added by hand (26 Oct 2026): "she will come back to Dr A to show her reports" – with which doctor, what
// for (a fixed list) and from which day (POST /api/added-follow-ups). The same choice of purpose is asked when she
// checks in (ArrivalDialog), and her doctor is told. Never a medical detail: reception sees it.

/** What the visit is for: one of the fixed purposes, as buttons, and a short note under them. */
export function PurposeChoice({ value, onChange, note, onNote, idPrefix = 'purpose', legend = 'What for' }) {
  return (
    <fieldset className="fu-purpose">
      <legend>{legend}</legend>
      <div className="fu-purpose-options" role="radiogroup" aria-label={legend}>
        {VISIT_PURPOSES.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} className="fu-purpose-option" onClick={() => onChange(k)}>
            {PURPOSE_LABELS[k]}
          </button>
        ))}
      </div>
      <Field label="Note (optional)" id={`${idPrefix}-note`} hint="A few words, for example “bring the blood report”. No medical details – reception sees this.">
        <input id={`${idPrefix}-note`} value={note} maxLength={PURPOSE_NOTE_MAX} onChange={(e) => onNote(e.target.value)} />
      </Field>
    </fieldset>
  );
}

/** Add a follow-up: the patient (given, or found here), her doctor, what for, from which day and a short note. */
export function AddFollowUpDialog({ patient: given = null, today = '', onClose, onAdded }) {
  const ref = useDialogFocus(onClose);
  const [found, setFound] = useState(null);
  const patient = given ?? found;
  const doctors = useFetch('/appointments/doctors');
  const list = doctors.data?.doctors ?? [];
  const own = list.find((d) => d.name === (patient?.doctorName ?? patient?.assignedDoctorName));
  const [doctorId, setDoctorId] = useState('');
  const [purpose, setPurpose] = useState('consultation');
  const [note, setNote] = useState('');
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const chosenDoctor = doctorId || own?.id || list[0]?.id || '';
  // The day is required (owner, 26 Oct 2026): today unless another is chosen
  const day = from || today;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { followUp } = await api('/added-follow-ups', { method: 'POST', body: { patientId: patient.id, doctorId: chosenDoctor, purpose, note: note.trim(), from: day } });
      onAdded(followUp);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="fu-add-title">
        <h2 id="fu-add-title">{patient ? `Add a follow-up – ${patient.fullName}` : 'Add a follow-up'}</h2>
        <Alert type="error">{error || doctors.error}</Alert>
        {!patient ? (
          <PatientFinder onPick={setFound} />
        ) : (
          <>
            <div className="form-grid">
              <Field label="Doctor" id="fu-add-doctor">
                <select id="fu-add-doctor" value={chosenDoctor} onChange={(e) => setDoctorId(e.target.value)} disabled={!list.length}>
                  {list.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.id === own?.id ? ' (her doctor)' : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="From" id="fu-add-from" hint="The day she is asked to come from – today unless you choose another day.">
                <input id="fu-add-from" type="date" required min={today || undefined} value={day} onChange={(e) => setFrom(e.target.value)} />
              </Field>
            </div>
            <PurposeChoice idPrefix="fu-add" value={purpose} onChange={setPurpose} note={note} onNote={setNote} />
          </>
        )}
        <div className="row">
          {patient && (
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !chosenDoctor || !day}>
              <CalendarPlus aria-hidden="true" /> {busy ? 'Saving…' : 'Add follow-up'}
            </button>
          )}
          <button type="button" className="btn btn-link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
