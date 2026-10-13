import { useRef, useState } from 'react';
import { Accessibility, Building2, Camera, Eye, EyeOff, Info, KeyRound, LockKeyhole, LogOut, Mail, Palette, Pencil, Phone, Trash2, User, UserRound } from 'lucide-react';
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
  { key: 'profile', label: 'Profile', icon: User },
  { key: 'security', label: 'Security', icon: LockKeyhole },
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'accessibility', label: 'Accessibility', icon: Accessibility },
];

// My profile (owner, 13 Oct 2026): a card with the person's photo, name, role, hospital, email and phone, and their
// staff number, department, join date and status; then tabs – Profile (personal details, password, account, log out
// everywhere), Security, Appearance and Accessibility. Prescription design and Voice words stay pages of their own
// for those who use them (links at the end of the tabs). The photo is only ever shown to the person themself.
export function AccountPage() {
  const { user, memberships, activeMembership, platform } = useAuth();
  const [tab, setTab] = useState('profile');
  const [editing, setEditing] = useState(false);
  const role = PLATFORM_ROLE[platform?.role] ?? (activeMembership ? rolesLabel(activeMembership.roles) : '');
  const extraTabs = accountTabs(memberships).filter((t) => t.to !== '/account');
  const startEdit = () => {
    setTab('profile');
    setEditing(true);
  };

  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'My settings' }]} title="My profile" subtitle="Manage your account, security and application preferences." />
      <div className="pf-content prof-page">
        <ProfileHero role={role} onEdit={startEdit} />

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

        {tab === 'profile' && (
          <>
            <PersonalInfo role={role} editing={editing} setEditing={setEditing} />
            {isPrescriber(memberships) && <ProfessionalDetailsSection />}
            <PasswordCard />
            <AccountRow />
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

/** The card at the top: photo (with a camera button to change it), name, role, hospital, email, phone; staff facts. */
function ProfileHero({ role, onEdit }) {
  const { user, setUser, activeMembership } = useAuth();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const savePhoto = async (photo) => {
    setBusy(true);
    setError(null);
    try {
      const data = await api('/auth/me/photo', { method: 'PUT', body: { photo } });
      setUser(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const choose = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await savePhoto(await squarePhoto(file));
    } catch (err) {
      setError(err.message);
    }
  };
  const status = user.isActive === false ? 'Inactive' : 'Active';

  return (
    <section className="card prof-hero" aria-label="Your profile">
      <div className="prof-photo">
        <Avatar name={user.name} seed={user.email} photo={user.photo} />
        <button type="button" className="prof-camera" onClick={() => input.current?.click()} disabled={busy} aria-label={user.photo ? 'Change your photo' : 'Add a photo'} title={user.photo ? 'Change your photo' : 'Add a photo'}>
          <Camera aria-hidden="true" />
        </button>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={choose} tabIndex={-1} aria-hidden="true" />
      </div>
      <div className="prof-who">
        <h2 className="prof-name">
          {user.name}
          <button type="button" className="icon-btn prof-name-edit" onClick={onEdit} aria-label="Edit your details" title="Edit your details">
            <Pencil aria-hidden="true" />
          </button>
        </h2>
        {role && <span className="pill pill-brand prof-role">{role}</span>}
        <ul className="prof-lines">
          {activeMembership && (
            <li>
              <Building2 aria-hidden="true" /> {activeMembership.tenantName}
            </li>
          )}
          <li>
            <Mail aria-hidden="true" /> {user.email}
          </li>
          {user.phone && (
            <li>
              <Phone aria-hidden="true" /> {user.phone}
            </li>
          )}
        </ul>
        {user.photo && (
          <button type="button" className="btn btn-link btn-sm prof-remove" onClick={() => savePhoto(null)} disabled={busy}>
            <Trash2 aria-hidden="true" /> Remove photo
          </button>
        )}
        <Alert type="error">{error}</Alert>
      </div>
      <dl className="prof-facts">
        <div>
          <dt>Employee ID</dt>
          <dd>{user.employeeId || '—'}</dd>
        </div>
        <div>
          <dt>Department</dt>
          <dd>{activeMembership ? departmentOf(activeMembership.roles) || '—' : 'Platform'}</dd>
        </div>
        <div>
          <dt>Join date</dt>
          <dd>{formatDate(activeMembership?.joinedAt ?? user.createdAt) || '—'}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`prof-status ${status === 'Active' ? 'is-on' : ''}`}>{status}</span>
          </dd>
        </div>
      </dl>
      <button type="button" className="btn btn-secondary prof-edit" onClick={onEdit}>
        <Pencil aria-hidden="true" /> Edit profile
      </button>
    </section>
  );
}

/** Personal information: shown as boxes; Edit turns name, phone and staff number into fields (email: super admin). */
function PersonalInfo({ role, editing, setEditing }) {
  const { user, setUser, activeMembership } = useAuth();
  const [form, setForm] = useState({ name: user.name, phone: user.phone ?? '', employeeId: user.employeeId ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [saved, setSaved] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const open = () => {
    setForm({ name: user.name, phone: user.phone ?? '', employeeId: user.employeeId ?? '' });
    setSaved(null);
    setEditing(true);
  };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const data = await api('/auth/me/details', { method: 'PUT', body: { name: form.name.trim(), phone: form.phone.trim(), employeeId: form.employeeId.trim() } });
      setUser(data.user);
      setEditing(false);
      setSaved('Your details are saved.');
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  };
  const box = (label, value) => (
    <div className="prof-box">
      <span>{label}</span>
      <strong>{value || '—'}</strong>
    </div>
  );

  return (
    <section className="card prof-card" aria-labelledby="prof-personal">
      <CardHead id="prof-personal" icon={UserRound} title="Personal information" text="Update your basic details.">
        {!editing && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={open}>
            <Pencil aria-hidden="true" /> Edit
          </button>
        )}
      </CardHead>
      <Alert type="success" onClose={() => setSaved(null)}>
        {saved}
      </Alert>
      {!editing ? (
        <div className="prof-grid">
          {box('Full name', user.name)}
          {box('Email address', user.email)}
          {box('Phone number', user.phone)}
          {box('Role', role)}
          {box('Hospital', activeMembership?.tenantName ?? '')}
          {box('Employee ID', user.employeeId)}
        </div>
      ) : (
        <form onSubmit={save} noValidate>
          <Alert type="error">{error}</Alert>
          <div className="prof-grid">
            <Field label="Full name" id="prof-name" error={fields.name}>
              <input id="prof-name" value={form.name} onChange={set('name')} maxLength={100} autoFocus />
            </Field>
            <Field label="Email address" id="prof-email" hint="Your login – the super admin changes it." keepHint>
              <input id="prof-email" value={user.email} readOnly />
            </Field>
            <Field label="Phone number" id="prof-phone" error={fields.phone}>
              <input id="prof-phone" type="tel" value={form.phone} onChange={set('phone')} maxLength={30} />
            </Field>
            <Field label="Employee ID" id="prof-emp" error={fields.employeeId}>
              <input id="prof-emp" value={form.employeeId} onChange={set('employeeId')} maxLength={30} />
            </Field>
          </div>
          <div className="acc-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save details'}
            </button>
            <button type="button" className="btn btn-link" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
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
        {box('currentPassword', 'Current password', 'current-password', 'At least 12 characters, with at least one letter and one number.')}
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
