import { useState } from 'react';
import { api } from '../../api.js';
import { useDialogFocus } from '../../components/ui.jsx';

// Small pieces shared by the billing screens: a dialog, and sending a change to the server.

export function Modal({ id, title, wide = false, onClose, children }) {
  const ref = useDialogFocus(onClose);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className={wide ? 'modal modal-wide' : 'modal'} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Sends a change; what comes back goes to onDone(result, message). method: POST unless given. */
export function useSend(onDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const send = async (path, body, message, method = 'POST') => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const res = await api(path, { method, body });
      setBusy(false);
      onDone(res, message?.(res));
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setBusy(false);
    }
  };
  return { busy, error, fields, send };
}
