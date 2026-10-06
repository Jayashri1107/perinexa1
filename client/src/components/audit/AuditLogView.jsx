// The audit log list, read-only, newest first. Used by the super admin (all hospitals) and the hospital admin
// (their hospital only – the server decides). `fetchPage` must be stable.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { hospitalsApi } from '../../api/index.js';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useOptions } from '../../hooks/useOptions.js';
import { usePagedList } from '../../hooks/usePagedList.js';
import { formatDateTime } from '../../utils/format.js';
import { ListPanel } from '../list/ListPanel.jsx';

// A short, readable version of the details (never passwords – the server never stores them).
function describe(details) {
  return Object.entries(details ?? {})
    .filter(([, v]) => v !== null && v !== '' && v !== undefined)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ');
}

const noOptions = () => Promise.resolve({ items: [] });

export function AuditLogView({ fetchPage, allHospitals = false }) {
  const { auditActions } = useAppConfig();
  const list = usePagedList(fetchPage);
  const hospitals = useOptions(allHospitals ? hospitalsApi.options : noOptions);
  const actionOptions = useMemo(() => Object.entries(auditActions).map(([value, label]) => ({ value, label })), [auditActions]);

  const columns = [
    { key: 'createdAt', label: 'When', className: 'nowrap', render: (a) => formatDateTime(a.createdAt) },
    { key: 'action', label: 'Event', render: (a) => <strong>{auditActions[a.action] ?? a.action}</strong> },
    { key: 'actor', label: 'By', render: (a) => a.actorEmail ?? 'System' },
    { key: 'target', label: 'Account', render: (a) => a.targetEmail ?? '—' },
    ...(allHospitals
      ? [{ key: 'hospital', label: 'Hospital', render: (a) => (a.hospital ? <Link to={`/hospitals/${a.hospital.id}`}>{a.hospital.name}</Link> : '—') }]
      : []),
    { key: 'details', label: 'Details', render: (a) => <span className="muted small">{describe(a.details) || '—'}</span> },
    { key: 'ip', label: 'From', className: 'nowrap', render: (a) => <span className="muted small">{a.ip ?? '—'}</span> },
  ];

  return (
    <ListPanel
      list={list}
      columns={columns}
      searchPlaceholder="Search by email"
      filters={[
        { name: 'action', label: 'Event', options: actionOptions },
        ...(allHospitals ? [{ name: 'hospitalId', label: 'Hospital', options: hospitals }] : []),
      ]}
      emptyText="No entries found."
    />
  );
}
