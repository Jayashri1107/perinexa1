// Pharmacy → Issue to ward: medicines given to a patient in hospital – the earliest-expiring batch first, charged to
// her hospital bill, and shown as "Issued to ward" in the registers. The pharmacist sees who is in hospital by name,
// number, ward and bed only.
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { wardIssuesApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { formatMoney } from '../../utils/format.js';
import { MedicineSearch } from './MedicineSearch.jsx';
import { PharmacyFrame } from './PharmacyFrame.jsx';

export function IssueToWardPage() {
  const navigate = useNavigate();
  const [stays, setStays] = useState(null);
  const [admissionId, setAdmissionId] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [lines, setLines] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    wardIssuesApi.admitted().then((r) => setStays(r.items)).catch((err) => setError(err.message));
  }, []);

  const add = (m) => !lines.some((l) => l.medicineId === m.id) && setLines([...lines, { medicineId: m.id, name: `${m.name} ${m.strength ?? ''}`.trim(), available: m.available, mrp: m.mrp, qty: 1 }]);
  const total = lines.reduce((n, l) => n + (l.mrp ?? 0) * (Number(l.qty) || 0), 0);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { sale } = await wardIssuesApi.issue({ admissionId, doctorName, lines: lines.map((l) => ({ medicineId: l.medicineId, qty: Number(l.qty) })) });
      navigate(`/hospital/pharmacy/sales/${sale.id ?? sale._id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PharmacyFrame subtitle="Medicines for a patient in hospital, charged to her hospital bill.">
      <form onSubmit={submit} noValidate>
        <Alert type="error">{error}</Alert>
        <section className="card">
          <div className="form-grid">
            <div className="form-field width-half">
              <label htmlFor="ward-patient">Patient in hospital</label>
              <select id="ward-patient" value={admissionId} onChange={(e) => setAdmissionId(e.target.value)}>
                <option value="">{stays?.length === 0 ? 'Nobody is admitted' : 'Choose…'}</option>
                {(stays ?? []).map((s) => <option key={s.id} value={s.id}>{s.patient.name} ({s.patient.patientNumber}) – {s.ward}{s.bed && `, bed ${s.bed}`}</option>)}
              </select>
            </div>
            <div className="form-field width-half">
              <label htmlFor="ward-doctor">Prescribing doctor</label>
              <input id="ward-doctor" value={doctorName} maxLength={120} onChange={(e) => setDoctorName(e.target.value)} />
              <span className="field-help">Needed for H1, X and narcotic medicines (register).</span>
            </div>
          </div>
        </section>
        <section className="card top-gap">
          <MedicineSearch onPick={add} />
          {lines.length > 0 && (
            <div className="table-wrap top-gap-sm">
              <table className="table compact-inputs">
                <thead><tr><th>Medicine</th><th className="num">In stock</th><th className="num">Qty</th><th className="num">Amount</th><th /></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.medicineId}>
                      <td>{l.name}</td>
                      <td className="num">{l.available}</td>
                      <td className="num"><input aria-label={`Quantity of ${l.name}`} type="number" min="1" max={l.available} value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></td>
                      <td className="num">{formatMoney((l.mrp ?? 0) * (Number(l.qty) || 0))}</td>
                      <td className="actions"><button type="button" className="icon-btn" aria-label={`Remove ${l.name}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={15} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="form-actions">
            <span>On her bill: <strong>{formatMoney(total)}</strong></span>
            <button type="submit" className="btn btn-primary" disabled={saving || !admissionId || lines.length === 0}>{saving ? 'Issuing…' : 'Issue to ward'}</button>
          </div>
        </section>
      </form>
    </PharmacyFrame>
  );
}
