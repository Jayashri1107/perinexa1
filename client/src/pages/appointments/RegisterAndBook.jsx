import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, TriangleAlert } from 'lucide-react';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Alert, Field, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { newPatientLinks } from '../../platform/modules.js';
import { PatientForm } from '../patients/PatientForm.jsx';
import { PossibleMatchesDialog } from '../patients/PossibleMatchesDialog.jsx';
import { VISIT_TYPES, VISIT_TYPE_LABELS } from './appointmentFormat.js';

// "New patient" in the Book dialog (26 Oct 2026, as Docterz's reception: the first visit is one form): her full
// registration form opens inside the dialog – the type of care, then the same form as Patients → New patient, page 1
// (name, age, phone, address, doctor … and Fill from Aadhaar). Saving registers her and books the chosen time for her
// record, with no page change. "She may already be registered" opens on top: the time is then booked for the record
// chosen, or she is registered anyway. The clinical details (page 2) are added later from her record.
// A slot that was taken in the meantime asks "Book anyway", as every booking does; she stays registered.
// With `appointment` (a booking by name and phone, "Not registered yet"): the same form, filled in with that name and
// phone, and the booking joins her record instead of a new time being booked.
// EditPatientDialog (below): after booking, her details are changed in a dialog too (Appointments → Edit details).

/** registered: her record once saved; booking errors after that keep it, so the time is booked for her, not again. */
// registerOnly (reception's search box on Today): no doctor or time – she is registered, then onBooked(null, patient).
// prefill: details already typed there (her phone or name).
export function RegisterAndBook({ doctor = null, date, start, lengths = null, appointment = null, registerOnly = false, prefill = null, onBooked, onCancel }) {
  const { activeMembership } = useAuth();
  const roles = activeMembership?.roles ?? [];
  const clinical = roles.includes('doctor') || roles.includes('rmo');
  const links = newPatientLinks(roles);
  const [careType, setCareType] = useState('');
  const [visitType, setVisitType] = useState(appointment?.visitType ?? 'new');
  const [registered, setRegistered] = useState(null);
  const [matches, setMatches] = useState(null); // { list, total, payload }
  const [choosing, setChoosing] = useState(null);
  const [matchError, setMatchError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // The time, for this patient record; a confirmable warning waits for "Book anyway".
  const book = async (patient, confirm = false) => {
    if (registerOnly) {
      onBooked(null, patient);
      return;
    }
    setRegistered(patient);
    setBusy(true);
    setError(null);
    try {
      const res = appointment
        ? await api(`/appointments/${appointment.id}/link`, { method: 'POST', body: { patientId: patient.id } })
        : await api('/appointments', { method: 'POST', body: { doctorId: doctor.id, date, start, visitType, confirm, patientId: patient.id } });
      setWarning(null);
      onBooked(res.appointment, patient);
    } catch (err) {
      if (err.status === 409 && ['SLOT_TAKEN', 'ALREADY_BOOKED'].includes(err.code)) setWarning(err.message);
      else setError(`${patient.fullName} is registered as ${patient.mrn}, but ${appointment ? 'her booking could not be added to her record' : 'the time was not booked'}: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  // The form's Save: register (records with the same phone or name open "She may already be registered"), then book.
  const save = async (payload) => {
    let patient;
    try {
      ({ patient } = await api('/patients', { method: 'POST', body: payload }));
    } catch (err) {
      if (err.code !== 'POSSIBLE_MATCHES') throw err; // the form shows every other problem under its boxes
      setMatchError(null);
      setMatches({ list: err.matches ?? [], total: err.total ?? 0, payload });
      return;
    }
    await book(patient);
  };

  const registerAnyway = async () => {
    setChoosing('register');
    setMatchError(null);
    try {
      const { patient } = await api('/patients', { method: 'POST', body: { ...matches.payload, registerAnyway: true } });
      setMatches(null);
      await book(patient);
    } catch (err) {
      setMatchError(err.fields && Object.keys(err.fields).length ? `${err.message} Go back to the form to correct them.` : err.message);
    } finally {
      setChoosing(null);
    }
  };

  const openExisting = async (match) => {
    setChoosing(match.id);
    setMatches(null);
    await book({ id: match.id, fullName: match.fullName, mrn: match.mrn });
    setChoosing(null);
  };

  // Registered (or an existing record chosen), the time not booked yet: only the booking is left to do
  if (registered) {
    return (
      <div className="appt-register-done">
        <Alert type="error">{error}</Alert>
        <p>
          <strong>{registered.fullName}</strong> <span className="muted">{registered.mrn}</span>
        </p>
        {warning && (
          <div className="appt-warning" role="alert">
            <p>
              <TriangleAlert aria-hidden="true" /> {warning}
            </p>
          </div>
        )}
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => book(registered, Boolean(warning))}>
            <CalendarCheck aria-hidden="true" /> {busy ? 'Saving…' : warning ? 'Book anyway' : appointment ? 'Add her booking to her record' : 'Book this time'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel} disabled={busy}>
            Close – book her later
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="appt-register">
      <div className="form-grid">
        <Field label="Type of care" id="appt-reg-care" hint="The form shows only what this type of care needs.">
          <select id="appt-reg-care" value={careType} onChange={(e) => setCareType(e.target.value)} autoFocus>
            <option value="">Choose…</option>
            {links.map((l) => (
              <option key={l.type} value={l.type}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
        {!appointment && !registerOnly && (
          <Field
            label="Visit type"
            id="appt-reg-type"
            hint={lengths?.[visitType] > 10 ? `Takes ${lengths[visitType]} minutes with ${doctor.name}: the times that follow are kept free too.` : 'No medical details here – reception sees this.'}
            keepHint={lengths?.[visitType] > 10}
          >
            <select id="appt-reg-type" value={visitType} onChange={(e) => setVisitType(e.target.value)}>
              {VISIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {VISIT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {!careType && <p className="hint">Choose the type of care to open her registration form.</p>}
      {careType && (
        <PatientForm
          key={careType}
          careType={careType}
          part="info"
          prefill={{ ...(doctor ? { assignedDoctor: doctor.id } : {}), ...(appointment?.guest ? { fullName: appointment.guest.name, phone: appointment.guest.phone } : {}), ...(prefill ?? {}) }}
          onSubmit={save}
          submitLabel={appointment || registerOnly ? 'Register' : 'Register and book'}
          access={{ canEditIdentity: true, canEditNewborn: true, canEditClinical: clinical }}
          clinicalStep={() => false}
        />
      )}
      <div className="row">
        <button type="button" className="btn btn-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {matches && (
        <PossibleMatchesDialog
          careType={careType}
          matches={matches.list}
          total={matches.total}
          busy={choosing}
          error={matchError}
          openNote={registerOnly ? null : appointment ? 'Her booking is added to the record you open.' : 'The time is booked for the record you open.'}
          onOpen={openExisting}
          onRegisterAnyway={registerAnyway}
          onBack={() => setMatches(null)}
        />
      )}
    </div>
  );
}

/**
 * Her details, changed in a dialog (Appointments → Edit details, 26 Oct 2026): the registration part of the same form
 * as her record's Edit details tab, saved with PATCH /api/patients/:id – the server decides what this person may
 * change (reception: her identity and contact details, never clinical ones). Opening it reads her record (audited as
 * every view of a record).
 */
export function EditPatientDialog({ patientId, onClose, onSaved }) {
  const ref = useDialogFocus(onClose);
  const res = useFetch(`/patients/${patientId}`);
  const patient = res.data?.patient;
  const save = async (payload) => {
    await api(`/patients/${patientId}`, { method: 'PATCH', body: payload });
    onSaved(patient);
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="modal modal-wide modal-register" role="dialog" aria-modal="true" aria-labelledby="appt-edit-title">
        <h2 id="appt-edit-title">{patient ? `Edit info – ${patient.fullName}` : 'Edit info'}</h2>
        <Alert type="error">{res.error}</Alert>
        {!patient && !res.error && (
          <p className="muted" aria-busy="true">
            Opening her details…
          </p>
        )}
        {patient && !patient.access.canEditIdentity && <Alert type="info">You can't change this patient's details.</Alert>}
        {patient?.access.canEditIdentity && (
          <>
            <p className="muted">
              {patient.mrn} · <Link to={`/patients/${patient.id}`}>Open her record</Link>
            </p>
            <PatientForm patient={patient} part="info" onSubmit={save} submitLabel="Save changes" access={patient.access} />
          </>
        )}
        <div className="row">
          <button type="button" className="btn btn-link" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
