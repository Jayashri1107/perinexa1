// Hospital settings: one tab per section (Print letterhead, Patient messages, ABDM), each saved on its own.
import { useEffect, useState } from 'react';
import { Navigate, NavLink, useParams } from 'react-router-dom';
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
        title="Hospital settings"
        subtitle={settings?.settingsUpdatedAt ? `Last changed ${formatDateTime(settings.settingsUpdatedAt)} by ${settings.settingsUpdatedByName ?? 'an admin'}` : 'Settings of this hospital'}
      />
      <SectionTabs tabs={HOSPITAL_ADMIN_TABS} label="Hospital admin" />
      <nav className="tabs sub-tabs" aria-label="Settings sections">
        {HOSPITAL_SETTINGS_SECTIONS.map((s) => (
          <NavLink key={s.key} to={`/hospital/settings/${s.key}`} className="tab">{s.label}</NavLink>
        ))}
      </nav>
      <Alert type="error">{error}</Alert>
      {!settings && !error && <Loader />}
      {/* key: a fresh form when the tab changes */}
      {settings && <SectionForm key={section.key} section={section} settings={settings} onSaved={setSettings} />}
    </>
  );
}
