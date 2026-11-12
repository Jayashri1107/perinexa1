import { useState } from 'react';
import { BedDouble, Siren } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { RequestStatus, lineWords } from '../inpatient/AskPharmacy.jsx';
import { PharmacyHeader, useSend } from './pharmacyUi.jsx';

// PH12 (docs/PHARMACY_BUILD_NOTE.md): Pharmacy → Ward requests – what the wards asked for admitted patients, open and
// urgent first. Issue opens the issue counter filled with what is still to give (the usual checks; the ordering doctor
// is the prescriber); a line the pharmacy will not give is refused with a reason the ward sees.

export function WardRequestsPage() {
  const [all, setAll] = useState(false);
  const res = useFetch('/pharmacy/ward-requests', all ? {} : { open: '1' });
  const navigate = useNavigate();
  const [refusing, setRefusing] = useState(null); // { requestId, medicineId, name, reason }
  const refuse = useSend(() => {
    setRefusing(null);
    res.reload();
  });
  const list = res.data?.requests ?? [];
  return (
    <>
      <PharmacyHeader title="Ward requests" crumb="Ward requests" />
      <div className="pf-content lab-stack">
        <Alert type="error">{res.error ?? refuse.error}</Alert>
        <label className="appt-reason">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show answered and cancelled requests too
        </label>
        {res.data && !list.length && <p className="muted">{all ? 'No ward requests yet.' : 'No open ward request.'}</p>}
        {list.map((r) => {
          const open = r.status === 'requested' || r.status === 'part_issued';
          return (
            <section key={r.id} className="card">
              <h2>
                {r.number} · {r.patient?.fullName ?? ''} <span className="muted">({r.patient?.mrn ?? ''})</span> <RequestStatus status={r.status} />{' '}
                {r.urgent && (
                  <StatusPill tone="high" icon={Siren}>
                    Urgent
                  </StatusPill>
                )}
              </h2>
              <p className="hint">
                {r.stay ? `${r.stay.ward || 'Ward'}${r.stay.bed ? `, bed ${r.stay.bed}` : ''}${r.stay.admitted ? '' : ' – discharged'} · ` : ''}
                {formatDateTime(r.requested.at)} · asked by {r.requested.byName} · ordered by {r.orderedBy.name}
                {r.orderedBy.reg ? ` (Reg. ${r.orderedBy.reg})` : ''}
                {r.note ? ` · ${r.note}` : ''}
              </p>
              <ul className="plain-list">
                {r.lines.map((l) => {
                  const lineOpen = open && !l.refused && l.issuedQty < l.qty;
                  return (
                    <li key={l.medicineId}>
                      {lineWords(l)}
                      {lineOpen && l.medicine && <span className="muted"> · in stock {l.medicine.inStock ?? 0}</span>}
                      {lineOpen &&
                        (refusing?.requestId === r.id && refusing.medicineId === l.medicineId ? (
                          <span className="row">
                            <Field label={`Why is ${l.name} not given?`} id={`wr-why-${r.id}-${l.medicineId}`} error={refuse.fields.reason}>
                              <input id={`wr-why-${r.id}-${l.medicineId}`} value={refusing.reason} maxLength={200} onChange={(e) => setRefusing({ ...refusing, reason: e.target.value })} />
                            </Field>
                            <button type="button" className="btn btn-secondary btn-sm" disabled={refuse.busy || refusing.reason.trim().length < 3} onClick={() => refuse.send(`/pharmacy/ward-requests/${r.id}/refuse`, { medicineId: l.medicineId, reason: refusing.reason })}>
                              Not given
                            </button>
                            <button type="button" className="btn btn-link btn-sm" onClick={() => setRefusing(null)}>
                              Back
                            </button>
                          </span>
                        ) : (
                          <button type="button" className="btn btn-link btn-sm" onClick={() => setRefusing({ requestId: r.id, medicineId: l.medicineId, reason: '' })}>
                            Will not give
                          </button>
                        ))}
                    </li>
                  );
                })}
              </ul>
              {open && r.stay?.admitted && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/pharmacy/issue', { state: { patient: r.patient, wardRequest: r } })}>
                  <BedDouble aria-hidden="true" /> Issue
                </button>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
