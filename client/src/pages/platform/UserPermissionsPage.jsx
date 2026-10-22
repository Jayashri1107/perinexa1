import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PLATFORM_AREA_LABELS, canEditArea, platformTabs } from '../../platform/modules.js';

// User permissions (owner's request, 12 Oct 2026): one table of every platform admin and what each may change –
// the super admin ticks and unticks, and makes someone a platform admin or takes it away. Platform admins can look.
// A platform admin always sees every platform page (never patient records); a ticked area is what they may change.
const AREA_HELP = {
  hospitals: 'Create hospitals, rename them, deactivate and reactivate them',
  users: 'Create accounts, add people to hospitals, change their roles, deactivate them, reset passwords',
  hospitalAdmins: "The same for a hospital's admins (adding, changing or removing a hospital admin)",
  hospitalSetup: "A hospital's setup: letterhead, patient messages, OPD timings, ABDM",
};
const AREAS = Object.keys(PLATFORM_AREA_LABELS);

/** One platform admin's row: their own ticks until Save. */
function usePermissionRow({ person, editable, onSaved }) {
  const [areas, setAreas] = useState(person.platformPermissions ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const changed = [...areas].sort().join() !== [...(person.platformPermissions ?? [])].sort().join();
  const save = async (isPlatformAdmin) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/platform/users/${person.id}/platform-admin`, { method: 'PATCH', body: { isPlatformAdmin, permissions: isPlatformAdmin ? areas : [] } });
      onSaved(isPlatformAdmin ? `Permissions of ${person.name} saved.` : `${person.name} is no longer a platform admin.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return {
    name: (
      <span className="name-cell-text">
        <strong>
          <Link to={`/platform/users/${person.id}`}>{person.name}</Link>
        </strong>
        <span className="cell-sub">{person.email}</span>
        {!person.isActive && <StatusPill tone="inactive">Deactivated</StatusPill>}
        {error && <span className="field-error">{error}</span>}
      </span>
    ),
    ...Object.fromEntries(
      AREAS.map((a) => [
        a,
        <input
          key={a}
          type="checkbox"
          aria-label={`${person.name}: ${PLATFORM_AREA_LABELS[a]}`}
          checked={areas.includes(a)}
          disabled={!editable || busy}
          onChange={() => setAreas((list) => (list.includes(a) ? list.filter((x) => x !== a) : [...list, a]))}
        />,
      ]),
    ),
    actions: editable && (
      <span className="row-actions">
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !changed} onClick={() => save(true)}>
          Save
        </button>
        <button type="button" className="btn btn-link btn-sm" disabled={busy} onClick={() => save(false)}>
          Remove platform admin
        </button>
      </span>
    ),
  };
}

export function UserPermissionsPage() {
  const { platform } = useAuth();
  const editable = platform?.role === 'superadmin';
  const { data, error, loading, reload } = useFetch('/platform/users', { type: 'platformadmin', limit: 100, sort: 'name' });
  const [flash, setFlash] = useState(null);
  const [email, setEmail] = useState('');
  const [addError, setAddError] = useState(null);
  const [busy, setBusy] = useState(false);
  const saved = (message) => {
    setFlash(message);
    reload();
  };

  // Make an existing account (one with no hospital) a platform admin – view only until areas are ticked
  const add = async (e) => {
    e.preventDefault();
    setAddError(null);
    setBusy(true);
    try {
      const found = await api(`/platform/users?search=${encodeURIComponent(email.trim())}&limit=5`);
      const person = found.users.find((u) => u.email === email.trim().toLowerCase());
      if (!person) throw new Error('No account with this email. Create it first under New account.');
      await api(`/platform/users/${person.id}/platform-admin`, { method: 'PATCH', body: { isPlatformAdmin: true, permissions: [] } });
      setEmail('');
      saved(`${person.name} is now a platform admin (view only until you tick what they may change).`);
    } catch (err) {
      setAddError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Users & access', to: '/platform/users' }, { label: 'User permissions' }]}
        title="User permissions"
        subtitle="Platform admins see every hospital and every account – never patient records – and change only what is ticked here."
        tabs={platformTabs('users', platform)}
      />
      <div className="pf-content">
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        <Alert type="error">{error}</Alert>
        {!editable && <Alert type="info">Only a super admin changes permissions. You can look.</Alert>}
        <section className="card">
          <h2>What each permission allows</h2>
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
        </section>
        <PermissionTable people={data?.users} loading={loading} editable={editable} onSaved={saved} />
        <section className="card">
          <h2>Hospital admins</h2>
          <p className="hint">
            What each hospital's admin may do to its staff – adding people among it – is on <Link to="/platform/users/admin-permissions">Admin permissions</Link>.
          </p>
        </section>
        {editable && (
          <form className="card" onSubmit={add} noValidate>
            <h2>Add a platform admin</h2>
            <p className="hint">An existing account that works at no hospital. They start view only; tick what they may change above.</p>
            <Alert type="error">{addError}</Alert>
            <div className="row">
              <Field label="Email of the account" id="pa-email">
                <input id="pa-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} placeholder="name@example.com" />
              </Field>
              <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>
                Make platform admin
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}

// The table: one PermissionRow (its own ticks and Save) per platform admin
function PermissionTable({ people, loading, editable, onSaved }) {
  return (
    <section className="dt-card">
      <div className="dt-wrap" aria-busy={loading}>
        <table className="dt perm-table">
          <caption className="sr-only">Platform admins and what each may change</caption>
          <thead>
            <tr>
              <th scope="col">Platform admin</th>
              {AREAS.map((a) => (
                <th key={a} scope="col" className="perm-col">
                  {PLATFORM_AREA_LABELS[a]}
                </th>
              ))}
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(people ?? []).map((p) => (
              <PermissionTableRow key={`${p.id}:${(p.platformPermissions ?? []).join()}`} person={p} editable={editable} onSaved={onSaved} />
            ))}
            {people && people.length === 0 && (
              <tr>
                <td colSpan={AREAS.length + 2} className="dt-empty">
                  No platform admins yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PermissionTableRow(props) {
  const cells = usePermissionRow(props);
  return (
    <tr>
      <td data-label="Platform admin" className="wrap">
        {cells.name}
      </td>
      {AREAS.map((a) => (
        <td key={a} data-label={PLATFORM_AREA_LABELS[a]} className="perm-col">
          {cells[a]}
        </td>
      ))}
      <td className="actions">{cells.actions}</td>
    </tr>
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
