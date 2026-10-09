// The lab worklist (as in Perinexa's Lab), one tab per step (owner, 9 Oct 2026): Requests, Sample tracking, In progress,
// Awaiting verification, Finalized, Cancelled. Lab staff start on Requests, everyone else on Awaiting verification.
import { MessageCircleQuestion, TriangleAlert, Zap } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { labApi } from '../../api/index.js';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { usePagedList } from '../../hooks/usePagedList.js';
import { formatDateTime } from '../../utils/format.js';
import { LAB_VIEWS, stageLook } from './labFormat.js';

export function LabPage() {
  const { canAccess, hasRole } = useAuth();
  const isLab = canAccess('labReport');
  const isDoctor = hasRole('doctor');
  const navigate = useNavigate();
  // a tab can be opened from Today (?view=)
  const [params] = useSearchParams();
  const startView = LAB_VIEWS.some((v) => v.value === params.get('view')) ? params.get('view') : isLab ? 'collect' : 'review';
  const list = usePagedList(labApi.list, { view: startView, ...(isDoctor && !isLab && { mine: 'true' }) });

  const filters = useMemo(
    () => [
      ...(isDoctor ? [{ name: 'mine', label: 'Whose', options: [{ value: 'true', label: 'My patients and orders' }] }] : []),
    ],
    [isDoctor],
  );

  const columns = [
    { key: 'orderNumber', label: 'Order', className: 'nowrap', render: (o) => (<><strong>{o.orderNumber}</strong>{o.urgent && <span className="badge badge-danger small"><Zap size={12} aria-hidden /> Urgent</span>}{o.bookedByReception && <span className="badge badge-info small">Booked by reception</span>}</>) },
    { key: 'patient', label: 'Patient', render: (o) => (<>{o.patient?.name}<span className="muted block small">{o.patient?.patientNumber}</span></>) },
    { key: 'tests', label: 'Tests', render: (o) => <span className="small">{o.tests.join(', ')}</span> },
    { key: 'status', label: 'Status', render: (o) => (<><StateBadge look={stageLook(o)} small />{o.sampleNumber && <span className="muted small block">Sample {o.sampleNumber}</span>}{o.queries > 0 && <span className="badge badge-pending small"><MessageCircleQuestion size={12} aria-hidden /> Asked the doctor</span>}{o.abnormal > 0 && <span className="badge badge-danger small"><TriangleAlert size={12} aria-hidden /> {o.abnormal} outside range</span>}</>) },
    { key: 'ordered', label: 'Ordered', className: 'nowrap', render: (o) => (<>{formatDateTime(o.orderedAt)}<span className="muted block small">{o.orderedBy}</span></>) },
  ];

  return (
    <>
      <PageHeader
        title="Lab"
        subtitle={isLab ? 'Take samples and enter results. Patients are shown by name and number only.' : 'Lab orders and results. Order tests from a patient’s record.'}
      />
      <div className="care-tabs lab-tabs" role="tablist" aria-label="Lab work">
        {LAB_VIEWS.map(({ value, label, icon: Icon }) => (
          <button key={value} type="button" role="tab" aria-selected={list.query.view === value} className={list.query.view === value ? 'on' : ''} onClick={() => list.setFilter('view', value)}>
            <Icon size={15} aria-hidden /> {label}
          </button>
        ))}
      </div>
      <ListPanel list={list} columns={columns} filters={filters} searchPlaceholder="Order number, patient name or number" emptyText="No lab orders here." onRowClick={(o) => navigate(`/hospital/lab/orders/${o.id}`)} />
    </>
  );
}
