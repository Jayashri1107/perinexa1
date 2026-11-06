import { Link, useParams, useSearchParams } from 'react-router-dom';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill, formatDate } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { NewbornLog } from './NewbornLog.jsx';
import { itemLook } from './newbornFormat.js';

// Newborn follow-up (Clinical Requirements Group A, item 4): babies with a screen or a clinic visit due, the
// defaulters to call (a screen past its last day, a visit missed by 14 days), and all. Doctors, RMOs, nurses and the
// newborn follow-up coordinator (names, numbers and dates only).

const SHOW = [
  ['due', 'Due now'],
  ['defaulters', 'Defaulters'],
  ['all', 'All babies'],
];
const openItems = (b) => [...b.screens, ...b.visits].filter((x) => ['due', 'overdue', 'defaulter'].includes(x.state));

export function NewbornFollowUpPage() {
  const [params, setParams] = useSearchParams();
  const show = SHOW.some(([k]) => k === params.get('show')) ? params.get('show') : 'due';
  const { data, error, loading } = useFetch('/newborn-follow-up', { show });
  return (
    <>
      <PageHeader title="Newborn follow-up" documentTitle="Newborn follow-up" help="Screening and the high-risk follow-up clinic: what is due now, the defaulters to call, and every baby. DRAFT schedule (NNF / RBSK) until the Lead Neonatologist confirms it." />
      <div className="pf-content">
        <Alert type="error">{error}</Alert>
        <div className="row" role="group" aria-label="Show">
          {SHOW.map(([k, label]) => (
            <button key={k} type="button" className="btn btn-secondary btn-sm" aria-pressed={show === k} onClick={() => setParams({ show: k }, { replace: true })}>
              {label}
            </button>
          ))}
        </div>
        <section className="card">
          <DataTable
            loading={loading && !data}
            rows={(data?.babies ?? []).map((b) => ({ ...b, id: b.patientId }))}
            emptyText="No babies here."
            columns={[
              { key: 'baby', header: 'Baby', render: (b) => <Link to={`/newborn-follow-up/${b.patientId}`}>{`${b.fullName} · ${b.mrn}`}</Link> },
              { key: 'birthAt', header: 'Born', render: (b) => formatDate(b.birthAt) },
              { key: 'phone', header: 'Phone', render: (b) => b.phone || '—' },
              {
                key: 'items',
                header: 'Due or missed',
                render: (b) => (
                  <span className="row">
                    {openItems(b).map((x) => {
                      const look = itemLook(x);
                      return (
                        <StatusPill key={x.key} tone={look.tone} icon={look.icon}>
                          {`${x.label}: ${look.word}`}
                        </StatusPill>
                      );
                    })}
                    {!openItems(b).length && <span className="hint">Nothing due</span>}
                  </span>
                ),
              },
            ]}
          />
        </section>
      </div>
    </>
  );
}

/** One baby's log, opened from the list (how the coordinator reaches it; staff also find it on her record). */
export function NewbornLogPage() {
  const { patientId } = useParams();
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Newborn follow-up', to: '/newborn-follow-up' }, { label: 'Screening log' }]} title="Screening log" documentTitle="Screening log" />
      <div className="pf-content">
        <NewbornLog patientId={patientId} />
      </div>
    </>
  );
}

/** The Screening tab of a baby's record. */
export function PatientScreeningTab() {
  const { id } = useParams();
  return <NewbornLog patientId={id} />;
}
