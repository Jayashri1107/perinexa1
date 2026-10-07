// The lab worklist (as in Perinexa's Lab): lab staff take samples and enter results; doctors and RMOs review them;
// nurses can read. Lab staff start on "Results to enter", everyone else on "To review".
import { TriangleAlert, Zap } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { labApi } from '../../api/index.js';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { usePagedList } from '../../hooks/usePagedList.js';
import { formatDateTime } from '../../utils/format.js';
import { LAB_VIEWS, orderLook } from './labFormat.js';

export function LabPage() {
  const { canAccess, hasRole } = useAuth();
  const isLab = canAccess('labReport');
  const isDoctor = hasRole('doctor');
  const navigate = useNavigate();
  const list = usePagedList(labApi.list, { view: isLab ? 'report' : 'review', ...(isDoctor && !isLab && { mine: 'true' }) });

  const filters = useMemo(
    () => [
      { name: 'view', label: 'Show', options: LAB_VIEWS },
      ...(isDoctor ? [{ name: 'mine', label: 'Whose', options: [{ value: 'true', label: 'My patients and orders' }] }] : []),
    ],
    [isDoctor],
  );

  const columns = [
    { key: 'orderNumber', label: 'Order', className: 'nowrap', render: (o) => (<><strong>{o.orderNumber}</strong>{o.urgent && <span className="badge badge-danger small"><Zap size={12} aria-hidden /> Urgent</span>}</>) },
    { key: 'patient', label: 'Patient', render: (o) => (<>{o.patient?.name}<span className="muted block small">{o.patient?.patientNumber}</span></>) },
    { key: 'tests', label: 'Tests', render: (o) => <span className="small">{o.tests.join(', ')}</span> },
    { key: 'status', label: 'Status', render: (o) => (<><StateBadge look={orderLook(o.status)} small />{o.abnormal > 0 && <span className="badge badge-danger small"><TriangleAlert size={12} aria-hidden /> {o.abnormal} outside range</span>}</>) },
    { key: 'ordered', label: 'Ordered', className: 'nowrap', render: (o) => (<>{formatDateTime(o.orderedAt)}<span className="muted block small">{o.orderedBy}</span></>) },
  ];

  return (
    <>
      <PageHeader
        title="Lab"
        subtitle={isLab ? 'Take samples and enter results. Patients are shown by name and number only.' : 'Lab orders and results. Order tests from a patient’s record.'}
      />
      <ListPanel list={list} columns={columns} filters={filters} searchPlaceholder="Order number, patient name or number" emptyText="No lab orders here." onRowClick={(o) => navigate(`/hospital/lab/orders/${o.id}`)} />
    </>
  );
}
