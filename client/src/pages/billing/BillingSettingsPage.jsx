// Billing → Settings (admin): the UPI ID for payment links, with every change kept.
import { useEffect, useState } from 'react';
import { billingSettingsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { DataTable } from '../../components/list/DataTable.jsx';
import { FormBuilder } from '../../components/form/FormBuilder.jsx';
import { Loader } from '../../components/Loader.jsx';
import { billingSettingsFields } from '../../forms/billingForms.js';
import { useForm } from '../../hooks/useForm.js';
import { formatDateTime } from '../../utils/format.js';
import { BillingFrame } from './BillingFrame.jsx';

function SettingsForm({ settings, onSaved }) {
  const form = useForm({ upiId: settings.upiId, payeeName: settings.payeeName });
  const [saved, setSaved] = useState(false);
  const onSubmit = async (values) => {
    const result = await billingSettingsApi.update(values);
    onSaved(result.settings);
    setSaved(true);
  };
  return (
    <form onSubmit={form.submit(onSubmit)} noValidate onChange={() => setSaved(false)}>
      <FormBuilder fields={billingSettingsFields} form={form} />
      <div className="form-actions">
        {saved && <Alert type="success">Saved.</Alert>}
        <button type="submit" className="btn btn-primary" disabled={form.submitting}>{form.submitting ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

export function BillingSettingsPage() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    billingSettingsApi.get().then((r) => setSettings(r.settings)).catch((err) => setError(err.message));
  }, []);

  return (
    <BillingFrame subtitle="Where patients' UPI payments go">
      <Alert type="error">{error}</Alert>
      {!settings && !error && <Loader />}
      {settings && (
        <>
          <section className="card">
            <Alert type="info">Check the UPI ID carefully: payment links on every bill send money to this account.</Alert>
            <SettingsForm settings={settings} onSaved={setSettings} />
          </section>
          <h2 className="top-gap">Changes</h2>
          <section className="card list-panel">
            <DataTable
              rowKey="at"
              columns={[
                { key: 'at', label: 'When', render: (h) => formatDateTime(h.at) },
                { key: 'byName', label: 'By' },
                { key: 'upiId', label: 'UPI ID', render: (h) => h.upiId || '(none)' },
                { key: 'payeeName', label: 'Name', render: (h) => h.payeeName || '—' },
              ]}
              rows={settings.history}
              emptyText="Not set yet."
            />
          </section>
        </>
      )}
    </BillingFrame>
  );
}
