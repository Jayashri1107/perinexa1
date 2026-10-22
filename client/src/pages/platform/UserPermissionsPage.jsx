import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PLATFORM_AREA_LABELS, canEditArea, platformTabs } from '../../platform/modules.js';

// User permissions (owner's request, 12 Oct 2026): every platform admin and what each may change – the super admin
// ticks and unticks, and makes someone a platform admin or takes it away. Platform admins can look. A platform admin
// always sees every platform page (never patient records); a ticked area is what they may change. Laid out like Admin
// permissions (22 Oct 2026): each person's permissions as tick chips that wrap – no table to scroll sideways – and
// Save appears once something changed.
const AREA_HELP = {
  hospitals: 'Create hospitals, rename them, deactivate and reactivate them',
  users: 'Create accounts, add people to hospitals, change their roles, deactivate them, reset passwords',
  hospitalAdmins: "The same for a hospital's admins (adding, changing or removing a hospital admin)",
  hospitalSetup: "A hospital's setup: letterhead, patient messages, OPD timings, ABDM",
};
const AREAS = Object.keys(PLATFORM_AREA_LABELS);

export function UserPermissionsPage() {
  const { platform } = useAuth();
  const editable = platform?.role === 'superadmin';
  const { data, error, loading, reload } = useFetch('/platform/users', { type: 'platformadmin', limit: 100, sort: 'name' });
  const [flash, setFlash] = useState(null);
  const saved = (message) => {
    setFlash(message);
    reload();
  };
  const people = data?.users ?? [];
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Users & access', to: '/platform/users' }, { label: 'User permissions' }]}
        title="User permissions"
        subtitle="Platform admins help you run Perinexa. They see every hospital and account – never patient records – and change only what you tick."
        tabs={platformTabs('users', platform)}
      />
      <div className="pf-content ap-page">
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        <Alert type="error">{error}</Alert>
        {!editable && <Alert type="info">Only a super admin changes permissions. You can look.</Alert>}
        <details className="card ap-help">
          <summary>What each permission allows</summary>
          <dl className="details">
            {AREAS.map((a) => (
              <div key={a}>
                <dt>{PLATFORM_AREA_LABELS[a]}</dt>
                <dd>{AREA_HELP[a]}</dd>
              </div>
            ))}
            <div>
              <dt>Super admin</dt>
              <dd>Everything above, and giving or removing these permissions. Never patient records.</dd>
            </div>
          </dl>
          <p className="hint">
            What each hospital&rsquo;s own admin may do to its staff is on <Link to="/platform/users/admin-permissions">Admin permissions</Link>.
          </p>
        </details>
        <section className="card" aria-labelledby="pa-title">
          <div className="ap-hospital-head">
            <h2 id="pa-title">Platform admins</h2>
            <span className="cell-sub">{data ? `${people.length} ${people.length === 1 ? 'person' : 'people'}` : ''}</span>
          </div>
          {loading && !data && <p className="hint">Loading…</p>}
          {data && people.length === 0 && <p className="hint">No platform admins yet. Add one below.</p>}
          <ul className="ap-admins">
            {people.map((p) => (
              <PlatformAdminRow key={`${p.id}:${(p.platformPermissions ?? []).join()}`} person={p} editable={editable} onSaved={saved} />
            ))}
          </ul>
        </section>
        {editable && <AddPlatformAdmin onSaved={saved} />}
      </div>
    </>
  );
}

/** One platform admin: who they are, their permissions as tick chips, Save and Undo once something changed. */
function PlatformAdminRow({ person, editable, onSaved }) {
  const start = person.platformPermissions ?? [];
  const [areas, setAreas] = useState(start);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const changed = [...areas].sort().join() !== [...start].sort().join();
  const toggle = (a) => setAreas((list) => (list.includes(a) ? list.filter((x) => x !== a) : AREAS.filter((x) => x === a || list.includes(x))));
  const save = async (isPlatformAdmin) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/platform/users/${person.id}/platform-admin`, { method: 'PATCH', body: { isPlatformAdmin, permissions: isPlatformAdmin ? areas : [] } });
      onSaved(isPlatformAdmin ? `Permissions of ${person.name} saved.` : `${person.name} is no longer a platform admin.`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <li className="ap-admin">
      <div className="ap-who-row">
        <div className="ap-who">
          <div className="ap-name">
            <Link to={`/platform/users/${person.id}`}>{person.name}</Link>
            {!person.isActive && <StatusPill tone="inactive">Deactivated</StatusPill>}
            {areas.length === 0 && <span className="pill">View only</span>}
          </div>
          <div className="cell-sub">{person.email}</div>
        </div>
        {editable &&
          (confirming ? (
            <span className="ap-actions">
              <span className="cell-sub">Remove {person.name} as platform admin?</span>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => save(false)}>
                Remove
              </button>
              <button type="button" className="btn btn-link btn-sm" disabled={busy} onClick={() => setConfirming(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button type="button" className="btn btn-link btn-sm" disabled={busy} onClick={() => setConfirming(true)}>
              Remove platform admin
            </button>
          ))}
      </div>
      <div className="role-picker ap-rights" role="group" aria-label={`What ${person.name} may change`}>
        {AREAS.map((a) => (
          <label key={a} className={`role-option ${areas.includes(a) ? 'checked' : ''}`} title={AREA_HELP[a]}>
            <input type="checkbox" checked={areas.includes(a)} disabled={!editable || busy} onChange={() => toggle(a)} />
            <span>
              <strong>{PLATFORM_AREA_LABELS[a]}</strong>
            </span>
          </label>
        ))}
      </div>
      {(changed || error) && (
        <div className="ap-actions">
          {error && <span className="field-error">{error}</span>}
          {editable && changed && (
            <>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => save(true)}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="btn btn-link btn-sm" disabled={busy} onClick={() => setAreas(start)}>
                Undo
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** Make an existing account (one with no hospital) a platform admin – view only until areas are ticked. */
function AddPlatformAdmin({ onSaved }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const add = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const found = await api(`/platform/users?search=${encodeURIComponent(email.trim())}&limit=5`);
      const person = found.users.find((u) => u.email === email.trim().toLowerCase());
      if (!person) throw new Error('No account with this email. Create it first under New account.');
      await api(`/platform/users/${person.id}/platform-admin`, { method: 'PATCH', body: { isPlatformAdmin: true, permissions: [] } });
      setEmail('');
      onSaved(`${person.name} is now a platform admin (view only until you tick what they may change).`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card" onSubmit={add} noValidate>
      <h2>Add a platform admin</h2>
      <p className="hint">An existing account that works at no hospital. They start view only; tick what they may change above.</p>
      <Alert type="error">{error}</Alert>
      <div className="ap-add-row">
        <Field label="Email of the account" id="pa-email">
          <input id="pa-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} placeholder="name@example.com" />
        </Field>
        <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>
          {busy ? 'Adding…' : 'Make platform admin'}
        </button>
      </div>
    </form>
  );
}

// Hospital admins' rights over their staff (owner, 12 Oct 2026): every hospital admin, with a tick per right. Without a
// right the hospital admin still sees the staff, and is told to ask the super admin.
const ADMIN_RIGHT_LABELS = { addPeople: 'Add people', resetPassword: 'Reset password', access: 'Remove / restore access', roles: 'Change roles', details: 'Edit name and email' };
const ADMIN_RIGHT_HELP = {
  addPeople: 'Add new staff to their hospital – doctors, RMOs, nurses, reception, lab, pharmacy, billing, referral desk. Never another admin: only you make admins.',
  resetPassword: 'Give a temporary password to someone who works only at their hospital',
  access: "Remove someone's access to their hospital, or give it back",
  roles: "Change someone's roles there – never making or removing an admin",
  details: 'Correct a name or an email',
};
const ADMIN_RIGHTS = Object.keys(ADMIN_RIGHT_LABELS);
const ROLE_WORDS = { doctor: 'Doctor', rmo: 'RMO', nurse: 'Nurse', receptionist: 'Reception', lab: 'Lab', pharmacist: 'Pharmacist', billing: 'Billing', referral_desk: 'Referral desk' };

/**
 * Admin permissions (22 Oct 2026): what each hospital's admin may do to its staff. One card per hospital, its admins
 * inside; each admin's permissions are tick chips that wrap (no table to scroll sideways) and Save appears once
 * something changed. The super admin (or a platform admin given "Hospital admins' access") changes them; other
 * platform admins can look. An admin who is also clinical staff works as one or the other and switches to admin with
 * their password.
 */
export function AdminPermissionsPage() {
  const { platform } = useAuth();
  const editable = platform?.role === 'superadmin' || canEditArea(platform, 'hospitalAdmins');
  const { data, error, loading, reload } = useFetch('/platform/users/hospital-admins');
  const [flash, setFlash] = useState(null);
  const hospitals = groupByHospital(data?.admins ?? []);
  const saved = (message) => {
    setFlash(message);
    reload();
  };
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Users & access', to: '/platform/users' }, { label: 'Admin permissions' }]}
        title="Admin permissions"
        subtitle="Choose what each hospital's admin may do to its staff. Without a tick they see the staff and are told to ask you."
        tabs={platformTabs('users', platform)}
      />
      <div className="pf-content ap-page">
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        <Alert type="error">{error}</Alert>
        {!editable && <Alert type="info">Only a super admin (or an admin given Hospital admins&rsquo; access) changes these. You can look.</Alert>}
        <details className="card ap-help">
          <summary>What each permission allows</summary>
          <dl className="details">
            {ADMIN_RIGHTS.map((r) => (
              <div key={r}>
                <dt>{ADMIN_RIGHT_LABELS[r]}</dt>
                <dd>{ADMIN_RIGHT_HELP[r]}</dd>
              </div>
            ))}
          </dl>
          <p className="hint">
            To make a doctor an admin, open the hospital&rsquo;s Staff page and tick Admin as well as Doctor. They then work as one or the other: Switch to admin asks their
            password and shows no patient records; Switch to Doctor goes back.
          </p>
        </details>
        {loading && !data && <p className="hint">Loading the hospital admins…</p>}
        {data && hospitals.length === 0 && (
          <section className="card">
            <p>No hospital admins yet. Make someone an admin on a hospital&rsquo;s Staff page (Hospitals → the hospital → Staff).</p>
          </section>
        )}
        {hospitals.map((h) => (
          <section key={h.tenantId} className="card ap-hospital" aria-labelledby={`ap-${h.tenantId}`}>
            <div className="ap-hospital-head">
              <h2 id={`ap-${h.tenantId}`}>{h.tenantName}</h2>
              <Link to={`/platform/hospitals/${h.tenantId}`} className="btn btn-link btn-sm">
                Staff and setup
              </Link>
            </div>
            <ul className="ap-admins">
              {h.admins.map((a) => (
                <AdminPermissionRow key={`${a.memberId}:${a.adminRights.join()}`} admin={a} editable={editable} onSaved={saved} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

/** The admins, by hospital (A to Z), each hospital's admins A to Z. PURE. */
export function groupByHospital(admins) {
  const byId = new Map();
  for (const a of admins) {
    if (!byId.has(a.tenantId)) byId.set(a.tenantId, { tenantId: a.tenantId, tenantName: a.tenantName, admins: [] });
    byId.get(a.tenantId).admins.push(a);
  }
  return [...byId.values()].sort((x, y) => x.tenantName.localeCompare(y.tenantName)).map((h) => ({ ...h, admins: [...h.admins].sort((x, y) => x.user.name.localeCompare(y.user.name)) }));
}

/** One admin: who they are, their permissions as tick chips, Save when something changed. */
function AdminPermissionRow({ admin, editable, onSaved }) {
  const [rights, setRights] = useState(admin.adminRights);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const changed = [...rights].sort().join() !== [...admin.adminRights].sort().join();
  const clinical = admin.roles.filter((r) => r !== 'admin');
  const toggle = (r) => setRights((list) => (list.includes(r) ? list.filter((x) => x !== r) : ADMIN_RIGHTS.filter((x) => x === r || list.includes(x))));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/platform/tenants/${admin.tenantId}/members/${admin.memberId}/admin-rights`, { method: 'PATCH', body: { rights } });
      onSaved(`Permissions of ${admin.user.name} at ${admin.tenantName} saved.`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <li className="ap-admin">
      <div className="ap-who">
        <div className="ap-name">
          <Link to={`/platform/users/${admin.user.id}`}>{admin.user.name}</Link>
          {clinical.length > 0 && (
            <span className="pill" title="Works as one or the other; switches to admin with their password">
              Also {clinical.map((r) => ROLE_WORDS[r] ?? r).join(', ')}
            </span>
          )}
        </div>
        <div className="cell-sub">{admin.user.email}</div>
      </div>
      <div className="role-picker ap-rights" role="group" aria-label={`Permissions of ${admin.user.name} at ${admin.tenantName}`}>
        {ADMIN_RIGHTS.map((r) => (
          <label key={r} className={`role-option ${rights.includes(r) ? 'checked' : ''}`} title={ADMIN_RIGHT_HELP[r]}>
            <input type="checkbox" checked={rights.includes(r)} disabled={!editable || busy} onChange={() => toggle(r)} />
            <span>
              <strong>{ADMIN_RIGHT_LABELS[r]}</strong>
            </span>
          </label>
        ))}
      </div>
      {(changed || error) && (
        <div className="ap-actions">
          {error && <span className="field-error">{error}</span>}
          {editable && changed && (
            <>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={save}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="btn btn-link btn-sm" disabled={busy} onClick={() => setRights(admin.adminRights)}>
                Undo
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}
