// The audit log, short and plain: when, what happened and by whom, what it was about, (which hospital).
// By default the last 7 days and only the changes: record openings and sign-ins are kept like every entry but hidden
// unless asked for, so the changes stand out. A summary of the period sits on top.
// Click a row for everything recorded, in plain words. Filter by group (Logins, Staff, Patients …).
// Used by the super admin (all hospitals) and the hospital admin (their hospital only – the server decides).
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
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

// The periods to look at: the first moment of each, worked out when chosen.
const PERIODS = [
  { key: 'today', label: 'Today', from: () => new Date(new Date().setHours(0, 0, 0, 0)) },
  { key: 'week', label: 'Last 7 days', from: () => new Date(Date.now() - 7 * 86400000) },
  { key: 'month', label: 'Last 30 days', from: () => new Date(Date.now() - 30 * 86400000) },
  { key: 'all', label: 'All', from: () => null },
];

// "Today 10:42", "Yesterday 16:05", "3 Oct, 09:00"
function whenText(value) {
  const d = new Date(value);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const day = new Date(d).setHours(0, 0, 0, 0);
  const today = new Date().setHours(0, 0, 0, 0);
  if (day === today) return `Today ${time}`;
  if (day === today - 86400000) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}

export function AuditLogView({ fetchPage, fetchSummary, allHospitals = false }) {
  const { auditActions, auditCategories } = useAppConfig();
  const [period, setPeriod] = useState('week');
  const [everything, setEverything] = useState(false);
  const [summary, setSummary] = useState(null);
  const from = useMemo(() => PERIODS.find((p) => p.key === period).from()?.toISOString() ?? '', [period]);
  const fetchList = useCallback((q) => fetchPage({ ...q, from, everything: everything ? 'true' : '' }), [fetchPage, from, everything]);
  const list = usePagedList(fetchList);
  const hospitals = useOptions(allHospitals ? hospitalsApi.options : noOptions);
  const [shown, setShown] = useState(null);
  const groups = useMemo(() => toOptions(auditCategories), [auditCategories]);

  useEffect(() => {
    if (!fetchSummary) return;
    fetchSummary({ from, hospitalId: list.query.hospitalId }).then(setSummary).catch(() => setSummary(null));
  }, [fetchSummary, from, list.query.hospitalId]);

  const columns = [
    { key: 'createdAt', label: 'When', className: 'nowrap', render: (a) => <span title={`${formatDateTime(a.createdAt)} (${timeAgo(a.createdAt)})`}>{whenText(a.createdAt)}</span> },
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

  const periodLabel = PERIODS.find((p) => p.key === period).label.toLowerCase();
  return (
    <>
      <div className="audit-bar">
        <div className="segmented" role="radiogroup" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" role="radio" aria-checked={period === p.key} className={period === p.key ? 'on' : ''} onClick={() => setPeriod(p.key)}>{p.label}</button>
          ))}
        </div>
        <label className="inline-check small">
          <input type="checkbox" checked={everything} onChange={(e) => setEverything(e.target.checked)} /> Include record openings and sign-ins
        </label>
      </div>
      {summary && (
        <div className="audit-summary" aria-label="Summary of the period">
          <span><strong>{summary.changes}</strong> changes</span>
          {summary.byGroup.map((g) => <span key={g.key} className="pill">{g.label}: {g.count}</span>)}
          <span className={summary.failedLogins ? 'audit-warn' : ''}><strong>{summary.failedLogins}</strong> failed sign-ins</span>
          <span className="muted">{summary.routine} record openings and sign-ins {everything ? 'shown' : 'hidden'} · {periodLabel}</span>
        </div>
      )}
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
