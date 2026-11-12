import { useState } from 'react';
import { BedDouble, Siren } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { HOSPITAL_LAB } from '../../platform/modules.js';
import { orderLook } from './labFormat.js';

// Lab → Admitted patients (12 Nov 2026, the developer's request): who is in hospital now – name, patient number, ward
// and bed – with her lab orders open or reported in the last two days, to collect samples on the wards. For the lab
// only (server/src/routes/lab.js GET /inpatients); nothing else of her record.

export function LabInpatientsPage() {
  const res = useFetch('/lab/inpatients');
  const [toCollect, setToCollect] = useState(false);
  const all = res.data?.inpatients ?? [];
  const rows = toCollect ? all.filter((r) => r.orders.some((o) => o.status === 'ordered')) : all;
  return (
    <>
      <PageHeader tabs={HOSPITAL_LAB.tabs} title="Admitted patients" documentTitle="Admitted patients" help="Who is in hospital now, by ward and bed, with her lab orders – to collect samples on the wards." />
      <div className="pf-content lab-stack">
        <Alert type="error">{res.error}</Alert>
        <label className="check">
          <input type="checkbox" checked={toCollect} onChange={(e) => setToCollect(e.target.checked)} /> Only those with a sample to take
        </label>
        {res.data && !rows.length && <p className="muted">{toCollect ? 'No sample to take on the wards.' : 'Nobody is admitted now.'}</p>}
        {rows.length > 0 && (
          <table className="bill-report">
            <thead>
              <tr>
                <th scope="col">Ward and bed</th>
                <th scope="col">Patient</th>
                <th scope="col">Lab orders</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.patient.id}>
                  <td>
                    <BedDouble aria-hidden="true" className="lab-ip-icon" /> {r.ward || 'Ward not set'}
                    {r.bed ? `, bed ${r.bed}` : ''}
                  </td>
                  <td>
                    <strong>{r.patient.fullName}</strong> <span className="muted">{r.patient.mrn}</span>
                  </td>
                  <td>
                    {!r.orders.length ? (
                      <span className="muted">None open</span>
                    ) : (
                      <ul className="plain-list">
                        {r.orders.map((o) => {
                          const look = orderLook(o);
                          return (
                            <li key={o.id}>
                              <Link to={`/lab/orders/${o.id}`}>{o.tests.join(', ')}</Link>{' '}
                              <StatusPill tone={look.tone} icon={look.icon}>
                                {look.word}
                              </StatusPill>
                              {o.urgent && (
                                <>
                                  {' '}
                                  <StatusPill tone="high" icon={Siren}>
                                    Urgent
                                  </StatusPill>
                                </>
                              )}
                              {o.sampleNo ? <span className="muted"> · {o.sampleNo}</span> : ''}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
