// Her stays in hospital on her record, with Admit for her doctor or an RMO.
import { BedDouble } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { admissionsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { formatDate } from '../../utils/format.js';
import { AdmitDialog } from '../inpatient/AdmitDialog.jsx';
import { stayLook } from '../inpatient/inpatientFormat.js';

export function PatientStaysCard({ patient }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);

  useEffect(() => {
    admissionsApi.ofPatient(patient.id).then(setData).catch((err) => setError(err.message));
  }, [patient.id]);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Stays in hospital</h2>
        {data?.canAdmit && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm(true)}>
            <BedDouble size={14} aria-hidden /> Admit
          </button>
        )}
      </div>
      <Alert type="error">{error}</Alert>
      {data && data.items.length === 0 && <p className="muted">Never admitted.</p>}
      <ul className="plain-list rows">
        {(data?.items ?? []).map((s) => (
          <li key={s.id} className="appt-line">
            <span>
              {data.canOpen ? <Link to={`/hospital/inpatients/${s.id}`}><strong>{formatDate(s.admittedAt)}</strong></Link> : <strong>{formatDate(s.admittedAt)}</strong>}
              {s.admissionNumber && <span className="muted"> · {s.admissionNumber}</span>}
              {s.dischargedAt && ` – ${formatDate(s.dischargedAt)}`}
              <span className="muted block small">{[s.ward, s.bed && `bed ${s.bed}`, s.reason].filter(Boolean).join(' · ')}</span>
            </span>
            <StateBadge look={stayLook(s)} small />
          </li>
        ))}
      </ul>
      {form && (
        <AdmitDialog
          patient={patient}
          onClose={() => setForm(null)}
          onAdmitted={(stay) => {
            setForm(null);
            if (data?.canOpen) navigate(`/hospital/inpatients/${stay.id}`);
            else admissionsApi.ofPatient(patient.id).then(setData);
          }}
        />
      )}
    </section>
  );
}
