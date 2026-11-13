import { useMemo, useState } from 'react';
import { BedDouble, Siren } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { HOSPITAL_LAB } from '../../platform/modules.js';
import { orderLook } from './labFormat.js';

// Lab → Admitted patients (12 Nov 2026, the developer's request): who is in hospital now – name, patient number, ward
// and bed – with her lab orders open or reported in the last two days, to collect samples on the wards. For the lab
// only (server/src/routes/lab.js GET /inpatients); nothing else of her record.
// 13 Nov 2026: the app's usual table – find by name, number, ward or bed; "All" or "Sample to take" with their counts;
// ward and bed in their own columns, sorted by ward then bed.

const toTake = (r) => r.orders.some((o) => o.status === 'ordered');
const byWardAndBed = (a, b) => (a.ward || '~').localeCompare(b.ward || '~') || String(a.bed ?? '').localeCompare(String(b.bed ?? ''), undefined, { numeric: true });

/** Does the row match the words typed (name, patient number, ward or bed)? PURE. */
export const inpatientMatches = (r, q) => {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = [r.patient.fullName, r.patient.mrn, r.ward, r.bed].filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => text.includes(w));
};

function Orders({ orders }) {
  if (!orders.length) return <span className="muted">None open</span>;
  return (
    <ul className="lab-ip-orders">
      {orders.map((o) => {
        const look = orderLook(o);
        return (
          <li key={o.id}>
            <Link to={`/lab/orders/${o.id}`}>{o.tests.join(', ')}</Link>
            <span className="lab-ip-pills">
              <StatusPill tone={look.tone} icon={look.icon}>
                {look.word}
              </StatusPill>
              {o.urgent && (
                <StatusPill tone="high" icon={Siren}>
                  Urgent
                </StatusPill>
              )}
              {o.sampleNo && <span className="muted tabular">{o.sampleNo}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const COLUMNS = [
  {
    key: 'ward',
    header: 'Ward',
    width: '18%',
    render: (r) => (
      <span className="lab-ip-ward">
        <BedDouble aria-hidden="true" />
        {r.ward || <span className="muted">Not set</span>}
      </span>
    ),
  },
  { key: 'bed', header: 'Bed', width: '8%', render: (r) => (r.bed ? <span className="tabular">{r.bed}</span> : <span className="muted">–</span>) },
  {
    key: 'patient',
    header: 'Patient',
    width: '28%',
    render: (r) => (
      <span className="lab-ip-patient">
        <strong>{r.patient.fullName}</strong>
        <span className="muted tabular">{r.patient.mrn}</span>
      </span>
    ),
  },
  { key: 'orders', header: 'Lab orders', render: (r) => <Orders orders={r.orders} /> },
];

export function LabInpatientsPage() {
  const res = useFetch('/lab/inpatients');
  const [show, setShow] = useState('all');
  const [q, setQ] = useState('');
  const all = useMemo(() => [...(res.data?.inpatients ?? [])].sort(byWardAndBed).map((r) => ({ ...r, id: r.patient.id })), [res.data]);
  const waiting = all.filter(toTake).length;
  const rows = all.filter((r) => (show === 'all' || toTake(r)) && inpatientMatches(r, q));
  const empty = q.trim() ? 'Nobody admitted matches.' : show === 'collect' ? 'No sample to take on the wards.' : 'Nobody is admitted now.';
  return (
    <>
      <PageHeader tabs={HOSPITAL_LAB.tabs} title="Admitted patients" documentTitle="Admitted patients" help="Who is in hospital now, by ward and bed, with her lab orders – to collect samples on the wards." />
      <div className="pf-content lab-tables">
        <Alert type="error">{res.error}</Alert>
        <DataTable
          caption="Admitted patients and their lab orders"
          columns={COLUMNS}
          rows={res.data ? rows : null}
          loading={res.loading}
          emptyText={empty}
          pageSize={50}
          pageLabel="patients"
          toolbar={
            <div className="lab-ip-toolbar">
              <div className="segmented" role="group" aria-label="Show">
                <button type="button" aria-pressed={show === 'all'} onClick={() => setShow('all')}>
                  All admitted <span className="tabular">({all.length})</span>
                </button>
                <button type="button" aria-pressed={show === 'collect'} onClick={() => setShow('collect')}>
                  Sample to take <span className="tabular">({waiting})</span>
                </button>
              </div>
              <label className="lab-filter" htmlFor="ip-find">
                <span>Find</span>
                <input id="ip-find" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, patient no., ward or bed" />
              </label>
            </div>
          }
        />
      </div>
    </>
  );
}
