// My settings: password, professional details (doctors and RMOs) and appearance – for everyone, in both areas.
import { KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { accountApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { FormBuilder } from '../../components/form/FormBuilder.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { appearanceFields, appearanceValues, professionalFields, professionalValues } from '../../forms/accountForms.js';
import { useForm } from '../../hooks/useForm.js';
import { formatDateTime, toOptions } from '../../utils/format.js';

function SettingsCard({ title, description, fields, initial, save }) {
  const form = useForm(initial);
  const [saved, setSaved] = useState(false);
  const onSubmit = async (values) => {
    setSaved(false);
    await save(values);
    setSaved(true);
  };
  return (
    <section className="card">
      <h2>{title}</h2>
      {description && <p className="muted small">{description}</p>}
      <form onSubmit={form.submit(onSubmit)} noValidate onChange={() => setSaved(false)}>
        <FormBuilder fields={fields} form={form} />
        <div className="form-actions">
          {saved && <Alert type="success">Saved.</Alert>}
          <button type="submit" className="btn btn-primary" disabled={form.submitting}>{form.submitting ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </section>
  );
}

export function AccountPage() {
  const { appearance } = useAppConfig();
  const { user, updateUser } = useAuth();
  const [isPrescriber, setIsPrescriber] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    accountApi.get().then((r) => setIsPrescriber(r.isPrescriber)).catch((err) => setError(err.message));
  }, []);

  if (error) return <Alert type="error">{error}</Alert>;
  if (isPrescriber === null) return <Loader />;

  const saveProfessional = async (values) => updateUser((await accountApi.updateProfessional(values)).user);
  const saveAppearance = async (values) => updateUser((await accountApi.updateAppearance(values)).user);

  return (
    <>
      <PageHeader title="My settings" subtitle="Your own account. These follow you in every hospital." />
      <div className="grid-2">
        <section className="card">
          <h2>Account</h2>
          <dl className="details">
            <dt>Name</dt><dd>{user.name}</dd>
            <dt>Email</dt><dd>{user.email}</dd>
            <dt>Last login</dt><dd>{formatDateTime(user.lastLoginAt)}</dd>
          </dl>
          <Link to="/change-password" className="btn btn-ghost top-gap">
            <KeyRound size={16} aria-hidden /> Change password
          </Link>
        </section>

        <SettingsCard
          title="Appearance"
          description="How the website looks for you."
          fields={appearanceFields({ textSize: toOptions(appearance.textSize), density: toOptions(appearance.density) })}
          initial={appearanceValues(user, appearance)}
          save={saveAppearance}
        />

        {isPrescriber && (
          <SettingsCard
            title="Professional details"
            description="Printed on your prescriptions."
            fields={professionalFields}
            initial={professionalValues(user)}
            save={saveProfessional}
          />
        )}
      </div>
    </>
  );
}
