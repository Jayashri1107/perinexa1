import { CircleCheck, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PharmacyHeader, money } from './pharmacyUi.jsx';
import { billsPlace } from './RegisterPage.jsx';

// Pharmacy → Discharge clearance (18 Nov 2026, the pharmacy's request): those the doctor has discharged in the last 7
// days and the desk has not yet cleared for leaving, with what each still owes the pharmacy (bills paid in part or put
// on credit). Settle it on her bills (Settle credit, or her advance); the desk sees the same amount when it clears her.

export function DischargeClearancePage() {
  const res = useFetch('/pharmacy/discharge-clearance');
  const stays = res.data?.stays ?? [];
  const owing = stays.filter((s) => s.duePaise > 0);
  return (
    <>
      <PharmacyHeader title="Discharge clearance" crumb="Discharge clearance" subtitle="Discharged and waiting to leave: settle what is due at the pharmacy before the desk clears them." />
      <div className="pf-content bill-page">
        {res.error && <Alert type="error">{res.error}</Alert>}
        {!res.data && !res.error && <p className="muted">Loading…</p>}
        {res.data && !stays.length && <p className="muted">No one is waiting to be cleared for leaving.</p>}
        {stays.length > 0 && (
          <section className="card bill-section">
            <h2>
              Waiting to leave ({stays.length}) · {owing.length} with pharmacy dues
            </h2>
            <table className="bill-report">
              <thead>
                <tr>
                  <th scope="col">Patient</th>
                  <th scope="col">Ward · bed</th>
                  <th scope="col">Discharged</th>
                  <th scope="col">Pharmacy</th>
                  <th scope="col">
                    <span className="sr-only">Bills</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {stays.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.patient.fullName}</strong> <span className="muted tabular">{[s.patient.mrn, s.ipdNo].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td>{[s.ward, s.bed].filter(Boolean).join(' · ')}</td>
                    <td className="nowrap">{formatDateTime(s.dischargedAt)}</td>
                    <td>
                      {s.duePaise > 0 ? (
                        <StatusPill tone="watch" icon={TriangleAlert}>
                          {money(s.duePaise)} due ({s.bills.join(', ')})
                        </StatusPill>
                      ) : (
                        <StatusPill tone="stable" icon={CircleCheck}>
                          Cleared
                        </StatusPill>
                      )}
                    </td>
                    <td>
                      {s.duePaise > 0 && (
                        <Link className="btn btn-link btn-sm" to={billsPlace(s.patient)[0]} state={billsPlace(s.patient)[1].state}>
                          Her bills
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </>
  );
}
