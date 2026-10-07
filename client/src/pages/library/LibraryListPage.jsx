// A tab of the clinic library: the entries of one kind, or – on "To approve" – every draft waiting for a doctor.
// A kind the hospital has only one of (red-flag rules, medicine safety, risk rules) opens that entry straight away.
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { libraryApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { Loader } from '../../components/Loader.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { usePagedList } from '../../hooks/usePagedList.js';
import { formatDate } from '../../utils/format.js';
import { LibraryEntryPage } from './LibraryEntryPage.jsx';
import { LibraryFrame, useLibrarySummary } from './LibraryFrame.jsx';
import { INACTIVE_LOOK, careTypesText, entryLook } from './libraryFormat.js';

const SUBTITLES = {
  '': 'Everything a doctor still has to check and approve. Nothing here is used for a patient until it is approved.',
  care_plan: 'Care-plan templates for each type of care: visits, tests, scans, vaccines, medicines and advice by week.',
  consent_form: 'Consent forms printed for patients, in English, Marathi and Hindi.',
  information_form: 'Sheets that explain a condition to the patient and her relatives, who sign that they were informed.',
  test_package: 'Ready-made sets of lab tests, ticked together on the lab order.',
  prescription_set: 'Ready-made prescriptions for common situations – a starting point the doctor changes.',
};

function NewButton({ kind }) {
  const summary = useLibrarySummary();
  const navigate = useNavigate();
  const k = summary?.kinds.find((x) => x.key === kind);
  if (!k?.own || !summary.can.edit) return null;
  return (
    <button type="button" className="btn btn-primary" onClick={() => navigate(`/hospital/library/${kind}/new`)}>
      <Plus size={16} aria-hidden /> New {k.singular.toLowerCase()}
    </button>
  );
}

// A kind with one entry per hospital: that entry, shown in place.
function SingleEntry({ kind }) {
  const [id, setId] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    libraryApi
      .list({ kind, limit: 10 })
      .then((r) => (r.items[0] ? setId(r.items[0].id) : setError('This list is missing. Reload the page.')))
      .catch((err) => setError(err.message));
  }, [kind]);
  if (error) return <LibraryFrame><Alert type="error">{error}</Alert></LibraryFrame>;
  if (!id) return <LibraryFrame><Loader /></LibraryFrame>;
  return <LibraryEntryPage key={id} id={id} />;
}

function EntryList({ kind }) {
  const { patients } = useAppConfig();
  const navigate = useNavigate();
  const fetchPage = useCallback((q) => libraryApi.list({ ...q, kind, ...(!kind && { status: 'draft', active: 'true' }) }), [kind]);
  const list = usePagedList(fetchPage, kind ? { active: 'true' } : {});
  const summary = useLibrarySummary();
  const kindLabel = useMemo(() => new Map((summary?.kinds ?? []).map((k) => [k.key, k.singular])), [summary]);

  const filters = kind
    ? [
        { name: 'status', label: 'Status', options: [{ value: 'draft', label: 'Draft' }, { value: 'approved', label: 'Approved' }] },
        { name: 'active', label: 'In use', options: [{ value: 'true', label: 'In use' }, { value: 'false', label: 'Not in use' }] },
      ]
    : [];
  const columns = [
    {
      key: 'name',
      label: 'Name',
      render: (e) => (
        <>
          <strong>{e.name}</strong> {e.origin === 'hospital' && <span className="pill">Own</span>}
          {!kind && <span className="muted block small">{kindLabel.get(e.kind) ?? e.kind}</span>}
        </>
      ),
    },
    { key: 'care', label: 'For', render: (e) => <span className="small">{careTypesText(e.careTypes, patients.careTypes)}</span> },
    { key: 'size', label: 'Size', className: 'nowrap', render: (e) => `${e.size} ${e.sizeWord}` },
    {
      key: 'status',
      label: 'Status',
      render: (e) => (
        <>
          <StateBadge look={entryLook(e)} small /> {!e.isActive && <StateBadge look={INACTIVE_LOOK} small />}
          {e.approved && e.status === 'approved' && <span className="muted block small">{e.approved.by}, {formatDate(e.approved.at)}</span>}
        </>
      ),
    },
  ];

  return (
    <LibraryFrame subtitle={SUBTITLES[kind ?? '']} actions={kind && <NewButton kind={kind} />}>
      {!kind && <Alert type="info">The built-in entries are DRAFTS copied from Perinexa, prepared from published guidance – not reviewed by a doctor. Check each one before approving it.</Alert>}
      <ListPanel
        list={list}
        columns={columns}
        filters={filters}
        searchPlaceholder="Name"
        emptyText={kind ? 'Nothing here yet.' : 'Nothing waits for approval.'}
        onRowClick={(e) => navigate(`/hospital/library/${e.kind}/${e.id}`)}
      />
    </LibraryFrame>
  );
}

const SINGLE = ['red_flag_rules', 'medicine_safety', 'risk_rules'];

export function LibraryListPage() {
  const { kind } = useParams();
  if (SINGLE.includes(kind)) return <SingleEntry key={kind} kind={kind} />;
  return <EntryList key={kind ?? 'approvals'} kind={kind} />;
}
