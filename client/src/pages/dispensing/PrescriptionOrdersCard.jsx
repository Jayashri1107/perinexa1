// Today, for the pharmacy and the front desk (owner, 8 Oct 2026): the prescriptions doctors sent and still to give –
// patient, doctor, how many medicines, how long ago – each with "Give prescription"; and how many were given today.
// It looks again every 30 seconds.
import { CircleCheck, Clock, Pill } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dispensingApi } from '../../api/index.js';
import { StateBadge } from '../../components/StateBadge.jsx';
import { formatDateTime, initialsOf, timeAgo } from '../../utils/format.js';

const READY = { tone: 'info', icon: Clock, word: 'Ready to give' };
const EVERY_MS = 30_000;

export function PrescriptionOrdersCard() {
  const [data, setData] = useState(null);
  useEffect(() => {
    const load = () => dispensingApi.queue().then(setData).catch(() => {});
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), EVERY_MS);
    return () => clearInterval(t);
  }, []);
  if (!data) return null;
  const waiting = data.waiting;
  return (
    <section className="card span-2 rx-orders">
      <div className="card-head">
        <h2><Pill size={18} aria-hidden /> Prescriptions to give <span className="rxq-count">{waiting.length}</span></h2>
        <span className="muted small"><CircleCheck size={14} aria-hidden /> {data.givenToday.length} given today</span>
      </div>
      {waiting.length === 0 ? (
        <p className="muted">No prescriptions waiting. When a doctor sends one, it appears here.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Patient</th><th>Doctor</th><th className="num">Medicines</th><th>Sent</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {waiting.map((rx) => (
                <tr key={rx.visitId}>
                  <td>
                    <div className="person">
                      <span className="avatar" aria-hidden>{initialsOf(rx.patient.name)}</span>
                      <span><strong className="block">{rx.patient.name}</strong><span className="muted small">{rx.patient.patientNumber}</span></span>
                    </div>
                  </td>
                  <td>{rx.doctor || rx.sentByName}</td>
                  <td className="num">{rx.items.length}</td>
                  <td className="nowrap" title={formatDateTime(rx.sentAt)}>{timeAgo(rx.sentAt)}</td>
                  <td><StateBadge look={READY} small /></td>
                  <td className="actions"><Link to={`/hospital/dispensing/${rx.visitId}`} className="btn btn-primary btn-sm">Give prescription</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
