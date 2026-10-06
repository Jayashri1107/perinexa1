// The audit log, short and plain: when, what happened and by whom, what it was about, (which hospital).
// Click a row for everything recorded, in plain words. Filter by group (Logins, Staff, Patients …).
// Used by the super admin (all hospitals) and the hospital admin (their hospital only – the server decides).
import { Fragment, useMemo, useState } from 'react';
import { hospitalsApi } from '../../api/index.js';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useOptions } from '../../hooks/useOptions.js';
import { usePagedList } from '../../hooks/usePagedList.js';
import { formatDateTime, timeAgo, toOptions } from '../../utils/format.js';
import { ListPanel } from '../list/ListPanel.jsx';
import { Modal } from '../Modal.jsx';

// The names of recorded details, in words. Ids are left out (the "About" line already names the record).
const DETAIL_WORDS = {
  changed: 'What changed',
  section: 'Settings page',
  from: 'Before',
  to: 'After',
  roles: 'Roles',
  name: 'Name',
  code: 'Code',
  email: 'Email',
  reason: 'Reason',
  total: 'Total',
  amount: 'Amount',
  mode: 'Paid by',
  receiptNumber: 'Receipt',
  billNumber: 'Bill',
  invoiceNumber: 'Invoice',
  supplier: 'Supplier',
  lines: 'Lines',
  days: 'OPD days',
  leavePeriods: 'Leave periods',
  medicine: 'Medicine',
  batch: 'Batch',
  change: 'Units',
  price: 'Price',
  isActive: 'Active',
  isSuperAdmin: 'Super admin',
  emergency: 'Emergency access',
  asSuperAdmin: 'By the super admin',
  hours: 'Hours',
  similar: 'Similar records',
  part: 'Part of the record',
  patientNumber: 'Patient',
};
const HIDDEN = new Set(['patientId']);
const show = (v) => (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));
const noOptions = () => Promise.resolve({ items: [] });
const whoDid = (a) => a.actorName ?? a.actorEmail ?? 'the system';
// What it was about – nothing when it was about the person who did it (e.g. their own login).
const aboutOf = (a) => {
  const self = a.targetEmail && a.targetEmail === a.actorEmail;
  if (self && (!a.about || a.about === a.targetName)) return null;
  return a.about ?? (a.targetEmail && !self ? a.targetEmail : null);
};
// The details, without what the "About" line already says.
const detailRows = (a) =>
  Object.entries(a.details ?? {})
    .filter(([k, v]) => !HIDDEN.has(k) && v !== null && v !== '' && v !== undefined && !(aboutOf(a) ?? '').includes(String(v)))
    .map(([k, v]) => [DETAIL_WORDS[k] ?? k.replace(/([A-Z])/g, ' $1').toLowerCase(), show(v)]);

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
          <span className="muted small">by {whoDid(a)}</span>
        </>
      ),
    },
    { key: 'about', label: 'About', render: (a) => aboutOf(a) ?? <span className="muted">—</span> },
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
            <dt>Done by</dt><dd>{whoDid(shown)}{shown.actorEmail && shown.actorName ? <span className="muted block small">{shown.actorEmail}</span> : null}</dd>
            {aboutOf(shown) && (<><dt>About</dt><dd>{aboutOf(shown)}{shown.targetEmail && shown.targetName ? <span className="muted block small">{shown.targetEmail}</span> : null}</dd></>)}
            {allHospitals && (<><dt>Hospital</dt><dd>{shown.hospital?.name ?? 'Platform'}</dd></>)}
            {detailRows(shown).map(([k, v]) => (
              <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>
            ))}
            <dt>Computer</dt><dd>{shown.ip ?? '—'}</dd>
          </dl>
        </Modal>
      )}
    </>
  );
}
