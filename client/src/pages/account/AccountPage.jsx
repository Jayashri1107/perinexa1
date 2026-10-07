// My settings, as a profile page: who you are (name, phone – the email is your login and stays as the administrator
// set it), where you work and as what, your password (changed in a pop-up), your professional details (doctors and
// RMOs: printed on prescriptions) and how the website looks for you – which changes at once, with no Save button.
import { Check, KeyRound, Pencil, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { accountApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { ChangePasswordDialog } from '../../components/ChangePasswordDialog.jsx';
import { FormBuilder } from '../../components/form/FormBuilder.jsx';
import { Loader } from '../../components/Loader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { professionalFields, professionalValues } from '../../forms/accountForms.js';
import { useForm } from '../../hooks/useForm.js';
import { formatDateTime, initialsOf } from '../../utils/format.js';

function Saved({ when }) {
  if (!when) return null;
  return <span className="saved-note" role="status"><Check size={14} aria-hidden /> Saved</span>;
}

// A card with a read view and a form, saved with its own button.
function EditCard({ title, description, fields, initial, save, view }) {
  const form = useForm(initial);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(null);
  const onSubmit = async (values) => {
    await save(values);
    setEditing(false);
    setSaved(Date.now());
  };
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        {!editing && (
          <span className="row-actions">
            <Saved when={saved} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { form.reset(initial); setEditing(true); setSaved(null); }}><Pencil size={14} aria-hidden /> Change</button>
          </span>
        )}
      </div>
      {description && <p className="muted small">{description}</p>}
      {editing ? (
        <form onSubmit={form.submit(onSubmit)} noValidate>
          <FormBuilder fields={fields} form={form} />
          <div className="modal-foot inline">
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={form.submitting}>{form.submitting ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      ) : (
        view
      )}
    </section>
  );
}

// Appearance: each choice applies at once and is saved in the background.
function AppearanceCard() {
  const { appearance } = useAppConfig();
  const { user, updateUser } = useAuth();
  const prefs = { textSize: user.preferences?.textSize ?? appearance.textSize[0].key, density: user.preferences?.density ?? appearance.density[0].key };
  const [state, setState] = useState({ saving: false, saved: null, error: '' });

  const choose = async (key, value) => {
    if (prefs[key] === value) return;
    const next = { ...prefs, [key]: value };
    // at once on screen …
    updateUser({ ...user, preferences: { ...user.preferences, ...next } });
    setState({ saving: true, saved: null, error: '' });
    try {
      // … and remembered on every computer
      updateUser((await accountApi.updateAppearance(next)).user);
      setState({ saving: false, saved: Date.now(), error: '' });
    } catch (err) {
      setState({ saving: false, saved: null, error: err.message });
    }
  };

  const groups = [
    { label: 'Text size', name: 'textSize', options: appearance.textSize },
    { label: 'Spacing', name: 'density', options: appearance.density },
  ];
  const sizeLabel = appearance.textSize.find((o) => o.key === prefs.textSize)?.label ?? prefs.textSize;

  return (
    <section className="card">
      <div className="card-head">
        <h2>Appearance</h2>
        {state.saving ? <span className="muted small">Saving…</span> : <Saved when={state.saved} />}
      </div>
      <p className="muted small">Changes show at once and follow you on every computer.</p>
      <Alert type="error">{state.error}</Alert>
      {groups.map((g) => (
        <div key={g.name} className="appearance-row">
          <span className="appearance-label">{g.label}</span>
          <div className="segmented" role="radiogroup" aria-label={g.label}>
            {g.options.map((o) => (
              <button key={o.key} type="button" role="radio" aria-checked={prefs[g.name] === o.key} className={prefs[g.name] === o.key ? 'on' : ''} onClick={() => choose(g.name, o.key)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="appearance-preview">This is how text looks at the “{sizeLabel}” size.</p>
    </section>
  );
}

export function AccountPage() {
  const { roleLabel } = useAppConfig();
  const { user, updateUser, memberships } = useAuth();
  const [isPrescriber, setIsPrescriber] = useState(null);
  const [error, setError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    accountApi.get().then((r) => setIsPrescriber(r.isPrescriber)).catch((err) => setError(err.message));
  }, []);

  if (error) return <Alert type="error">{error}</Alert>;
  if (isPrescriber === null) return <Loader />;

  const role = user.isSuperAdmin ? (user.isPrimary ? 'Main super admin' : 'Super admin') : null;

  return (
    <>
      <section className="card profile-hero">
        <span className="avatar avatar-xl" aria-hidden>{initialsOf(user.name)}</span>
        <div className="profile-hero-text">
          <h1>{user.name}</h1>
          <p className="muted">{user.email}{user.phone && ` · ${user.phone}`}</p>
          <div className="chips top-gap-sm">
            {role && <span className="pill pill-strong">{role}</span>}
            {!user.isSuperAdmin && memberships.map((m) => <span key={m.hospital.id} className="pill">{m.hospital.name}: {m.roles.map(roleLabel).join(', ')}</span>)}
          </div>
        </div>
      </section>

      <div className="grid-2 top-gap">
        <EditCard
          title="Profile"
          description="Your name as others see it. Your email is your login; the administrator changes it."
          fields={[
            { name: 'name', label: 'Full name', required: true },
            { name: 'phone', label: 'Phone', type: 'tel' },
          ]}
          initial={{ name: user.name, phone: user.phone ?? '' }}
          save={async (values) => updateUser((await accountApi.updateProfile(values)).user)}
          view={
            <dl className="details wide">
              <dt>Full name</dt><dd>{user.name}</dd>
              <dt>Email</dt><dd>{user.email}</dd>
              <dt>Phone</dt><dd>{user.phone || '—'}</dd>
            </dl>
          }
        />

        <section className="card">
          <h2><ShieldCheck size={18} aria-hidden /> Sign-in and security</h2>
          <dl className="details wide">
            <dt>Last login</dt><dd>{formatDateTime(user.lastLoginAt)}</dd>
            <dt>Password</dt><dd>Changing it signs you out everywhere else.</dd>
          </dl>
          <button type="button" className="btn btn-ghost top-gap" onClick={() => setChangingPassword(true)}>
            <KeyRound size={16} aria-hidden /> Change password
          </button>
        </section>

        <AppearanceCard />

        {isPrescriber && (
          <EditCard
            title="Professional details"
            description="Printed on your prescriptions."
            fields={professionalFields}
            initial={professionalValues(user)}
            save={async (values) => updateUser((await accountApi.updateProfessional(values)).user)}
            view={
              <dl className="details wide">
                <dt>Qualification</dt><dd>{user.professional?.qualification || '—'}</dd>
                <dt>Registration no.</dt><dd>{user.professional?.registrationNumber || '—'}</dd>
                <dt>Council</dt><dd>{user.professional?.council || '—'}</dd>
              </dl>
            }
          />
        )}
      </div>
      {changingPassword && <ChangePasswordDialog onClose={() => setChangingPassword(false)} />}
    </>
  );
}
