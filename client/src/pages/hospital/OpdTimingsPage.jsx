// OPD timings: every doctor of this hospital with a summary of their week; click to set the timings.
import { useNavigate } from 'react-router-dom';
import { opdTimingsApi } from '../../api/index.js';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { usePagedList } from '../../hooks/usePagedList.js';
import { formatDateTime } from '../../utils/format.js';
import { weekSummary } from '../../utils/weekdays.js';

export function OpdTimingsPage() {
  const list = usePagedList(opdTimingsApi.list);
  const navigate = useNavigate();

  const columns = [
    { key: 'doctor', label: 'Doctor', render: (d) => (<><strong>{d.doctor.name}</strong><span className="muted block">{d.doctor.email}</span></>) },
    {
      key: 'week',
      label: 'Weekly OPD',
      render: (d) => (d.hasTimings && d.daysWithSessions ? weekSummary(d.sessions) : <span className="badge badge-pending">Not set yet</span>),
    },
    { key: 'leave', label: 'Leave ahead', className: 'num', render: (d) => d.upcomingLeave || '—' },
    { key: 'updatedAt', label: 'Last changed', render: (d) => formatDateTime(d.updatedAt) },
    {
      key: 'actions',
      label: '',
      className: 'actions',
      render: (d) => (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/hospital/opd-timings/${d.doctor.id}`)}>
          Set timings
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="OPD timings" subtitle="Each doctor's OPD sessions, visit lengths and leave. Appointment booking uses these." />
      <ListPanel
        list={list}
        columns={columns}
        searchPlaceholder="Search doctors"
        emptyText="No doctors in this hospital yet. Add staff with the Doctor role first."
        onRowClick={(d) => navigate(`/hospital/opd-timings/${d.doctor.id}`)}
      />
    </>
  );
}
