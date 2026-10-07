// Appointments → OPD timings: the doctors who take appointments. A doctor opens their own timings to change them
// (the hospital admin can change anyone's under Hospital admin); everyone else can look.
import { CircleCheck, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { appointmentsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { DataTable } from '../../components/list/DataTable.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { OpdScheduleEditorPage } from '../hospital/OpdScheduleEditorPage.jsx';
import { AppointmentsFrame } from './AppointmentsFrame.jsx';
import { useAppointmentDoctors } from './DayPage.jsx';

const HAS = { tone: 'active', icon: CircleCheck, word: 'Timings set' };
const NONE = { tone: 'pending', icon: Clock, word: 'No timings yet' };

export function TimingsPage() {
  const { info, error } = useAppointmentDoctors();
  const navigate = useNavigate();
  const columns = [
    { key: 'name', label: 'Doctor', render: (d) => <strong>{d.name}{d.id === info.me ? ' (me)' : ''}</strong> },
    { key: 'timings', label: 'Timings', render: (d) => <StateBadge look={d.hasTimings ? HAS : NONE} small /> },
    { key: 'edit', label: '', render: (d) => <span className="btn btn-link btn-sm">{d.canEditTimings ? 'Change' : 'Look'}</span> },
  ];
  return (
    <AppointmentsFrame subtitle="Each doctor’s weekly OPD sessions, visit lengths and leave. Bookings follow them.">
      <Alert type="error">{error}</Alert>
      <section className="card list-panel">
        <DataTable columns={columns} rows={info?.doctors ?? []} loading={!info && !error} emptyText="No doctor works in this hospital yet." onRowClick={(d) => navigate(`/hospital/appointments/timings/${d.id}`)} />
      </section>
    </AppointmentsFrame>
  );
}

// One doctor's timings, from the Appointments module (own timings: editable).
const DOCTOR_API = { get: (id) => appointmentsApi.timings(id), save: (id, data) => appointmentsApi.saveTimings(id, data) };

export function DoctorTimingsPage() {
  return <OpdScheduleEditorPage api={DOCTOR_API} backTo="/hospital/appointments/timings" backLabel="OPD timings" />;
}
