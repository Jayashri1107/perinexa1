import { Archive, BedDouble, CalendarPlus, Copy, Lock, Phone, Siren, SlidersHorizontal, TriangleAlert, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { ClearFilters, DataTable, FilterSelect, SearchInput, TablePagination } from '../../components/DataTable.jsx';
import { MenuButton } from '../../components/MenuButton.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Avatar, StatusPill, formatDate, formatDateTime, hasRole } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { useListParams } from '../../hooks/useListParams.js';
import { canRegisterPatients, newPatientLinks } from '../../platform/modules.js';
import { ageText, careNowText, sinceText } from './patientFormat.js';
import { RiskBadge } from './RiskCard.jsx';
import { RISK_SHORT } from './riskFormat.js';
import { SignupsNotice } from './SignupsPage.jsx';
import { AdmissionSlip, AdmitDialog } from '../beds/BedBoardPage.jsx';
import { ExportButton } from '../../components/ExportButton.jsx';

// What was typed in the search box is kept here – not in the page address, where it would stay in the browser's
// history – so going back to the list keeps it. Only for the same person and hospital; gone after a reload.
let lastSearch = { key: null, text: '' };

export function PatientsPage() {
  const { user, activeMembership } = useAuth();
  const navigate = useNavigate();
  const roles = activeMembership.roles;
  // Doctors (who aren't RMOs) start with "My patients"; everyone else starts with all patients.
  const isDoctor = hasRole(activeMembership, 'doctor');
  const defaultDoctor = isDoctor && !hasRole(activeMembership, 'rmo') ? 'me' : 'all';
  // Clinical staff: the most recently seen first; reception: the most recently registered first
  const clinicalList = hasRole(activeMembership, 'doctor', 'rmo', 'nurse');
  // Everyone starts with today's patients – registered, booked or seen today (owner, 27 Oct 2026, like Docterz);
  // All patients is one click away. A search always looks through all patients.
  const [params, setParams, resetParams] = useListParams({ day: 'today', careType: '', doctor: defaultDoctor, risk: '', duplicates: '', registeredFrom: '', registeredTo: '', sort: clinicalList ? '-lastVisitOn' : '-createdAt', page: 1, limit: 25 });
  // Records marked as a duplicate of another are left out of the list; doctors and RMOs may show them
  const seesDuplicates = hasRole(activeMembership, 'doctor', 'rmo');
  const duplicates = seesDuplicates && ['include', 'only'].includes(params.duplicates) ? params.duplicates : '';
  // Under "More filters": a particular doctor, a risk other than "high" (the quick choices cover the rest), duplicates
  const moreFilters = [!['me', 'all'].includes(params.doctor) && params.doctor !== defaultDoctor, params.risk && params.risk !== 'high', duplicates, params.registeredFrom || params.registeredTo].filter(Boolean).length;
  const [showFilters, setShowFilters] = useState(false);
  const searchKey = `${user.id}:${activeMembership.tenantId}`;
  const [search, setSearchText] = useState(() => (lastSearch.key === searchKey ? lastSearch.text : ''));
  const setSearch = (text) => {
    lastSearch = { key: searchKey, text };
    setSearchText(text);
    setParams({}); // back to page 1
  };
  const reset = () => {
    setSearch('');
    resetParams();
  };
  // An address saved before this change may still hold ?search=: it is removed, never used.
  const [addressParams, setAddressParams] = useSearchParams();
  useEffect(() => {
    if (!addressParams.has('search')) return;
    const next = new URLSearchParams(addressParams);
    next.delete('search');
    setAddressParams(next, { replace: true });
  }, [addressParams, setAddressParams]);
  const seesRisk = hasRole(activeMembership, 'doctor', 'rmo', 'nurse');
  const isReception = hasRole(activeMembership, 'receptionist');
  const [admitting, setAdmitting] = useState(null); // the patient being admitted from her row
  const [admittedSlip, setAdmittedSlip] = useState(null);
  const [notice, setNotice] = useState(null);
  const todayOnly = params.day === 'today' && !search && !params.registeredFrom && !params.registeredTo;
  const { data, error, loading } = useFetch('/patients', { ...params, day: todayOnly ? 'today' : '', duplicates, search });
  const doctors = useFetch('/tenant/doctors');
  const canRegister = canRegisterPatients(roles);

  // Few columns, in plain words: who she is, what care she is under now, anything to watch, when last seen
  const columns = [
    {
      key: 'fullName',
      header: 'Patient',
      sortKey: 'fullName',
      render: (p) => (
        <span className="name-cell">
          <Avatar name={p.fullName} seed={p.id} />
          <span className="name-cell-text">
            <strong className="patient-name pt-name">
              <Link to={`/patients/${p.id}`}>{p.fullName}</Link>
              {p.sensitive && (
                <StatusPill tone="brand" icon={Lock} title="Sensitive record">
                  Sensitive
                </StatusPill>
              )}
              {p.duplicateOf && (
                <StatusPill tone="inactive" icon={Copy} title={`This record is marked as a duplicate of ${p.duplicateOf.mrn}`}>
                  Duplicate of {p.duplicateOf.mrn}
                </StatusPill>
              )}
              {/* A record closed after a death stays in the list and every search – only THAT it is closed, never why */}
              {p.closed && (
                <StatusPill tone="inactive" icon={Archive}>
                  Record closed
                </StatusPill>
              )}
            </strong>
            <span className="cell-sub">{[p.careType === 'newborn' ? null : ageText(p), p.mrn, p.phone].filter(Boolean).join(' · ')}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'now',
      header: 'Care now',
      sortKey: 'pregnancy.effectiveEdd',
      render: (p) => (
        <>
          <span className="pt-now">{careNowText(p)}</span>
          {p.careType === 'antenatal' && p.pregnancy?.effectiveEdd && <div className="cell-sub">Due {formatDate(p.pregnancy.effectiveEdd)}</div>}
        </>
      ),
    },
    ...(seesRisk
      ? [
          {
            key: 'alerts',
            header: 'Needs attention',
            className: 'risk-cell',
            render: (p) => {
              const risky = ['high', 'moderate', 'incomplete'].includes(p.risk?.level);
              return risky || p.redFlags ? (
                <span className="pt-risk">
                  {risky && <RiskBadge level={p.risk.level} />}
                  {p.redFlags && (
                    <StatusPill tone="high" icon={Siren} title={`${p.redFlags.count} red flag${p.redFlags.count > 1 ? 's' : ''} on the record now – open it to see them`}>
                      Red flag{p.redFlags.count > 1 ? `s ${p.redFlags.count}` : ''}
                    </StatusPill>
                  )}
                </span>
              ) : (
                <span className="muted">Nothing</span>
              );
            },
          },
          {
            key: 'lastVisit',
            header: 'Last seen',
            sortKey: 'lastVisitOn',
            sortFirst: 'desc',
            render: (p) =>
              p.lastVisitOn ? (
                <>
                  {sinceText(p.lastVisitOn)}
                  <div className="cell-sub tabular">{formatDate(p.lastVisitOn)}</div>
                </>
              ) : (
                <span className="muted">Not seen yet</span>
              ),
          },
        ]
      : [
          {
            key: 'createdAt',
            header: 'Registered',
            sortKey: 'createdAt',
            sortFirst: 'desc',
            render: (p) => (
              <>
                {sinceText(p.createdAt)}
                <div className="cell-sub tabular">{formatDateTime(p.createdAt)}</div>
              </>
            ),
          },
        ]),
    // Under "My patients" every row is the same doctor: the column is left out
    ...(params.doctor === 'me'
      ? []
      : [{ key: 'doctor', header: 'Doctor', className: 'wrap-cell', render: (p) => p.assignedDoctorName ?? <span className="muted">Not assigned</span> }]),
    // Reception: call, book and admit from the row (owner, 13 Oct 2026) – not for a duplicate or a closed record
    ...(isReception
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Quick actions</span>,
            className: 'pt-actions-cell',
            render: (p) =>
              p.duplicateOf || p.closed ? null : (
                <span className="pt-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  {p.phone && (
                    <a className="icon-btn" href={`tel:${p.phone.replace(/\s+/g, '')}`} aria-label={`Call ${p.fullName}`} title="Call">
                      <Phone aria-hidden="true" />
                    </a>
                  )}
                  <button type="button" className="icon-btn" aria-label={`Book an appointment for ${p.fullName}`} title="Book appointment" onClick={() => navigate('/appointments', { state: { bookFor: { id: p.id, fullName: p.fullName, mrn: p.mrn, phone: p.phone ?? '' } } })}>
                    <CalendarPlus aria-hidden="true" />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Admit ${p.fullName}`} title="Admit" onClick={() => setAdmitting(p)}>
                    <BedDouble aria-hidden="true" />
                  </button>
                </span>
              ),
          },
        ]
      : []),
  ];

  // Quick choices, always in view (one click each); the rest under "More filters"
  const QUICK_CARE = [
    ['', 'Everyone'],
    ['antenatal', 'Pregnant'],
    ['postnatal', 'After delivery'],
    ['newborn', 'Newborn'],
    ['gynaecology', 'Gynaecology'],
    ['infertility', 'Fertility'],
    ['abortion', 'Abortion'],
  ];
  const SORT_WORDS = {
    '-lastVisitOn': 'most recently seen first',
    lastVisitOn: 'seen longest ago first',
    '-createdAt': 'newest first',
    createdAt: 'oldest first',
    fullName: 'by name A–Z',
    '-fullName': 'by name Z–A',
    'pregnancy.effectiveEdd': 'due date soonest first',
    '-pregnancy.effectiveEdd': 'due date latest first',
  };
  const WHOSE = { me: 'Your patients', mine_or_unassigned: 'Your and unassigned patients', all: 'All patients', unassigned: 'Patients without a doctor' };
  const whose = `${todayOnly ? 'Today · ' : ''}${WHOSE[params.doctor] ?? `Patients of ${doctors.data?.doctors?.find((d) => d.id === params.doctor)?.name ?? 'one doctor'}`}`;
  const careWord = params.careType ? ` · ${QUICK_CARE.find(([k]) => k === params.careType)?.[1] ?? ''}` : '';
  const duplicateWord = { include: ' · duplicates shown', only: ' · only duplicates' }[duplicates] ?? '';
  const summary = data ? `${whose}${careWord}${params.risk === 'high' ? ' · high risk' : ''}${duplicateWord}: ${data.total} ${data.total === 1 ? (duplicates === 'only' ? 'record' : 'patient') : duplicates === 'only' ? 'records' : 'patients'}, ${SORT_WORDS[params.sort] ?? 'sorted'}.` : '';

  const doctorOptions = [
    { value: 'all', label: 'All doctors' },
    ...(isDoctor
      ? [
          { value: 'me', label: 'My patients' },
          { value: 'mine_or_unassigned', label: 'My + not assigned' },
        ]
      : []),
    { value: 'unassigned', label: 'Not assigned' },
    ...(doctors.data?.doctors ?? []).map((d) => ({ value: d.id, label: d.name })),
  ];
  const filtered = search || params.careType || params.risk || duplicates || params.registeredFrom || params.registeredTo || params.doctor !== defaultDoctor;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Patients' }]}
        title="Patients"
        help={`Click a patient to open her record. Use the choices above the list to show only some patients.${seesDuplicates ? ' Records marked as a duplicate of another are hidden: More filters shows them.' : ''}`}
        actions={
          <>
            <ExportButton what="patients" />
            {canRegister && <MenuButton className="btn btn-primary" icon={UserPlus} label="New patient" items={newPatientLinks(roles)} align="end" />}
          </>
        }
      />
      <div className="pf-content">
        <SignupsNotice roles={roles} />
        <Alert type="error">{error}</Alert>
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
        <div className="pt-quick">
          <div className="segmented" role="group" aria-label="Which day">
            <button type="button" aria-pressed={params.day === 'today'} onClick={() => setParams({ day: 'today' })}>
              Today's patients
            </button>
            <button type="button" aria-pressed={params.day !== 'today'} onClick={() => setParams({ day: 'all' })}>
              All patients
            </button>
          </div>
          {isDoctor && (
            <div className="segmented" role="group" aria-label="Whose patients">
              <button type="button" aria-pressed={params.doctor === 'me'} onClick={() => setParams({ doctor: 'me' })}>
                My patients
              </button>
              <button type="button" aria-pressed={params.doctor === 'all'} onClick={() => setParams({ doctor: 'all' })}>
                All patients
              </button>
            </div>
          )}
          <div className="segmented" role="group" aria-label="Type of care">
            {QUICK_CARE.map(([value, label]) => (
              <button key={value || 'all'} type="button" aria-pressed={params.careType === value} onClick={() => setParams({ careType: value })}>
                {label}
              </button>
            ))}
          </div>
          {seesRisk && (
            <button type="button" className="btn btn-secondary btn-sm" aria-pressed={params.risk === 'high'} onClick={() => setParams({ risk: params.risk === 'high' ? '' : 'high' })}>
              <TriangleAlert aria-hidden="true" /> {params.risk === 'high' ? 'High risk only – on' : 'High risk only'}
            </button>
          )}
        </div>
        {summary && <p className="pt-summary">{summary}</p>}
        <DataTable
          caption="Patients"
          columns={columns}
          rows={data?.patients}
          loading={loading}
          sort={params.sort}
          onSort={(sort) => setParams({ sort })}
          onRowClick={(p) => navigate(`/patients/${p.id}`)}
          emptyText={
            filtered ? (
              <span className="pt-empty">
                No patients match these filters.{' '}
                <button type="button" className="btn btn-link btn-sm" onClick={reset}>
                  Clear the filters
                </button>
              </span>
            ) : todayOnly ? (
              <span className="pt-empty">
                No patients registered, booked or seen today yet.{' '}
                <button type="button" className="btn btn-link btn-sm" onClick={() => setParams({ day: 'all' })}>
                  Show all patients
                </button>
              </span>
            ) : (
              <span className="pt-empty">
                No patients in this hospital yet.
                {canRegister && <MenuButton className="btn btn-secondary btn-sm" icon={UserPlus} label="Register the first patient" items={newPatientLinks(roles)} />}
              </span>
            )
          }
          toolbar={
            <>
              <SearchInput value={search} onChange={setSearch} placeholder="Name, phone or patient no.…" label="Search patients" />
              {/* The filters are folded behind one button (always open while any is in use) */}
              <button type="button" className="btn btn-secondary btn-sm pt-filters-btn" aria-expanded={showFilters || moreFilters > 0} onClick={() => setShowFilters((x) => !x)}>
                <SlidersHorizontal aria-hidden="true" /> More filters{moreFilters ? ` (${moreFilters})` : ''}
              </button>
              {(showFilters || moreFilters > 0) && (
                <>
              <FilterSelect label="Doctor" value={params.doctor} onChange={(doctor) => setParams({ doctor })} allLabel={null} options={doctorOptions} />
              {seesRisk && (
                <FilterSelect
                  label="Risk"
                  value={params.risk}
                  onChange={(risk) => setParams({ risk })}
                  allLabel="Any risk"
                  options={[
                    ...Object.entries(RISK_SHORT).map(([value, label]) => ({ value, label })),
                    { value: 'review', label: 'Override to review' },
                  ]}
                />
              )}
              <span className="pt-dates" role="group" aria-label="Registered">
                <label>
                  <span className="field-label">Registered from</span>
                  <input type="date" value={params.registeredFrom} max={params.registeredTo || undefined} onChange={(e) => setParams({ registeredFrom: e.target.value })} />
                </label>
                <label>
                  <span className="field-label">to</span>
                  <input type="date" value={params.registeredTo} min={params.registeredFrom || undefined} onChange={(e) => setParams({ registeredTo: e.target.value })} />
                </label>
              </span>
              {seesDuplicates && (
                <FilterSelect
                  label="Duplicates"
                  value={duplicates}
                  onChange={(value) => setParams({ duplicates: value })}
                  allLabel="Duplicates hidden"
                  options={[
                    { value: 'include', label: 'Duplicates shown' },
                    { value: 'only', label: 'Only duplicates' },
                  ]}
                />
              )}
                </>
              )}
              <ClearFilters show={Boolean(filtered)} onClick={reset} />
            </>
          }
          footer={
            data && (
              <TablePagination
                page={data.page}
                totalPages={data.totalPages}
                total={data.total}
                limit={data.limit}
                onPage={(page) => setParams({ page })}
                onLimit={(limit) => setParams({ limit })}
                label="patients"
              />
            )
          }
        />
      </div>
      {admitting && (
        <AdmitDialog
          patient={admitting}
          onClose={() => setAdmitting(null)}
          onAdmitted={(info) => {
            setAdmitting(null);
            setNotice(`${info.patient.fullName} is admitted to ${info.ward} · ${info.bed}.`);
            setAdmittedSlip(info);
          }}
        />
      )}
      {admittedSlip && <AdmissionSlip info={admittedSlip} onClose={() => setAdmittedSlip(null)} />}
    </>
  );
}
