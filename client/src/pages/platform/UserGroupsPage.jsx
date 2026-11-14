import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable, formatNumber } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, RolePicker, StatusPill, rolesLabel, useConfirm } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { platformTabs } from '../../platform/modules.js';
import { PAGES, PAGE_LEVELS, PAGE_LEVEL_LABELS } from '../../platform/pageAccess.js';

// User groups (developer, 14 Nov 2026 – docs/USER_GROUPS_PLAN.md Part B; server: routes/userGroups.js). The super admin
// makes the groups once, for every hospital: what the group's people may do and which patient records they may open (its
// roles – the same rules as before), and per menu item None / View / Edit. A person gets one group; their own page
// access may be changed on top of it (Hospital → staff → the person). Platform admins can look.

const base = '/platform/users/groups';

/** How many menu items a group hides or shows view only, in words. PURE. */
export const pagesSummary = (pages = {}) => {
  const none = Object.values(pages).filter((v) => v === 'none').length;
  const view = Object.values(pages).filter((v) => v === 'view').length;
  if (!none && !view) return 'Every menu item';
  return [none ? `${none} hidden` : '', view ? `${view} view only` : ''].filter(Boolean).join(' · ');
};

export function UserGroupsPage() {
  const { platform } = useAuth();
  const navigate = useNavigate();
  const { data, error, loading } = useFetch('/platform/user-groups');
  const editable = platform?.role === 'superadmin';
  const columns = [
    { key: 'name', header: 'Group', render: (g) => <span className="strong-name">{g.name}</span> },
    { key: 'roles', header: 'Roles', className: 'wrap', render: (g) => rolesLabel(g.roles) },
    { key: 'pages', header: 'Menu items', width: 200, render: (g) => pagesSummary(g.pages) },
    { key: 'members', header: 'People', width: 90, render: (g) => <span className="tabular">{formatNumber(g.members)}</span> },
    {
      key: 'status',
      header: 'Status',
      width: 150,
      render: (g) => (g.isActive ? <StatusPill tone="stable">Active</StatusPill> : <StatusPill tone="inactive">Deactivated</StatusPill>),
    },
  ];
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Users & access', to: '/platform/users' }, { label: 'User groups' }]}
        title="User groups"
        subtitle="Each person in a hospital is in one group. The group decides what they may do and which menu items they see – in every hospital."
        tabs={platformTabs('users', platform)}
        actions={
          editable && (
            <button type="button" className="btn btn-primary" onClick={() => navigate(`${base}/new`)}>
              New group
            </button>
          )
        }
      />
      <div className="pf-content">
        <Alert type="error">{error}</Alert>
        {!editable && <Alert type="info">Only a super admin makes and changes user groups. You can look.</Alert>}
        <DataTable caption="User groups" columns={columns} rows={data?.groups} loading={loading} onRowClick={(g) => navigate(`${base}/${g.id}`)} emptyText="No user groups yet." />
        <p className="help">The 13 groups made from the old roles keep their roles; their menu items can be changed. A group with people in it keeps its roles – make a new group instead.</p>
      </div>
    </>
  );
}

export function UserGroupEditPage() {
  const { id } = useParams();
  const isNew = id === 'new';
  const { platform } = useAuth();
  const navigate = useNavigate();
  const editable = platform?.role === 'superadmin';
  const { data, error } = useFetch('/platform/user-groups');
  const group = isNew ? null : (data?.groups ?? []).find((g) => g.id === id);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [flash, setFlash] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  useEffect(() => {
    if (isNew) setForm({ name: '', description: '', roles: [], pages: {} });
    else if (group) setForm({ name: group.name, description: group.description, roles: group.roles, pages: { ...group.pages } });
  }, [isNew, group?.id, group?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isNew && data && !group) {
    return (
      <>
        <PageHeader breadcrumbs={[{ label: 'User groups', to: base }, { label: 'Not found' }]} title="User group not found" />
        <div className="pf-content">
          <Alert type="error">This user group does not exist.</Alert>
        </div>
      </>
    );
  }
  const rolesLocked = !editable || Boolean(group?.system) || (group?.members ?? 0) > 0;
  const setLevel = (key, level) => setForm((f) => ({ ...f, pages: { ...f.pages, [key]: level } }));

  const save = async (e) => {
    e.preventDefault();
    setErrors({});
    setSaveError(null);
    setBusy(true);
    const body = { name: form.name, description: form.description, pages: form.pages, ...(rolesLocked ? {} : { roles: form.roles }) };
    try {
      const res = isNew ? await api('/platform/user-groups', { method: 'POST', body }) : await api(`/platform/user-groups/${id}`, { method: 'PATCH', body });
      if (isNew) navigate(`${base}/${res.group.id}`, { replace: true });
      else setFlash('Group saved.');
    } catch (err) {
      setErrors(err.fields ?? {});
      setSaveError(err.fields ? null : err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    const ok = await confirm(
      group.isActive
        ? { title: `Deactivate ${group.name}?`, text: 'It can no longer be chosen for anyone. Nothing is deleted.', confirmLabel: 'Deactivate group', danger: true }
        : { title: `Reactivate ${group.name}?`, confirmLabel: 'Reactivate group' },
    );
    if (!ok) return;
    setSaveError(null);
    try {
      await api(`/platform/user-groups/${id}/status`, { method: 'PATCH', body: { isActive: !group.isActive } });
      setFlash(group.isActive ? 'Group deactivated.' : 'Group reactivated.');
    } catch (err) {
      setSaveError(err.message);
    }
  };

  return (
    <>
      {confirmDialog}
      <PageHeader
        breadcrumbs={[{ label: 'Users & access', to: '/platform/users' }, { label: 'User groups', to: base }, { label: isNew ? 'New group' : (group?.name ?? '…') }]}
        title={isNew ? 'New user group' : (group?.name ?? 'User group')}
        badges={group && !group.isActive ? <StatusPill tone="inactive">Deactivated</StatusPill> : null}
        subtitle={group ? `${formatNumber(group.members)} ${group.members === 1 ? 'person' : 'people'} in this group, in every hospital` : 'Used in every hospital'}
        actions={
          editable &&
          group &&
          !group.system && (
            <button type="button" className="btn btn-secondary" onClick={toggleActive}>
              {group.isActive ? 'Deactivate group' : 'Reactivate group'}
            </button>
          )
        }
      />
      <div className="pf-content">
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        <Alert type="error">{error ?? saveError}</Alert>
        {!editable && <Alert type="info">Only a super admin changes user groups. You can look.</Alert>}
        {form && (
          <form className="ug-form" onSubmit={save} noValidate>
            <section className="card ug-card">
              <h2>Group</h2>
              <Field label="Name" id="ug-name" error={errors.name}>
                <input id="ug-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} disabled={!editable} />
              </Field>
              <Field label="Description (optional)" id="ug-description" error={errors.description}>
                <input id="ug-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={300} disabled={!editable} />
              </Field>
            </section>
            <section className="card ug-card">
              <h2>Roles</h2>
              <p className="help">
                What the group&apos;s people may do, and which patient records they may open – the same rules as for each role before.
                {group?.system ? ' This group was made from a role, so its roles stay.' : group?.members ? ' People are in this group, so its roles stay; make a new group to change them.' : ''}
              </p>
              {errors.roles && <p className="field-error">{errors.roles}</p>}
              <RolePicker value={form.roles} onChange={(roles) => setForm({ ...form, roles })} idPrefix="ug-role" disabled={rolesLocked} />
            </section>
            <section className="card ug-card">
              <h2>Menu items</h2>
              <p className="help">None hides the item and its pages. View shows them without letting anything be saved. Each item also needs a role that uses it.</p>
              <table className="ug-pages">
                <caption className="sr-only">Access to each menu item</caption>
                <thead>
                  <tr>
                    <th scope="col">Menu item</th>
                    {PAGE_LEVELS.map((l) => (
                      <th key={l} scope="col">
                        {PAGE_LEVEL_LABELS[l]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PAGES.map((p) => {
                    const level = form.pages[p.key] ?? 'edit';
                    return (
                      <tr key={p.key}>
                        <th scope="row">{p.label}</th>
                        {PAGE_LEVELS.map((l) => (
                          <td key={l}>
                            <input
                              type="radio"
                              name={`ug-page-${p.key}`}
                              checked={level === l}
                              onChange={() => setLevel(p.key, l)}
                              disabled={!editable}
                              aria-label={`${p.label}: ${PAGE_LEVEL_LABELS[l]}`}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
            {editable && (
              <div className="ug-actions">
                <button type="submit" className="btn btn-primary" disabled={busy || !form.name.trim() || !form.roles.length}>
                  {isNew ? 'Make group' : 'Save'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => navigate(base)}>
                  Cancel
                </button>
              </div>
            )}
          </form>
        )}
      </div>
    </>
  );
}
