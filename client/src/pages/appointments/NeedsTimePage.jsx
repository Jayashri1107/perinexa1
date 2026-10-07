// Bookings that still need a time (booked with no time, e.g. the doctor's day was full or the patient will confirm):
// reception gives each a free time, or cancels it.
import { useCallback, useEffect, useState } from 'react';
import { appointmentsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { DataTable } from '../../components/list/DataTable.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { labelOf } from '../../utils/format.js';
import { AppointmentActions } from './AppointmentActions.jsx';
import { AppointmentsFrame } from './AppointmentsFrame.jsx';
import { dayText, phoneOf, whoText } from './appointmentFormat.js';
import { useAppointmentDoctors } from './DayPage.jsx';

export function NeedsTimePage() {
  const { opd } = useAppConfig();
  const { info } = useAppointmentDoctors();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    appointmentsApi.needsTime().then(setData).catch((err) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  const columns = [
    { key: 'date', label: 'Day', className: 'nowrap', render: (a) => dayText(a.date) },
    { key: 'who', label: 'Patient', render: (a) => (<><strong>{whoText(a)}</strong><span className="muted block small">{[a.patient?.patientNumber, phoneOf(a)].filter(Boolean).join(' · ')}</span></>) },
    { key: 'doctor', label: 'Doctor', render: (a) => a.doctor.name },
    { key: 'visit', label: 'Visit', render: (a) => labelOf(opd.visitTypes, a.visitType) },
    {
      key: 'actions',
      label: '',
      render: (a) =>
        info && (
          <AppointmentActions appointment={a} today={info.today} canBook={data.canBook} canMarkSeen={false} doctors={info.doctors} onChanged={load} onError={setError} />
        ),
    },
  ];

  return (
    <AppointmentsFrame subtitle="Bookings with no time yet. Give each a free time, or cancel it.">
      <Alert type="error">{error}</Alert>
      <section className="card list-panel">
        <DataTable columns={columns} rows={data?.items ?? []} loading={!data && !error} emptyText="Every booking has a time." />
      </section>
    </AppointmentsFrame>
  );
}
