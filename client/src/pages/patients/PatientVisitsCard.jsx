// Her visits on her record (latest first), with New visit for nurses, her doctor and RMOs.
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { visitsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { dayText } from '../appointments/appointmentFormat.js';
import { requestId, visitLook } from '../visits/visitFormat.js';

export function PatientVisitsCard({ patient }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    visitsApi.list(patient.id).then(setData).catch((err) => setError(err.message));
  }, [patient.id]);

  const start = async () => {
    setBusy(true);
    try {
      const { visit } = await visitsApi.start(patient.id, requestId());
      navigate(`/hospital/patients/${patient.id}/visits/${visit.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Visits</h2>
        {data?.canStart && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={start}><Plus size={14} aria-hidden /> New visit</button>}
      </div>
      <Alert type="error">{error}</Alert>
      {data && data.items.length === 0 && <p className="muted">No visits yet.</p>}
      <ul className="plain-list rows">
        {(data?.items ?? []).slice(0, 12).map((v) => (
          <li key={v.id} className="appt-line">
            <span>
              <Link to={`/hospital/patients/${patient.id}/visits/${v.id}`}><strong>{dayText(v.visitOn)}</strong></Link>
              <span className="muted block small">{[v.diagnosis, v.medicines ? `${v.medicines} medicine${v.medicines === 1 ? '' : 's'}` : '', v.createdByName].filter(Boolean).join(' · ')}</span>
            </span>
            <StateBadge look={visitLook(v)} small />
          </li>
        ))}
      </ul>
    </section>
  );
}
