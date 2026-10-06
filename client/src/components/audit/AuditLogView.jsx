// The audit log, short: when, what happened (and by whom), about which account, in which hospital.
// Click a row for everything recorded. Filter by group (Logins, Accounts, Patients …) instead of 50 event names.
// Used by the super admin (all hospitals) and the hospital admin (their hospital only – the server decides).
import { Fragment, useMemo, useState } from 'react';
import { hospitalsApi } from '../../api/index.js';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useOptions } from '../../hooks/useOptions.js';
import { usePagedList } from '../../hooks/usePagedList.js';
import { formatDateTime, timeAgo, toOptions } from '../../utils/format.js';
import { ListPanel } from '../list/ListPanel.jsx';
import { Modal } from '../Modal.jsx';

// The recorded details in plain words (never passwords – the server never stores them).
const detailRows = (details) =>
  Object.entries(details ?? {})
    .filter(([, v]) => v !== null && v !== '' && v !== undefined)
    .map(([k, v]) => [k.replace(/([A-Z])/g, ' $1').toLowerCase(), Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)]);

const noOptions = () => Promise.resolve({ items: [] });

export function AuditLogView({ fetchPage, allHospitals = false }) {
  const { auditActions, auditCategories } = useAppConfig();
  const list = usePagedList(fetchPage);
  const hospitals = useOptions(allHospitals ? hospitalsApi.options : noOptions);
  const [shown, setShown] = useState(null);
  const groups = useMemo(() => toOptions(auditCategories), [auditCategories]);

  const columns = [
    { key: 'createdAt', label: 'When', className: 'nowrap', render: (a) => <span title={formatDateTime(a.createdAt)}>{timeAgo(a.createdAt)}</span> },
    {
      key: 'action',
      label: 'What happened',
      render: (a) => (
        <>
          <strong className="block">{auditActions[a.action] ?? a.action}</strong>
          <span className="muted small">by {a.actorEmail ?? 'the system'}</span>
        </>
      ),
    },
    { key: 'target', label: 'Account', render: (a) => (a.targetEmail && a.targetEmail !== a.actorEmail ? a.targetEmail : <span className="muted">—</span>) },
    ...(allHospitals ? [{ key: 'hospital', label: 'Hospital', render: (a) => a.hospital?.name ?? <span className="muted">Platform</span> }] : []),
  ];

  return (
    <>
      <ListPanel
        list={list}
        columns={columns}
        searchPlaceholder="Search by email"
        filters={[
          { name: 'category', label: 'Show', options: groups },
          ...(allHospitals ? [{ name: 'hospitalId', label: 'Hospital', options: hospitals }] : []),
        ]}
        emptyText="Nothing recorded yet."
        onRowClick={setShown}
      />
      {shown && (
        <Modal title={auditActions[shown.action] ?? shown.action} size="sm" onClose={() => setShown(null)}>
          <dl className="details wide">
            <dt>When</dt><dd>{formatDateTime(shown.createdAt)}</dd>
            <dt>By</dt><dd>{shown.actorEmail ?? 'The system'}</dd>
            {shown.targetEmail && (<><dt>Account</dt><dd>{shown.targetEmail}</dd></>)}
            {allHospitals && (<><dt>Hospital</dt><dd>{shown.hospital?.name ?? 'Platform'}</dd></>)}
            {detailRows(shown.details).map(([k, v]) => (
              <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>
            ))}
            <dt>Computer</dt><dd>{shown.ip ?? '—'}</dd>
          </dl>
        </Modal>
      )}
    </>
  );
}
