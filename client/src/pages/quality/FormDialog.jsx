import { useDialogFocus } from '../../components/ui.jsx';

// A small form in a dialog (Clinical Requirements Group A pages): a title, the fields, one primary button and Cancel.
export function FormDialog({ id, title, children, submitLabel, busy = false, onSubmit, onCancel }) {
  const ref = useDialogFocus(onCancel);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        ref={ref}
        tabIndex={-1}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <h2 id={`${id}-title`}>{title}</h2>
        {children}
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : submitLabel}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/** "2026-11-08T10:30" in this computer's time for a datetime-local input: now. */
export const nowLocal = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
/** A datetime-local value → ISO (null when empty). */
export const toIso = (v) => (v ? new Date(v).toISOString() : null);
