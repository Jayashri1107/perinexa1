// Her stays in hospital on her record, with Admit for her doctor or an RMO.
import { BedDouble } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { admissionsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Modal } from '../../components/Modal.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { formatDate } from '../../utils/format.js';
import { stayLook, toLocalInput } from '../inpatient/inpatientFormat.js';
import { requestId } from '../visits/visitFormat.js';

export function PatientStaysCard({ patient }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);

  useEffect(() => {
    admissionsApi.ofPatient(patient.id).then(setData).catch((err) => setError(err.message));
  }, [patient.id]);

  const admit = async (e) => {
    e.preventDefault();
    try {
      const r = await admissionsApi.admit({ patientId: patient.id, ...form, admittedAt: new Date(form.admittedAt).toISOString(), clientRequestId: form.clientRequestId });
      navigate(`/hospital/inpatients/${r.stay.id}`);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Stays in hospital</h2>
        {data?.canAdmit && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ admittedAt: toLocalInput(new Date()), ward: '', bed: '', reason: '', clientRequestId: requestId() })}>
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
              <Link to={`/hospital/inpatients/${s.id}`}><strong>{formatDate(s.admittedAt)}</strong></Link>
              {s.dischargedAt && ` – ${formatDate(s.dischargedAt)}`}
              <span className="muted block small">{[s.ward, s.bed && `bed ${s.bed}`, s.reason].filter(Boolean).join(' · ')}</span>
            </span>
            <StateBadge look={stayLook(s)} small />
          </li>
        ))}
      </ul>
      {form && (
        <Modal title={`Admit ${patient.name}`} onClose={() => setForm(null)}>
          <form onSubmit={admit}>
            <div className="form-grid">
              <div className="form-field width-half"><label htmlFor="adm-at">Admitted at</label><input id="adm-at" type="datetime-local" value={form.admittedAt} onChange={(e) => setForm({ ...form, admittedAt: e.target.value })} /></div>
              <div className="form-field width-third"><label htmlFor="adm-ward">Ward<span className="required" aria-hidden> *</span></label><input id="adm-ward" value={form.ward} maxLength={60} onChange={(e) => setForm({ ...form, ward: e.target.value })} /></div>
              <div className="form-field width-third"><label htmlFor="adm-bed">Bed</label><input id="adm-bed" value={form.bed} maxLength={30} onChange={(e) => setForm({ ...form, bed: e.target.value })} /></div>
              <div className="form-field"><label htmlFor="adm-reason">Reason</label><input id="adm-reason" value={form.reason} maxLength={300} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
            </div>
            <div className="modal-foot inline">
              <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={!form.ward.trim()}>Admit</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
