// Admitting a patient: when, ward, bed, reason and her doctor (her own doctor chosen already). Used on her record and
// on the front desk's Admissions page. onAdmitted(stay) gets the new stay.
import { useState } from 'react';
import { admissionsApi, patientsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Modal } from '../../components/Modal.jsx';
import { useOptions } from '../../hooks/useOptions.js';
import { requestId } from '../visits/visitFormat.js';
import { toLocalInput } from './inpatientFormat.js';
import { BedPicker } from './BedPicker.jsx';

export function AdmitDialog({ patient, onClose, onAdmitted }) {
  const doctors = useOptions(patientsApi.doctors);
  const [form, setForm] = useState(() => ({ admittedAt: toLocalInput(new Date()), wardId: '', bed: '', reason: '', doctorId: patient.assignedDoctorId ?? '', clientRequestId: requestId() }));
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const admit = async (e) => {
    e.preventDefault();
    setError('');
    setFields({});
    setSaving(true);
    try {
      const r = await admissionsApi.admit({ patientId: patient.id, ...form, admittedAt: new Date(form.admittedAt).toISOString() });
      onAdmitted(r.stay);
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setSaving(false);
    }
  };

  return (
    <Modal title={`Admit ${patient.name}`} onClose={onClose} size="lg">
      <form onSubmit={admit}>
        <Alert type="error">{error}</Alert>
        <div className="form-grid">
          <div className="form-field width-half"><label htmlFor="adm-at">Admitted at</label><input id="adm-at" type="datetime-local" value={form.admittedAt} onChange={set('admittedAt')} /></div>
          <div className="form-field width-half">
            <label htmlFor="adm-doctor">Doctor</label>
            <select id="adm-doctor" value={form.doctorId} onChange={set('doctorId')}>
              <option value="">{doctors.length ? 'Choose…' : 'No doctors in this hospital yet'}</option>
              {doctors.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div className="form-field"><label htmlFor="adm-reason">Reason for admission</label><input id="adm-reason" value={form.reason} maxLength={300} onChange={set('reason')} placeholder="For example: in labour, planned caesarean" /></div>
        </div>
        <BedPicker value={{ wardId: form.wardId, bed: form.bed }} onChange={(v) => setForm({ ...form, ...v })} error={fields.bed ?? fields.wardId} />
        <div className="modal-foot inline">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!form.wardId || !form.bed || saving}>{saving ? 'Admitting…' : 'Admit'}</button>
        </div>
      </form>
    </Modal>
  );
}
