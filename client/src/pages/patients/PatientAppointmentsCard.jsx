// Her appointments on her record (latest first), with Book for reception and doctors.
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { appointmentsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { labelOf } from '../../utils/format.js';
import { AppointmentActions } from '../appointments/AppointmentActions.jsx';
import { BookDialog } from '../appointments/AppointmentDialogs.jsx';
import { appointmentLook, dayText, whenText } from '../appointments/appointmentFormat.js';
import { useAppointmentDoctors } from '../appointments/DayPage.jsx';

export function PatientAppointmentsCard({ patient }) {
  const { opd } = useAppConfig();
  const { info } = useAppointmentDoctors();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [booking, setBooking] = useState(false);

  const load = useCallback(() => {
    appointmentsApi.forPatient(patient.id).then(setData).catch((err) => setError(err.message));
  }, [patient.id]);
  useEffect(load, [load]);

  const canBook = data?.canBook && patient.status === 'active' && info;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Appointments</h2>
        {canBook && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBooking(true)}><Plus size={14} aria-hidden /> Book</button>
        )}
      </div>
      <Alert type="error">{error}</Alert>
      {data && data.items.length === 0 && <p className="muted">No appointments yet.</p>}
      <ul className="plain-list rows">
        {(data?.items ?? []).slice(0, 10).map((a) => (
          <li key={a.id} className="appt-line">
            <span>
              <strong>{dayText(a.date)}</strong> {whenText(a)}
              <span className="muted block small">{a.doctor.name} · {labelOf(opd.visitTypes, a.visitType)}</span>
            </span>
            <StateBadge look={appointmentLook(a)} small />
            {info && <AppointmentActions appointment={a} today={info.today} canBook={data.canBook} canMarkSeen={info.canMarkSeen} doctors={info.doctors} onChanged={load} onError={setError} showPatientLink={false} />}
          </li>
        ))}
      </ul>
      {booking && info && (
        <BookDialog
          doctors={info.doctors}
          initial={{ patient: { id: patient.id, name: patient.name, patientNumber: patient.patientNumber }, doctorId: patient.assignedDoctorId ?? info.me ?? '', date: info.today }}
          onClose={() => setBooking(false)}
          onDone={() => {
            setBooking(false);
            load();
          }}
        />
      )}
    </section>
  );
}
