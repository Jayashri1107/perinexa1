import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { DoctorSignature, Letterhead, LetterheadFooter } from '../../components/print/Letterhead.jsx';
import { Alert, Field } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { moduleByKey } from '../../platform/modules.js';

const EMPTY = { name: '', tagline: '', address: '', phone: '', email: '', registrationNumber: '', footer: '', consentLanguage: 'mr' };

// Hospital admins: the letterhead printed on this hospital's documents, with a live preview.
export function LetterheadSettingsPage() {
  const { user } = useAuth();
  const { data, error: loadError } = useFetch('/tenant/settings/letterhead');
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data && !form) setForm({ ...EMPTY, ...data.saved });
  }, [data, form]);

  const header = (
    <PageHeader
      breadcrumbs={[{ label: 'Hospital admin' }, { label: 'Print letterhead' }]}
      title="Print letterhead"
      help="Your hospital's details for the top of printed documents, with a preview of how they look."
      tabs={moduleByKey('hospital-admin').tabs}
    />
  );

  if (loadError) {
    return (
      <>
        {header}
        <div className="pf-content">
          <div className="card narrow load-error">
            <Alert type="error">Couldn't load the letterhead. {loadError}</Alert>
          </div>
        </div>
      </>
    );
  }
  if (!form) return <FullPageSpinner />;

  const update = (key) => (e) => {
    setSaved(false);
    setForm({ ...form, [key]: e.target.value });
  };

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);
    try {
      await api('/tenant/settings/letterhead', { method: 'PUT', body: form });
      setSaved(true);
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  };

  const preview = { ...form, name: form.name || data.hospitalName };

  return (
    <>
      {header}
      <div className="pf-content">
        <div className="letterhead-layout">
          <form className="card" onSubmit={save} noValidate>
            <h2>Letterhead details</h2>
            <Alert type="success">{saved && 'Letterhead saved.'}</Alert>
            <Alert type="error">{error && `Couldn't save the letterhead. ${error}`}</Alert>
            <Field label="Hospital name as printed" id="lh-name" error={fieldErrors.name} hint={`Leave empty to use "${data.hospitalName}".`}>
              <input id="lh-name" value={form.name} onChange={update('name')} maxLength={150} />
            </Field>
            <Field label="Tagline (optional)" id="lh-tagline" error={fieldErrors.tagline} hint="e.g. Maternity & Women's Care">
              <input id="lh-tagline" value={form.tagline} onChange={update('tagline')} maxLength={150} />
            </Field>
            <Field label="Address" id="lh-address" error={fieldErrors.address}>
              <textarea id="lh-address" rows={2} value={form.address} onChange={update('address')} maxLength={300} />
            </Field>
            <div className="form-grid">
              <Field label="Phone" id="lh-phone" error={fieldErrors.phone}>
                <input id="lh-phone" value={form.phone} onChange={update('phone')} maxLength={60} />
              </Field>
              <Field label="Email" id="lh-email" error={fieldErrors.email}>
                <input id="lh-email" type="email" value={form.email} onChange={update('email')} maxLength={254} />
              </Field>
            </div>
            <Field label="Hospital registration number" id="lh-reg" error={fieldErrors.registrationNumber}>
              <input id="lh-reg" value={form.registrationNumber} onChange={update('registrationNumber')} maxLength={80} />
            </Field>
            <Field label="Footer line (optional)" id="lh-footer" error={fieldErrors.footer} hint="e.g. emergency number or opening hours">
              <input id="lh-footer" value={form.footer} onChange={update('footer')} maxLength={300} />
            </Field>
            <Field
              label="Second language on consent forms"
              id="lh-consent-language"
              error={fieldErrors.consentLanguage}
              hint="Consent forms print in English with this language next to it. The doctor can choose the other language, or English only, when printing."
            >
              <select id="lh-consent-language" value={form.consentLanguage} onChange={update('consentLanguage')}>
                <option value="mr">मराठी (Marathi)</option>
                <option value="hi">हिंदी (Hindi)</option>
              </select>
            </Field>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save letterhead'}
            </button>
          </form>

          <section className="card letterhead-preview" aria-labelledby="lh-preview-title">
            <h2 id="lh-preview-title">Preview</h2>
            <p className="hint help">Updates as you type. The signature shows your own professional details.</p>
            <div className="paper paper-preview">
              <Letterhead letterhead={preview} />
              <div className="paper-body">
                <p className="paper-placeholder">The document's content goes here.</p>
              </div>
              <DoctorSignature user={user} />
              <LetterheadFooter letterhead={preview} />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
