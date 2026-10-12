import { ClipboardList, FileText, Siren, TestTube } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { CARE_TYPE_SHORT } from '../patients/patientFormat.js';
import { Section } from '../worklist/WorklistSections.jsx';
import { FLAG_LOOK, orderLook, testNames } from './labFormat.js';

// The Lab module (Version 2): the lab's worklist – samples to take, results to enter, and what was reported in
// the last 7 days. Urgent orders come first. Lab staff see every order (the patient's name, number and age
// only); doctors, RMOs and nurses see the orders of the patients whose medical details they may see.

const LISTS = [
  { key: 'collect', label: 'Samples to take', icon: TestTube, empty: 'No samples waiting.' },
  { key: 'report', label: 'Results to enter', icon: ClipboardList, empty: 'No results waiting to be entered.' },
  { key: 'done', label: 'Reported (last 7 days)', icon: FileText, empty: 'Nothing reported in the last 7 days.' },
];

export function LabWorklistPage() {
  const [params, setParams] = useSearchParams();
  const list = LISTS.some((l) => l.key === params.get('list')) ? params.get('list') : 'collect';
  const { data, error, loading } = useFetch('/lab/worklist', { list });
  const current = LISTS.find((l) => l.key === list);
  const count = (key) => (key === 'done' ? null : data?.counts?.[key]);

  return (
    <>
      <PageHeader title="Lab" help="Samples to take, results to enter and recent reports. Open an order to enter its results or attach the report." />
      <div className="pf-content">
        <div className="segmented lab-lists" aria-label="Lab lists">
          {LISTS.map((l) => (
            <button
              key={l.key}
              type="button"
              aria-pressed={l.key === list}
              onClick={() => setParams(l.key === 'collect' ? {} : { list: l.key }, { replace: true })}
            >
              {l.label}
              {count(l.key) != null && <span className="tabular"> ({count(l.key)})</span>}
            </button>
          ))}
        </div>
        <Alert type="error">{error}</Alert>
        {loading && !data ? (
          <p className="muted">Loading…</p>
        ) : (
          <Section id="lab-list" collapsible={false} icon={current.icon} title={current.label} count={data?.list === list ? data.orders.length : 0} empty={current.empty}>
            <ul className="wl-list">
              {(data?.orders ?? []).map((o) => {
                const look = orderLook(o);
                return (
                  <li key={o.id}>
                    <div className="wl-row-head">
                      <span className="wl-who">
                        <Link to={`/lab/orders/${o.id}`} className="strong-name">
                          {o.patient.fullName}
                        </Link>
                        <span className="muted tabular">
                          {[o.patient.mrn, o.patient.age != null ? `${o.patient.age} yrs` : CARE_TYPE_SHORT[o.patient.careType], o.patient.assignedDoctorName].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="wl-counts">
                        {o.urgent && list !== 'done' && (
                          <StatusPill tone="high" icon={Siren}>
                            Urgent
                          </StatusPill>
                        )}
                        {o.abnormal && list === 'done' && (
                          <StatusPill tone="high" icon={FLAG_LOOK.abnormal.icon}>
                            Outside range
                          </StatusPill>
                        )}
                        <StatusPill tone={look.tone} icon={look.icon}>
                          {look.word}
                        </StatusPill>
                      </span>
                    </div>
                    <span className="hint">
                      {testNames(o)} · ordered by {o.ordered.byName}, {formatDateTime(o.ordered.at)}
                      {list === 'done' && o.reported ? ` · reported ${formatDateTime(o.reported.at)}` : ''}
                      {o.noteToLab ? ` · ${o.noteToLab}` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}
      </div>
    </>
  );
}
