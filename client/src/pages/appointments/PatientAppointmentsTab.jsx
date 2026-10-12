import { useState } from 'react';
import { CalendarClock, CalendarPlus, History, IdCard } from 'lucide-react';
import { Link, useOutletContext } from 'react-router-dom';
import { Alert } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { AppointmentLine, useAppointmentDialogs } from './AppointmentsPage.jsx';
import { PatientCard } from './PatientCard.jsx';
import { CANCEL_LABELS } from './appointmentFormat.js';

// A patient's appointments (her record's Appointments tab): upcoming ones, which reception and doctors can move or
// cancel, and past ones with what happened (seen, did not come, cancelled and why). "Book an appointment" opens the
// Appointments page with her chosen, on her doctor's day.

export function PatientAppointmentsTab() {
  const { patient } = useOutletContext();
  const list = useFetch(`/appointments/patient/${patient.id}`);
  const doctors = useFetch('/appointments/doctors');
  const dialogs = useAppointmentDialogs({ doctors: doctors.data?.doctors ?? [], today: doctors.data?.today, onDone: list.reload });
  const data = list.data;
  const own = patient.assignedDoctor ? String(patient.assignedDoctor) : null;
  const doctorId = own && doctors.data?.doctors.some((d) => d.id === own) ? own : null;
  const [printingCard, setPrintingCard] = useState(false);

  return (
    <div className="appt-page">
      <Alert type="success" onClose={dialogs.clearFlash}>
        {dialogs.flash}
      </Alert>
      {list.error && <Alert type="error">{list.error}</Alert>}
      {data && (
        <section className="card appt-section" aria-labelledby="pa-upcoming">
          <div className="row-between">
            <h2 id="pa-upcoming">
              <CalendarClock aria-hidden="true" /> Upcoming
            </h2>
            <span className="row">
              <button type="button" className="btn btn-link btn-sm" onClick={() => setPrintingCard(true)}>
                <IdCard aria-hidden="true" /> Print patient card
              </button>
              {data.canBook && (
                <Link
                  className="btn btn-secondary btn-sm"
                  to={`/appointments${doctorId ? `?doctor=${doctorId}` : ''}`}
                  state={{ bookFor: { id: patient.id, fullName: patient.fullName, mrn: patient.mrn, phone: patient.phone ?? '' } }}
                >
                  <CalendarPlus aria-hidden="true" /> Book an appointment
                </Link>
              )}
            </span>
          </div>
          {!data.upcoming.length && <p className="muted">No appointment booked.</p>}
          <ul className="appt-lines">
            {data.upcoming.map((a) => (
              <li key={a.id}>
                <AppointmentLine a={a} canBook={data.canBook} onMove={dialogs.move} onCancel={dialogs.cancel} onFee={data.canTakeFee ? dialogs.fee : null} showWhen showDoctor />
              </li>
            ))}
          </ul>
        </section>
      )}
      {data && data.past.length > 0 && (
        <section className="card appt-section" aria-labelledby="pa-past">
          <h2 id="pa-past">
            <History aria-hidden="true" /> Earlier and cancelled
          </h2>
          <ul className="appt-lines">
            {data.past.map((a) => (
              <li key={a.id}>
                <AppointmentLine a={a} canBook={false} showWhen showDoctor />
                {a.cancelled && (
                  <p className="hint appt-cancel-note">
                    Cancelled by {a.cancelled.byName || 'Perinexa'}
                    {a.cancelled.reason ? ` – ${CANCEL_LABELS[a.cancelled.reason] ?? a.cancelled.reason}` : ''}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {dialogs.element}
      {printingCard && <PatientCard patient={patient} onClose={() => setPrintingCard(false)} />}
    </div>
  );
}
