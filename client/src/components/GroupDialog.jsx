import { useState } from 'react';
import { PAGES, PAGE_LEVEL_LABELS } from '../platform/pageAccess.js';
import { DepartmentPicker, departmentsMissing } from './DepartmentPicker.jsx';
import { Alert, Field, rolesLabel, useDialogFocus } from './ui.jsx';

// User groups (docs/USER_GROUPS_PLAN.md Part B): a person's group in one hospital, a doctor's departments, and the
// person's own page access – per menu item "As the group" or their own None / View / Edit.
// onSave({ groupId, departments, pages }) – pages: { key: 'group' | 'none' | 'view' | 'edit' } for every menu item.

/** The group drop-down's choices: a hospital's own admin never sees the groups that make someone a hospital admin. PURE. */
export const groupChoices = (groups = [], noAdmin = false) => groups.filter((g) => !noAdmin || !g.roles.includes('admin'));

export function GroupSelect({ id, groups, value, onChange, error, noAdmin = false }) {
  const chosen = groups.find((g) => g.id === value);
  return (
    <Field label="User group" id={id} error={error} hint={chosen ? `Roles: ${rolesLabel(chosen.roles)}${chosen.description ? ` – ${chosen.description}` : ''}` : 'What this person may do here and which menu items they see.'} keepHint>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a group…</option>
        {groupChoices(groups, noAdmin).map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function GroupDialog({ member, groups, noAdmin = false, onSave, onCancel }) {
  const [groupId, setGroupId] = useState(member.groupId ?? '');
  const [departments, setDepartments] = useState(member.departments?.length ? member.departments : member.department ? [member.department] : []);
  const [pages, setPages] = useState(() => Object.fromEntries(PAGES.map((p) => [p.key, member.pageOverrides?.[p.key] ?? 'group'])));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const group = groups.find((g) => g.id === groupId);
  const doctor = Boolean(group?.roles.includes('doctor'));
  const groupLevel = (key) => PAGE_LEVEL_LABELS[group?.pages?.[key] ?? 'edit'];

  const save = async (e) => {
    e.preventDefault();
    if (!group) {
      setError('Choose a user group.');
      return;
    }
    const missing = departmentsMissing(group.roles, departments);
    if (missing) {
      setError(missing);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave({ groupId, departments: doctor ? departments : [], pages });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const dialogRef = useDialogFocus(onCancel);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={dialogRef} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="group-title" onSubmit={save}>
        <h2 id="group-title">Access for {member.user.name}</h2>
        <Alert type="error">{error}</Alert>
        <GroupSelect id="dlg-group" groups={groups} value={groupId} onChange={setGroupId} noAdmin={noAdmin && !member.roles.includes('admin')} />
        {doctor && <DepartmentPicker value={departments} onChange={setDepartments} idPrefix="dlg-dept" />}
        <details className="ug-own">
          <summary>This person&apos;s own page access</summary>
          <p className="hint help">Leave a menu item as the group has it, or set it for this person only.</p>
          <table className="ug-pages">
            <caption className="sr-only">Page access for this person</caption>
            <thead>
              <tr>
                <th scope="col">Menu item</th>
                <th scope="col">For this person</th>
              </tr>
            </thead>
            <tbody>
              {PAGES.map((p) => (
                <tr key={p.key}>
                  <th scope="row">{p.label}</th>
                  <td>
                    <select aria-label={`${p.label} for this person`} value={pages[p.key]} onChange={(e) => setPages({ ...pages, [p.key]: e.target.value })}>
                      <option value="group">As the group ({groupLevel(p.key)})</option>
                      <option value="none">None</option>
                      <option value="view">View</option>
                      <option value="edit">Edit</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
