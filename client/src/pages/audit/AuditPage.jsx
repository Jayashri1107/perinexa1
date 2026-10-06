// The audit log: every login, account, hospital and master-data change, newest first. Read-only.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { auditApi, hospitalsApi } from '../../api/index.js';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useOptions } from '../../hooks/useOptions.js';
import { usePagedList } from '../../hooks/usePagedList.js';
import { formatDateTime } from '../../utils/format.js';

// A short, readable version of the details (never passwords – the server never stores them).
function describe(details) {
  return Object.entries(details ?? {})
    .filter(([, v]) => v !== null && v !== '' && v !== undefined)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ');
}

export function AuditPage() {
  const { auditActions } = useAppConfig();
  const list = usePagedList(auditApi.list);
  const hospitals = useOptions(hospitalsApi.options);
  const actionOptions = useMemo(() => Object.entries(auditActions).map(([value, label]) => ({ value, label })), [auditActions]);

  const columns = [
    { key: 'createdAt', label: 'When', className: 'nowrap', render: (a) => formatDateTime(a.createdAt) },
    { key: 'action', label: 'Event', render: (a) => <strong>{auditActions[a.action] ?? a.action}</strong> },
    { key: 'actor', label: 'By', render: (a) => a.actorEmail ?? 'System' },
    { key: 'target', label: 'Account', render: (a) => a.targetEmail ?? '—' },
    { key: 'hospital', label: 'Hospital', render: (a) => (a.hospital ? <Link to={`/hospitals/${a.hospital.id}`}>{a.hospital.name}</Link> : '—') },
    { key: 'details', label: 'Details', render: (a) => <span className="muted small">{describe(a.details) || '—'}</span> },
    { key: 'ip', label: 'From', className: 'nowrap', render: (a) => <span className="muted small">{a.ip ?? '—'}</span> },
  ];

  return (
    <>
      <PageHeader title="Audit log" subtitle="Who did what, and when. Entries cannot be changed or deleted." />
      <ListPanel
        list={list}
        columns={columns}
        searchPlaceholder="Search by email"
        filters={[
          { name: 'action', label: 'Event', options: actionOptions },
          { name: 'hospitalId', label: 'Hospital', options: hospitals },
        ]}
        emptyText="No entries found."
      />
    </>
  );
}
