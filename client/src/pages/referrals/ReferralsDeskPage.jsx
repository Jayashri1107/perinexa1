import { useEffect, useState } from 'react';
import { FilePlus2, X } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DataTable, SearchInput } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { moduleByKey } from '../../platform/modules.js';
import { VIA_LABELS, WAITING_LOOK, promiseLabel, promiseLook, statusLook, timeLeftWords, urgencyLook, whoFacts, whoName } from './referralFormat.js';
import { ExportButton } from '../../components/ExportButton.jsx';

// The referral desk (docs/REFERRALS_PLAN.md): the referrals from other doctors with the next promise of each and
// its clock – Open (newest first), Late (a promise past its time) and Closed. The list holds only the referrals this
// person may open (the server decides: the desk sees every referral, a doctor or RMO those of patients whose
// medical details they may see). A referring doctor's referrals: ?doctor=<id> (from Referring doctors).

const LISTS = [
  { key: 'open', label: 'Open', empty: 'No open referrals.' },
  { key: 'late', label: 'Late', empty: 'No referral has a promise past its time.' },
  { key: 'closed', label: 'Closed', empty: 'No closed referrals yet.' },
  { key: 'all', label: 'All', empty: 'No referrals yet.' },
];

/** The time now, moved on every minute – so "1 h 20 min left" keeps up while a page stays open. */
export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** A promise's clock as a pill: colour + icon + word. */
export function PromisePill({ promise, withLabel = false }) {
  const look = promiseLook(promise);
  return (
    <StatusPill tone={look.tone} icon={look.icon}>
      {withLabel ? `${promiseLabel(promise)}: ${look.word}` : look.word}
    </StatusPill>
  );
}

/** When it is due (and how long is left, while the clock runs), or when it was done. */
export function promiseWhen(p, now) {
  if (!p) return '';
  if (p.doneAt) return `Done ${formatDateTime(p.doneAt)}`;
  if (!p.due) return '';
  const running = ['waiting', 'soon', 'late'].includes(p.state);
  return running ? `${timeLeftWords(p.due, now)} · due ${formatDateTime(p.due)}` : `Due ${formatDateTime(p.due)}`;
}

/** What is waiting on a referral, as neutral tags (icon + word). */
export function WaitingTags({ waiting }) {
  const items = WAITING_LOOK.filter((w) => waiting?.[w.key]);
  if (!items.length) return null;
  return (
    <span className="wl-counts">
      {items.map((w) => (
        <StatusPill key={w.key} tone="neutral" icon={w.icon}>
          {w.word}
        </StatusPill>
      ))}
    </span>
  );
}

/** The table columns shared by the desk and the patient's Referrals tab. */
export function referralColumns(now, { showPatient = true } = {}) {
  return [
    {
      key: 'number',
      header: 'Referral',
      render: (r) => (
        <span className="name-cell-text">
          <Link to={`/referrals/${r.id}`} className="strong-name tabular">
            {r.number}
          </Link>
          <span className="muted tabular">
            {formatDateTime(r.receivedAt)} · {VIA_LABELS[r.via] ?? r.via}
          </span>
          <span>
            <StatusPill tone={urgencyLook(r).tone} icon={urgencyLook(r).icon}>
              {urgencyLook(r).word}
            </StatusPill>
          </span>
        </span>
      ),
    },
    ...(showPatient
      ? [
          {
            key: 'patient',
            header: 'Patient',
            render: (r) => (
              <span className="name-cell-text">
                <strong>{whoName(r)}</strong>
                <span className="muted tabular">{whoFacts(r)}</span>
              </span>
            ),
          },
        ]
      : []),
    {
      key: 'doctor',
      header: 'Referred by',
      render: (r) => (
        <span className="name-cell-text">
          <span>{r.referringDoctor?.name}</span>
          {r.referringDoctor?.clinic && <span className="muted">{r.referringDoctor.clinic}</span>}
        </span>
      ),
    },
    {
      key: 'next',
      header: 'Next promise',
      className: 'wrap',
      render: (r) => {
        if (r.status !== 'open') {
          const look = statusLook(r);
          return (
            <StatusPill tone={look.tone} icon={look.icon}>
              {look.word}
            </StatusPill>
          );
        }
        return (
          <span className="name-cell-text">
            {r.next ? (
              <>
                <span>
                  <PromisePill promise={r.next} /> {promiseLabel(r.next)}
                </span>
                <span className="muted tabular">{promiseWhen(r.next, now)}</span>
              </>
            ) : (
              <span className="muted">No promise waiting</span>
            )}
            <WaitingTags waiting={r.waiting} />
          </span>
        );
      },
    },
    {
      key: 'consultant',
      header: 'Consultant',
      render: (r) => (
        <span className="name-cell-text">
          <span>{r.consultant?.name ?? '—'}</span>
          {r.centreName && <span className="muted">{r.centreName}</span>}
        </span>
      ),
    },
  ];
}

export function ReferralsDeskPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const list = LISTS.some((l) => l.key === params.get('list')) ? params.get('list') : 'open';
  const doctorId = params.get('doctor') ?? '';
  const { data, error, loading } = useFetch('/referrals', { list, referringDoctorId: doctorId });
  const [search, setSearch] = useState('');
  const now = useNow();
  const current = LISTS.find((l) => l.key === list);
  const term = search.toLowerCase();
  // A quick look-up within the list on screen: the number, her name or the referring doctor
  const rows = data?.referrals?.filter((r) => !term || [r.number, whoName(r), r.patient?.mrn, r.referringDoctor?.name, r.referringDoctor?.clinic].some((t) => t && String(t).toLowerCase().includes(term)));
  const doctorName = data?.referrals?.[0]?.referringDoctor?.name;
  const setList = (key) => {
    const next = new URLSearchParams(params);
    if (key === 'open') next.delete('list');
    else next.set('list', key);
    setParams(next, { replace: true });
  };
  return (
    <>
      <PageHeader
        title="Referrals"
        help="Referrals from other doctors and the hospital’s promises to them: a reply within 2 working hours, urgent patients seen the same day and routine ones within 48 hours, the consultant note within 24 hours of her first visit and the discharge summary within 24 hours of discharge."
        tabs={moduleByKey('referrals')?.tabs}
        actions={
          <>
            <ExportButton what="referrals" />
            <Link to="/referrals/new" className="btn btn-primary">
              <FilePlus2 aria-hidden="true" /> New referral
            </Link>
          </>
        }
      />
      <div className="pf-content">
        <div className="segmented lab-lists" aria-label="Referral lists">
          {LISTS.map((l) => (
            <button key={l.key} type="button" aria-pressed={l.key === list} onClick={() => setList(l.key)}>
              {l.label}
            </button>
          ))}
        </div>
        {doctorId && (
          <Alert type="info">
            Referrals from {doctorName ?? 'one referring doctor'}.{' '}
            <button
              type="button"
              className="btn btn-link plan-inline-link"
              onClick={() => {
                const next = new URLSearchParams(params);
                next.delete('doctor');
                setParams(next, { replace: true });
              }}
            >
              <X aria-hidden="true" /> Show every doctor
            </button>
          </Alert>
        )}
        <Alert type="error">{error}</Alert>
        <DataTable
          caption={`Referrals – ${current.label}`}
          columns={referralColumns(now)}
          rows={rows}
          loading={loading}
          emptyText={term ? 'No referral in this list matches the search.' : current.empty}
          onRowClick={(r) => navigate(`/referrals/${r.id}`)}
          toolbar={<SearchInput value={search} onChange={setSearch} placeholder="Number, patient or doctor" label="Search this list" />}
        />
      </div>
    </>
  );
}
