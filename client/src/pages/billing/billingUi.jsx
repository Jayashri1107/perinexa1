import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../api.js';
import { useDialogFocus } from '../../components/ui.jsx';

// Small pieces shared by the billing screens: a dialog, and sending a change to the server.

/**
 * Inside the IPD bill page (owner, 9 Nov 2026) a form opens in the page – a panel above the bill – not as a window
 * over it. The page sets this to true around its forms; everywhere else they stay dialogs.
 */
export const InlineForms = createContext(false);

/** The form as a panel in the page: its heading, a Close button, moved into view; Escape closes it. */
export function InlinePanel({ id, title, onClose, children }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const node = ref.current;
    node?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    (node?.querySelector('input:not([type=hidden]), select, textarea') ?? node)?.focus?.({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape' && node?.contains(document.activeElement)) {
        e.preventDefault();
        closeRef.current?.();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <section ref={ref} tabIndex={-1} className="card inline-form" aria-labelledby={`${id}-title`}>
      <div className="inline-form-head">
        <h2 id={`${id}-title`}>{title}</h2>
        <button type="button" className="btn btn-link btn-sm" onClick={onClose}>
          <X aria-hidden="true" /> Close
        </button>
      </div>
      {children}
    </section>
  );
}

function DialogModal({ id, title, wide = false, onClose, children }) {
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

export function Modal(props) {
  const inline = useContext(InlineForms);
  return inline ? <InlinePanel {...props} /> : <DialogModal {...props} />;
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
