import { useRef, useState } from 'react';
import { Accessibility, Camera, Eye, EyeOff, Info, KeyRound, LockKeyhole, LogOut, Palette, Pencil, Trash2, User } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Alert, Avatar, ConfirmDialog, Field, formatDate, formatDateTime, rolesLabel } from '../components/ui.jsx';
import { accountTabs, isPrescriber } from '../platform/modules.js';
import { AppearanceSection } from './AppearancePage.jsx';
import { ProfessionalDetailsSection } from './ProfessionalDetailsPage.jsx';
import { departmentOf, deviceLabel, squarePhoto } from './profileFormat.js';

const PLATFORM_ROLE = { superadmin: 'Super admin', platformadmin: 'Platform admin' };
const TABS = [
  { key: 'account', label: 'Account', icon: User },
  { key: 'security', label: 'Security', icon: LockKeyhole },
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'accessibility', label: 'Accessibility', icon: Accessibility },
];
const MAX_PHOTO_BYTES = 800 * 1024;

// My profile (owner, 13 Oct 2026), laid out like the Materio account settings: tabs as an underline – Account (photo
// with Upload new photo / Reset, then the details in two columns with Save changes / Reset), Security (password,
// account information, log out everywhere), Appearance and Accessibility. Prescription design and Voice words stay
// pages of their own (links after the tabs). The photo is only ever shown to the person themself.
export function AccountPage() {
  const { memberships } = useAuth();
  const [tab, setTab] = useState('account');
  const extraTabs = accountTabs(memberships).filter((t) => t.to !== '/account');

  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'My settings' }]} title="My profile" subtitle="Manage your account, security and application preferences." />
      <div className="pf-content prof-page">
        <nav className="prof-tabs" aria-label="Profile sections">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" className={tab === key ? 'active' : ''} aria-pressed={tab === key} onClick={() => setTab(key)}>
              <Icon aria-hidden="true" /> {label}
            </button>
          ))}
          {extraTabs.map((t) => (
            <NavLink key={t.to} to={t.to}>
              {t.label}
            </NavLink>
          ))}
        </nav>

        {tab === 'account' && (
          <>
            <AccountCard />
            {isPrescriber(memberships) && <ProfessionalDetailsSection />}
          </>
        )}
        {tab === 'security' && (
          <>
            <PasswordCard />
            <AccountRow />
          </>
        )}
        {tab === 'appearance' && <AppearanceSection part="appearance" />}
        {tab === 'accessibility' && <AppearanceSection part="accessibility" />}
      </div>
    </>
  );
}

/**
 * The Account tab: the photo (Upload new photo, Reset = remove it), then the person's details as outlined fields in two
 * columns. Name, phone and Employee ID can be changed here; email (the login – the super admin changes it), role,
 * hospital, department and join date are shown as they are.
 */
function AccountCard() {
  const { user, setUser, activeMembership, platform } = useAuth();
  const input = useRef(null);
  const initial = () => ({ name: user.name, phone: user.phone ?? '', employeeId: user.employeeId ?? '' });
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(null); // 'photo' | 'save'
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [saved, setSaved] = useState(null);
  const role = PLATFORM_ROLE[platform?.role] ?? (activeMembership ? rolesLabel(activeMembership.roles) : '');
  const changed = form.name !== user.name || form.phone !== (user.phone ?? '') || form.employeeId !== (user.employeeId ?? '');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const savePhoto = async (photo) => {
    setBusy('photo');
    setError(null);
    setSaved(null);
    try {
      const data = await api('/auth/me/photo', { method: 'PUT', body: { photo } });
      setUser(data.user);
      setSaved(photo ? 'Your photo is saved.' : 'Your photo is removed.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  const choose = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      setError('The picture is larger than 800 KB. Choose a smaller one.');
      return;
    }
    try {
      await savePhoto(await squarePhoto(file));
    } catch (err) {
      setError(err.message);
    }
  };
  const save = async (e) => {
    e.preventDefault();
    setBusy('save');
    setError(null);
    setSaved(null);
    setFields({});
    try {
      const data = await api('/auth/me/details', { method: 'PUT', body: { name: form.name.trim(), phone: form.phone.trim(), employeeId: form.employeeId.trim() } });
      setUser(data.user);
      setForm({ name: data.user.name, phone: data.user.phone ?? '', employeeId: data.user.employeeId ?? '' });
      setSaved('Your details are saved.');
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card prof-account" aria-label="Your account">
      {/* The photo in the middle (owner, 13 Oct 2026): the camera on the circle changes it; the name and role under it */}
      <div className="prof-hero">
        <div className="prof-hero-photo">
          <Avatar name={user.name} seed={user.email} photo={user.photo} />
          <button
            type="button"
            className="prof-camera"
            onClick={() => input.current?.click()}
            disabled={Boolean(busy)}
            aria-label={user.photo ? 'Change your photo' : 'Add a photo'}
            title={user.photo ? 'Change your photo' : 'Add a photo'}
          >
            <Camera aria-hidden="true" />
          </button>
        </div>
        <p className="prof-hero-name">{user.name}</p>
        {role && <p className="prof-hero-role">{role}</p>}
        <p className="hint">{busy === 'photo' ? 'Saving the photo…' : 'JPG, PNG or WebP, up to 800 KB. Only you see your photo.'}</p>
        {user.photo && (
          <button type="button" className="btn btn-link btn-sm" onClick={() => savePhoto(null)} disabled={Boolean(busy)}>
            Remove photo
          </button>
        )}
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={choose} tabIndex={-1} aria-hidden="true" />
      </div>

      <form onSubmit={save} noValidate>
        <Alert type="success" onClose={() => setSaved(null)}>
          {saved}
        </Alert>
        <Alert type="error">{error}</Alert>
        <div className="prof-form-grid">
          <Field label="Full name" id="prof-name" error={fields.name}>
            <input id="prof-name" value={form.name} onChange={set('name')} maxLength={100} autoComplete="name" />
          </Field>
          <Field label="Email" id="prof-email" hint="Your login – the super admin changes it." keepHint>
            <input id="prof-email" value={user.email} readOnly />
          </Field>
          <Field label="Phone number" id="prof-phone" error={fields.phone}>
            <input id="prof-phone" type="tel" value={form.phone} onChange={set('phone')} maxLength={30} autoComplete="tel" />
          </Field>
          <Field label="Employee ID" id="prof-emp" error={fields.employeeId}>
            <input id="prof-emp" value={form.employeeId} onChange={set('employeeId')} maxLength={30} />
          </Field>
          <Field label="Role" id="prof-role">
            <input id="prof-role" value={role} readOnly />
          </Field>
          <Field label="Hospital" id="prof-hospital">
            <input id="prof-hospital" value={activeMembership?.tenantName ?? (platform ? 'All hospitals (platform)' : '')} readOnly />
          </Field>
          <Field label="Department" id="prof-dept">
            <input id="prof-dept" value={activeMembership ? departmentOf(activeMembership.roles) : 'Platform'} readOnly />
          </Field>
          <Field label="Join date" id="prof-joined">
            <input id="prof-joined" value={formatDate(activeMembership?.joinedAt ?? user.createdAt) || ''} readOnly />
          </Field>
        </div>
        <div className="prof-form-actions">
          <button type="submit" className="btn btn-primary" disabled={!changed || Boolean(busy)}>
            {busy === 'save' ? 'Saving…' : 'Save changes'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setForm(initial())} disabled={!changed || Boolean(busy)}>
            Reset
          </button>
        </div>
      </form>
    </section>
  );
}

/** Change password: the three boxes in one row, each with a show/hide eye. */
function PasswordCard() {
  const { setUser } = useAuth();
  const empty = { currentPassword: '', newPassword: '', confirmPassword: '' };
  const [form, setForm] = useState(empty);
  const [show, setShow] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [done, setDone] = useState(null);
  const ready = form.currentPassword && form.newPassword && form.confirmPassword;
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    setFields({});
    if (form.newPassword !== form.confirmPassword) {
      setFields({ confirmPassword: "The new passwords don't match – type the same password in both boxes." });
      return;
    }
    setBusy(true);
    try {
      const data = await api('/auth/change-password', { method: 'POST', body: { currentPassword: form.currentPassword, newPassword: form.newPassword } });
      setUser(data.user);
      setForm(empty);
      setDone('Your password has been changed. Other computers where you were logged in are logged out.');
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  };
  const box = (key, label, autoComplete, hint) => (
    <Field label={label} id={`pw-${key}`} error={fields[key]} hint={hint} keepHint={Boolean(hint)}>
      <span className="prof-pw">
        <input id={`pw-${key}`} type={show[key] ? 'text' : 'password'} autoComplete={autoComplete} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
        <button type="button" className="prof-eye" onClick={() => setShow({ ...show, [key]: !show[key] })} aria-label={show[key] ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}>
          {show[key] ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </span>
    </Field>
  );
  return (
    <form className="card prof-card" onSubmit={submit} noValidate aria-labelledby="prof-password">
      <CardHead id="prof-password" icon={KeyRound} title="Change password" text="Keep your account safe with a strong password.">
        <button type="submit" className="btn btn-secondary btn-sm" disabled={!ready || busy}>
          <Pencil aria-hidden="true" /> {busy ? 'Saving…' : 'Change password'}
        </button>
      </CardHead>
      <Alert type="success" onClose={() => setDone(null)}>
        {done}
      </Alert>
      <Alert type="error">{error}</Alert>
      <div className="prof-grid">
        {box('currentPassword', 'Current password', 'current-password', 'At least 8 characters, with at least one letter and one number.')}
        {box('newPassword', 'New password', 'new-password')}
        {box('confirmPassword', 'Confirm new password', 'new-password')}
      </div>
    </form>
  );
}

/** Account information (last sign-in, created, this computer) and the danger zone (log out everywhere). */
function AccountRow() {
  const { user, logout } = useAuth();
  const [asking, setAsking] = useState(false);
  return (
    <div className="prof-row">
      <section className="card prof-card" aria-labelledby="prof-account">
        <CardHead id="prof-account" icon={Info} title="Account information" text="Details about your account." />
        <dl className="prof-meta">
          <div>
            <dt>Last login</dt>
            <dd>{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : '—'}</dd>
          </div>
          <div>
            <dt>Account created</dt>
            <dd>{user.createdAt ? formatDate(user.createdAt) : '—'}</dd>
          </div>
          <div>
            <dt>This device</dt>
            <dd>{deviceLabel(typeof navigator === 'undefined' ? '' : navigator.userAgent)}</dd>
          </div>
        </dl>
      </section>
      <section className="card prof-card prof-danger" aria-labelledby="prof-danger">
        <CardHead id="prof-danger" icon={Trash2} title="Danger zone" text="These actions affect your account." danger />
        <button type="button" className="btn btn-secondary btn-sm prof-danger-btn" onClick={() => setAsking(true)}>
          <LogOut aria-hidden="true" /> Log out from all devices
        </button>
      </section>
      {asking && (
        <ConfirmDialog id="prof-logout-all" title="Log out from all devices?" confirmLabel="Log out everywhere" danger onConfirm={() => logout('manual')} onCancel={() => setAsking(false)}>
          <p>You will be logged out here and on every other computer or phone where you are logged in. You can log in again with your password.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function CardHead({ id, icon: Icon, title, text, danger = false, children = null }) {
  return (
    <header className="prof-card-head">
      <span className={`prof-card-icon ${danger ? 'is-danger' : ''}`} aria-hidden="true">
        <Icon />
      </span>
      <div>
        <h2 id={id}>{title}</h2>
        <p className="muted">{text}</p>
      </div>
      {children && <div className="prof-card-action">{children}</div>}
    </header>
  );
}
