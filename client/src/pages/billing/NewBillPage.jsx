// A new bill: choose the patient, add lines from the price list.
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { billsApi, patientsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { PatientPicker } from '../../components/PatientPicker.jsx';
import { BillLinesEditor, newLine, toServerLines } from './BillLinesEditor.jsx';

export function NewBillPage() {
  const navigate = useNavigate();
  const [patient, setPatient] = useState(null);
  const [lines, setLines] = useState([newLine()]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Opened from a patient's record ("Bills" → New bill): she is chosen already.
  const [params] = useSearchParams();
  const patientId = params.get('patientId');
  useEffect(() => {
    if (!patientId) return;
    patientsApi
      .get(patientId)
      .then((r) => setPatient({ id: r.patient.id, name: r.patient.name, patientNumber: r.patient.patientNumber }))
      .catch(() => {});
  }, [patientId]);

  const save = async (e) => {
    e.preventDefault();
    setError('');
    if (!patient) return setError('Choose the patient.');
    setSaving(true);
    try {
      const { bill } = await billsApi.create({ patientId: patient.id, lines: toServerLines(lines) });
      navigate(`/hospital/billing/bills/${bill.id}`, { replace: true });
    } catch (err) {
      setError(Object.values(err.fields ?? {})[0] ?? err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} noValidate>
      <PageHeader back={<Link to="/hospital/billing" className="back-link"><ArrowLeft size={16} aria-hidden /> Bills</Link>} title="New bill" />
      <Alert type="error">{error}</Alert>
      <section className="card">
        <PatientPicker search={billsApi.patients} value={patient} onChange={setPatient} />
        <h2 className="top-gap">Lines</h2>
        <BillLinesEditor value={lines} onChange={setLines} />
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Create bill'}</button>
        </div>
      </section>
    </form>
  );
}
