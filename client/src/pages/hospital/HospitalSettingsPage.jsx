// Hospital settings: one tab per section (Print letterhead, Patient messages, ABDM), each saved on its own. Print
// letterhead also holds the hospital's logo for printed papers (owner, 9 Oct 2026).
import { ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../../api/http.js';
import { toast } from '../../components/Toast.jsx';
import { shrinkLogo } from '../../utils/shrinkPhoto.js';
import { Navigate, useParams } from 'react-router-dom';
import { hospitalSettingsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { FormBuilder } from '../../components/form/FormBuilder.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { SectionTabs } from '../../components/SectionTabs.jsx';
import { HOSPITAL_ADMIN_TABS } from '../../config/navigation.js';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { HOSPITAL_SETTINGS_SECTIONS, sectionValues } from '../../forms/hospitalSettingsForms.js';
import { useForm } from '../../hooks/useForm.js';
import { formatDateTime, toOptions } from '../../utils/format.js';

function SectionForm({ section, settings, onSaved }) {
  const { languages } = useAppConfig();
  const form = useForm(sectionValues(settings, section));
  const [saved, setSaved] = useState(false);

  const onSubmit = async (values) => {
    setSaved(false);
    const result = await hospitalSettingsApi.update(section.key, values);
    onSaved(result.settings);
    setSaved(true);
  };

  return (
    <section className="card">
      <p className="muted">{section.description}</p>
      <form onSubmit={form.submit(onSubmit)} noValidate onChange={() => setSaved(false)}>
        <FormBuilder fields={section.fields({ languages: toOptions(languages) })} form={form} />
        <div className="form-actions">
          {saved && <Alert type="success">Saved.</Alert>}
          <button type="submit" className="btn btn-primary" disabled={form.submitting}>
            {form.submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </section>
  );
}

// The logo printed on discharge cards, bills, receipts and prescriptions: upload, see it, remove it.
function LogoCard({ logoVersion, onChanged }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action, message) => {
    setBusy(true);
    setError('');
    try {
      const r = await action();
      onChanged(r.logoVersion);
      toast(message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const pick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) run(async () => hospitalSettingsApi.setLogo(await shrinkLogo(file)), 'Logo saved – it is on every printed paper now');
  };
  return (
    <section className="card logo-card">
      <div className="logo-preview">
        {logoVersion > 0 ? <img src={apiUrl(`/hospital/logo?v=${logoVersion}`)} alt="The hospital's logo" /> : <span className="muted small">No logo yet</span>}
      </div>
      <div>
        <h2>Logo on printed papers</h2>
        <p className="muted small">Printed at the top left of discharge cards, bills, receipts and prescriptions. A PNG with a transparent background looks best; it is made smaller before it is saved.</p>
        {error && <p className="field-error">{error}</p>}
        <div className="row-actions logo-actions">
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => input.current?.click()}><ImagePlus size={14} aria-hidden /> {busy ? 'Saving…' : logoVersion > 0 ? 'Change logo' : 'Upload logo'}</button>
          {logoVersion > 0 && <button type="button" className="btn btn-link btn-sm btn-danger-text" disabled={busy} onClick={() => window.confirm('Remove the logo from printed papers?') && run(() => hospitalSettingsApi.removeLogo(), 'Logo removed')}><Trash2 size={14} aria-hidden /> Remove</button>}
        </div>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pick} />
      </div>
    </section>
  );
}

export function HospitalSettingsPage() {
  const { section: key } = useParams();
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    hospitalSettingsApi.get().then((r) => setSettings(r.settings)).catch((err) => setError(err.message));
  }, []);

  const section = HOSPITAL_SETTINGS_SECTIONS.find((s) => s.key === key);
  if (!section) return <Navigate to={`/hospital/settings/${HOSPITAL_SETTINGS_SECTIONS[0].key}`} replace />;

  return (
    <>
      <PageHeader
        title={section.label}
        subtitle={settings?.settingsUpdatedAt ? `Last changed ${formatDateTime(settings.settingsUpdatedAt)} by ${settings.settingsUpdatedByName ?? 'an admin'}` : 'Settings of this hospital'}
      />
      {/* each settings section is one of the Hospital admin tabs (as in Perinexa) */}
      <SectionTabs tabs={HOSPITAL_ADMIN_TABS} label="Hospital admin" />
      <Alert type="error">{error}</Alert>
      {!settings && !error && <Loader />}
      {settings && section.key === 'letterhead' && <LogoCard logoVersion={settings.logoVersion ?? 0} onChanged={(v) => setSettings((s) => ({ ...s, logoVersion: v, letterhead: { ...s.letterhead, logoVersion: v } }))} />}
      {/* key: a fresh form when the tab changes */}
      {settings && <SectionForm key={section.key} section={section} settings={settings} onSaved={setSettings} />}
    </>
  );
}
