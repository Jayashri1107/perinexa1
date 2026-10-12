import { useState } from 'react';
import { Alert, RolePicker, useDialogFocus } from './ui.jsx';

// Pop-up window to change a person's roles in one hospital.
export function RolesDialog({ title, initialRoles, onSave, onCancel }) {
  const [roles, setRoles] = useState(initialRoles);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    if (roles.length === 0) {
      setError('Choose at least one role.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave(roles);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const dialogRef = useDialogFocus(onCancel);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={dialogRef} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="roles-title" onSubmit={save}>
        <h2 id="roles-title">{title}</h2>
        <p className="hint help">Tick every role this person has in this hospital. One person can have several roles.</p>
        <Alert type="error">{error}</Alert>
        <RolePicker value={roles} onChange={setRoles} idPrefix="dlg-role" />
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save roles'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
