import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { plansUpdateText } from './templateFormat.js';

/** The preview of "Update all plans" in words (counts only; the server's numbers). Nothing before it is loaded. */
export function UpdatePlansPreview({ preview }) {
  const words = plansUpdateText(preview);
  if (!words) return null;
  return (
    <>
      <p>
        <strong>{words.summary}</strong>
      </p>
      <ul className="cp-update-list">
        {words.from && <li>{words.from}</li>}
        {words.items && <li>{words.items}</li>}
        {words.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {words.warnings.length > 0 && (
        <Alert type="warning">
          <ul className="plain-list">
            {words.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}
    </>
  );
}

/**
 * "Update all plans" (5 Oct 2026), in two steps: the server works out what moving every current plan that uses an
 * older version would do (counts only – no patient and no item names), then the doctor confirms the version they
 * reviewed. Each plan is moved exactly as on the patient's Care plan tab: items done stay done, moved dates, notes and
 * items added for the patient are kept. onDone(result) after the move; onOutdated(message) when the template changed
 * meanwhile (the page then shows the latest version).
 */
export function UpdatePlansDialog({ template, onDone, onOutdated, onCancel }) {
  const preview = useFetch(`/care-plans/templates/${template.id}/plans-update`);
  const p = preview.data;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const ref = useDialogFocus(onCancel);

  const submit = async (e) => {
    e.preventDefault();
    if (!p?.plans.toUpdate) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api(`/care-plans/templates/${template.id}/plans-update`, { method: 'POST', body: { version: p.template.version, itemsHash: p.template.itemsHash } });
      onDone(res.result, p.template.version);
    } catch (err) {
      setSaving(false);
      if (err.status === 409) onOutdated(err.message);
      else setError(err.message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="update-plans-title" onSubmit={submit} noValidate>
        <h2 id="update-plans-title">Update plans to version {template.version}</h2>
        <p className="hint help">
          Each plan is updated as on the patient's Care plan tab: items done stay done, and dates moved, notes and items added for a patient are kept. Closed
          plans are not changed.
        </p>
        <Alert type="error">{error ?? (!preview.loading && preview.error)}</Alert>
        {preview.loading && !p && <p className="muted">Working out what would change…</p>}
        <UpdatePlansPreview preview={p} />
        <div className="row cp-dialog-actions">
          <button type="button" className="btn btn-link" onClick={onCancel}>
            {p && !p.plans.toUpdate ? 'Close' : 'Cancel'}
          </button>
          {p?.plans.toUpdate > 0 && (
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <RefreshCw aria-hidden="true" /> {saving ? 'Updating…' : `Update ${p.plans.toUpdate} plan${p.plans.toUpdate === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
