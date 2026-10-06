// Pharmacy → Settings: the details printed on its tax invoices. The pharmacist reads them; the admin changes them.
import { useEffect, useState } from 'react';
import { pharmacySettingsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { FormBuilder } from '../../components/form/FormBuilder.jsx';
import { Loader } from '../../components/Loader.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { pharmacySettingsFields } from '../../forms/pharmacyForms.js';
import { useForm } from '../../hooks/useForm.js';
import { PharmacyFrame } from './PharmacyFrame.jsx';

function SettingsForm({ initial, canEdit }) {
  const form = useForm(initial);
  const [saved, setSaved] = useState(false);
  const fields = pharmacySettingsFields.map((f) => ({ ...f, disabled: !canEdit }));
  return (
    <form onSubmit={form.submit(async (v) => { await pharmacySettingsApi.update(v); setSaved(true); })} noValidate onChange={() => setSaved(false)}>
      <FormBuilder fields={fields} form={form} />
      {canEdit && (
        <div className="form-actions">
          {saved && <Alert type="success">Saved.</Alert>}
          <button type="submit" className="btn btn-primary" disabled={form.submitting}>{form.submitting ? 'Saving…' : 'Save'}</button>
        </div>
      )}
    </form>
  );
}

export function PharmacySettingsPage() {
  const { canAccess } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    pharmacySettingsApi.get().then(setData).catch((err) => setError(err.message));
  }, []);

  const initial = data && Object.fromEntries(pharmacySettingsFields.map((f) => [f.name, data.pharmacy?.[f.name] ?? '']));
  return (
    <PharmacyFrame subtitle="Printed on every tax invoice">
      <Alert type="error">{error}</Alert>
      {!data && !error && <Loader />}
      {data && (
        <section className="card">
          {!canAccess('pharmacyAdmin') && <Alert type="info">Only the hospital admin can change these.</Alert>}
          <SettingsForm initial={initial} canEdit={canAccess('pharmacyAdmin')} />
        </section>
      )}
    </PharmacyFrame>
  );
}
