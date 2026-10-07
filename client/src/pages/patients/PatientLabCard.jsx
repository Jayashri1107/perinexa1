// Her lab orders on her record (latest first), with Order tests for her doctor or an RMO.
import { FlaskConical, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { labApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { formatDate } from '../../utils/format.js';
import { LabOrderDialog } from '../lab/LabOrderDialog.jsx';
import { orderLook } from '../lab/labFormat.js';

export function PatientLabCard({ patient }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [ordering, setOrdering] = useState(false);

  useEffect(() => {
    labApi.forPatient(patient.id).then(setData).catch((err) => setError(err.message));
  }, [patient.id]);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Lab</h2>
        {data?.canOrder && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOrdering(true)}><FlaskConical size={14} aria-hidden /> Order tests</button>
        )}
      </div>
      <Alert type="error">{error}</Alert>
      {data && data.items.length === 0 && <p className="muted">No lab tests ordered yet.</p>}
      <ul className="plain-list rows">
        {(data?.items ?? []).slice(0, 10).map((o) => (
          <li key={o.id} className="appt-line">
            <span>
              <Link to={`/hospital/lab/orders/${o.id}`}><strong>{o.orderNumber}</strong></Link> <span className="muted small">{formatDate(o.orderedAt)}</span>
              <span className="muted block small">{o.tests.join(', ')}</span>
            </span>
            <StateBadge look={orderLook(o.status)} small />
            {o.abnormal > 0 && <span className="badge badge-danger small"><TriangleAlert size={12} aria-hidden /> {o.abnormal} outside range</span>}
          </li>
        ))}
      </ul>
      {ordering && <LabOrderDialog patient={patient} who={data.who} onClose={() => setOrdering(false)} />}
    </section>
  );
}
