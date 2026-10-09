// My settings, as a profile page: the photo (the camera button changes it; owner, 9 Oct 2026), name, email and where
// you work, in the middle at the top; then who you are (name, phone – the email is your login and stays as the
// administrator set it), your password (changed in a pop-up), your professional details (doctors and RMOs: printed on
// prescriptions) and how the website looks for you – chosen from picture tiles, applied at once, with no Save button.
import { AlignJustify, BriefcaseMedical, Camera, Check, KeyRound, Palette, Pencil, Rows3, ShieldCheck, Trash2, Type, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { accountApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Avatar } from '../../components/Avatar.jsx';
import { ChangePasswordDialog } from '../../components/ChangePasswordDialog.jsx';
import { FormBuilder } from '../../components/form/FormBuilder.jsx';
import { Loader } from '../../components/Loader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { professionalFields, professionalValues } from '../../forms/accountForms.js';
import { useForm } from '../../hooks/useForm.js';
import { formatDateTime } from '../../utils/format.js';
import { shrinkPhoto } from '../../utils/shrinkPhoto.js';

function Saved({ when }) {
  if (!when) return null;
  return <span className="saved-note" role="status"><Check size={14} aria-hidden /> Saved</span>;
}

// A card with a read view and a form, saved with its own button.
function EditCard({ icon: Icon, title, description, fields, initial, save, view }) {
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
        <h2>{Icon && <Icon size={18} aria-hidden />} {title}</h2>
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

// Appearance: each choice is a tile with a picture of what it does – "Aa" at its size, rows apart or close together.
// It applies at once and is saved in the background.
const SIZE_PX = { small: 15, standard: 19, large: 24 };
const DENSITY_ICON = { comfortable: Rows3, compact: AlignJustify };
const DENSITY_HINT = { comfortable: 'More room between rows', compact: 'More rows on the screen' };

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

  const sizeLabel = appearance.textSize.find((o) => o.key === prefs.textSize)?.label ?? prefs.textSize;
  const sizes = [...appearance.textSize].sort((x, y) => (SIZE_PX[x.key] ?? 19) - (SIZE_PX[y.key] ?? 19));

  return (
    <section className="card">
      <div className="card-head">
        <h2><Palette size={18} aria-hidden /> Appearance</h2>
        {state.saving ? <span className="muted small">Saving…</span> : <Saved when={state.saved} />}
      </div>
      <p className="muted small">Changes show at once and follow you on every computer.</p>
      <Alert type="error">{state.error}</Alert>

      <h3 className="appearance-label"><Type size={16} aria-hidden /> Text size</h3>
      <div className="look-tiles" role="radiogroup" aria-label="Text size">
        {sizes.map((o) => {
          const on = prefs.textSize === o.key;
          return (
            <button key={o.key} type="button" role="radio" aria-checked={on} className={`look-tile${on ? ' on' : ''}`} onClick={() => choose('textSize', o.key)}>
              <span className="look-sample" style={{ fontSize: SIZE_PX[o.key] ?? 19 }} aria-hidden>Aa</span>
              <span className="look-name">{o.label}</span>
              {on && <Check size={14} className="look-check" aria-hidden />}
            </button>
          );
        })}
      </div>

      <h3 className="appearance-label top-gap"><Rows3 size={16} aria-hidden /> Spacing</h3>
      <div className="look-tiles" role="radiogroup" aria-label="Spacing">
        {appearance.density.map((o) => {
          const on = prefs.density === o.key;
          const Icon = DENSITY_ICON[o.key] ?? Rows3;
          return (
            <button key={o.key} type="button" role="radio" aria-checked={on} className={`look-tile${on ? ' on' : ''}`} onClick={() => choose('density', o.key)}>
              <Icon size={26} className="look-sample" aria-hidden />
              <span className="look-name">{o.label}</span>
              {DENSITY_HINT[o.key] && <span className="look-hint">{DENSITY_HINT[o.key]}</span>}
              {on && <Check size={14} className="look-check" aria-hidden />}
            </button>
          );
        })}
      </div>
      <p className="appearance-preview">This is how text looks at the “{sizeLabel}” size.</p>
    </section>
  );
}

// The photo in the middle at the top, with a camera button to change it (and Remove photo when there is one).
function PhotoHero({ user, updateUser, children }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action) => {
    setBusy(true);
    setError('');
    try {
      updateUser((await action()).user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const pick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) run(async () => accountApi.setPhoto(await shrinkPhoto(file)));
  };
  const remove = () => {
    if (window.confirm('Remove your photo? Your initials are shown instead.')) run(() => accountApi.removePhoto());
  };
  const label = user.photoVersion ? 'Change your photo' : 'Add a photo';
  return (
    <section className="card profile-hero">
      <div className={`photo-wrap${busy ? ' busy' : ''}`}>
        <Avatar user={user} className="avatar-xl" />
        <button type="button" className="photo-camera" onClick={() => input.current?.click()} disabled={busy} aria-label={label} title={label}>
          <Camera size={18} aria-hidden />
        </button>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pick} />
      </div>
      {busy && <p className="muted small">Saving the photo…</p>}
      {error && <p className="field-error">{error}</p>}
      {user.photoVersion > 0 && !busy && (
        <button type="button" className="btn btn-link btn-sm btn-danger-text" onClick={remove}><Trash2 size={14} aria-hidden /> Remove photo</button>
      )}
      {children}
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
      <PhotoHero user={user} updateUser={updateUser}>
        <div className="profile-hero-text">
          <h1>{user.name}</h1>
          <p className="muted">{user.email}{user.phone && ` · ${user.phone}`}</p>
          <div className="chips profile-chips">
            {role && <span className="pill pill-strong">{role}</span>}
            {!user.isSuperAdmin && memberships.map((m) => <span key={m.hospital.id} className="pill pill-strong">{m.hospital.name} · {m.roles.map(roleLabel).join(', ')}</span>)}
          </div>
        </div>
      </PhotoHero>

      <div className="grid-2 top-gap settings-grid">
        <EditCard
          icon={UserRound}
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

        {isPrescriber && (
          <EditCard
            icon={BriefcaseMedical}
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

        <div className={isPrescriber ? '' : 'span-all'}>
          <AppearanceCard />
        </div>
      </div>
      {changingPassword && <ChangePasswordDialog onClose={() => setChangingPassword(false)} />}
    </>
  );
}
