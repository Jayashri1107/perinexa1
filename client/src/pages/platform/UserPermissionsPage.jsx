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
        <HospitalAdminRights editable={editable || canEditArea(platform, 'hospitalAdmins')} onSaved={setFlash} />
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
const ADMIN_RIGHT_LABELS = { resetPassword: 'Reset password', access: 'Remove / restore access', roles: 'Change roles', details: 'Edit name and email' };
const ADMIN_RIGHTS = Object.keys(ADMIN_RIGHT_LABELS);

function HospitalAdminRights({ editable, onSaved }) {
  const { data, error, loading, reload } = useFetch('/platform/users/hospital-admins');
  return (
    <section className="dt-card">
      <div className="card-head-plain">
        <h2>Hospital admins' rights</h2>
        <p className="hint">What each hospital's admin may do to its staff. Without a tick, they see the staff but are told they need your permission.</p>
      </div>
      <Alert type="error">{error}</Alert>
      <div className="dt-wrap" aria-busy={loading}>
        <table className="dt perm-table">
          <caption className="sr-only">Hospital admins and their rights over the staff</caption>
          <thead>
            <tr>
              <th scope="col">Hospital admin</th>
              <th scope="col">Hospital</th>
              {ADMIN_RIGHTS.map((r) => (
                <th key={r} scope="col" className="perm-col">
                  {ADMIN_RIGHT_LABELS[r]}
                </th>
              ))}
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(data?.admins ?? []).map((a) => (
              <AdminRightsRow
                key={`${a.memberId}:${a.adminRights.join()}`}
                admin={a}
                editable={editable}
                onSaved={(m) => {
                  onSaved(m);
                  reload();
                }}
              />
            ))}
            {data && data.admins.length === 0 && (
              <tr>
                <td colSpan={ADMIN_RIGHTS.length + 3} className="dt-empty">
                  No hospital admins yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AdminRightsRow({ admin, editable, onSaved }) {
  const [rights, setRights] = useState(admin.adminRights);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const changed = [...rights].sort().join() !== [...admin.adminRights].sort().join();
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/platform/tenants/${admin.tenantId}/members/${admin.memberId}/admin-rights`, { method: 'PATCH', body: { rights } });
      onSaved(`Rights of ${admin.user.name} at ${admin.tenantName} saved.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <tr>
      <td data-label="Hospital admin" className="wrap">
        <strong>
          <Link to={`/platform/users/${admin.user.id}`}>{admin.user.name}</Link>
        </strong>
        <div className="cell-sub">{admin.user.email}</div>
        {error && <span className="field-error">{error}</span>}
      </td>
      <td data-label="Hospital">{admin.tenantName}</td>
      {ADMIN_RIGHTS.map((r) => (
        <td key={r} data-label={ADMIN_RIGHT_LABELS[r]} className="perm-col">
          <input
            type="checkbox"
            aria-label={`${admin.user.name}, ${admin.tenantName}: ${ADMIN_RIGHT_LABELS[r]}`}
            checked={rights.includes(r)}
            disabled={!editable || busy}
            onChange={() => setRights((list) => (list.includes(r) ? list.filter((x) => x !== r) : [...list, r]))}
          />
        </td>
      ))}
      <td className="actions">
        {editable && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !changed} onClick={save}>
            Save
          </button>
        )}
      </td>
    </tr>
  );
}
