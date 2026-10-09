// My settings, as a profile page: the photo (the camera button changes it; owner, 9 Oct 2026), name, email and where
// you work, in the middle at the top; then who you are (name, phone – the email is your login and stays as the
// administrator set it), your password (changed in a pop-up), your professional details (doctors and RMOs: printed on
// prescriptions) and how the website looks for you – theme, text size and spacing with a live preview, applied at once.
import { AlignJustify, BriefcaseMedical, Camera, Check, Clock, Eye, KeyRound, Palette, Pencil, Rows3, ShieldCheck, Trash2, Type, UserRound } from 'lucide-react';
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

// Appearance (owner, 9 Oct 2026): compact choices on the left – text size and spacing, each with its symbol (the theme is
// in the top bar) – and
// on the right a live preview of a screen as it will look. A choice applies at once and is saved in the background.
const SIZE_PX = { small: 13, standard: 16, large: 20 };
const DENSITY_ICON = { comfortable: Rows3, compact: AlignJustify };

function Choices({ label, icon: Icon, name, options, value, onChoose, render }) {
  return (
    <div className="look-group">
      <span className="look-group-label"><Icon size={15} aria-hidden /> {label}</span>
      <div className="look-choices" role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const on = value === o.key;
          return (
            <button key={o.key} type="button" role="radio" aria-checked={on} className={`look-choice${on ? ' on' : ''}`} onClick={() => onChoose(name, o.key)}>
              {render(o)}
              <span>{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// A small screen in the chosen look: the menu bar, a card with a dose row, a badge and a button – the real colours,
// text size and spacing, so the preview is exactly what the pages will look like. Sample words only.
function LookPreview() {
  return (
    <div className="look-preview" aria-hidden>
      <div className="lp-bar"><span className="lp-dot" /><span className="lp-line" /><span className="lp-line short" /></div>
      <div className="lp-body">
        <div className="lp-card">
          <div className="lp-head"><strong>Today's doses</strong><span className="badge badge-info small"><Clock size={12} /> Due</span></div>
          <table className="table lp-table">
            <tbody>
              <tr><td><strong>08:00</strong></td><td>Sample medicine</td><td className="muted">Bed G1</td></tr>
              <tr><td><strong>14:00</strong></td><td>Sample dressing</td><td className="muted">Bed G2</td></tr>
            </tbody>
          </table>
          <p className="muted lp-text">This is how text and rows will look.</p>
          <div className="lp-actions"><span className="btn btn-primary btn-sm">Chart</span><span className="btn btn-ghost btn-sm">Later</span></div>
        </div>
      </div>
    </div>
  );
}

function AppearanceCard() {
  const { appearance } = useAppConfig();
  const { user, updateUser } = useAuth();
  const prefs = {
    textSize: user.preferences?.textSize ?? appearance.textSize[0].key,
    density: user.preferences?.density ?? appearance.density[0].key,
    theme: user.preferences?.theme ?? appearance.theme[0].key,
  };
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
  const sizes = [...appearance.textSize].sort((x, y) => (SIZE_PX[x.key] ?? 16) - (SIZE_PX[y.key] ?? 16));

  return (
    <section className="card">
      <div className="card-head">
        <h2><Palette size={18} aria-hidden /> Appearance</h2>
        {state.saving ? <span className="muted small">Saving…</span> : <Saved when={state.saved} />}
      </div>
      <p className="muted small">Changes show at once and follow you on every computer. The theme (light or dark) is the sun / moon button in the top bar.</p>
      <Alert type="error">{state.error}</Alert>
      <div className="look-layout">
        <div className="look-controls">
          <Choices label="Text size" icon={Type} name="textSize" options={sizes} value={prefs.textSize} onChoose={choose} render={(o) => <span className="look-aa" style={{ fontSize: SIZE_PX[o.key] ?? 16 }} aria-hidden>Aa</span>} />
          <Choices label="Spacing" icon={Rows3} name="density" options={appearance.density} value={prefs.density} onChoose={choose} render={(o) => { const I = DENSITY_ICON[o.key] ?? Rows3; return <I size={18} aria-hidden />; }} />
        </div>
        <div className="look-preview-wrap">
          <span className="look-group-label"><Eye size={15} aria-hidden /> Preview</span>
          <LookPreview />
        </div>
      </div>
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

        <div className="span-all">
          <AppearanceCard />
        </div>
      </div>
      {changingPassword && <ChangePasswordDialog onClose={() => setChangingPassword(false)} />}
    </>
  );
}
