// Shown once after creating an account or resetting a password. The password is not stored anywhere readable,
// so it cannot be shown again.
import { Copy, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { Modal } from './Modal.jsx';

export function TemporaryPasswordNotice({ email, password, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard?.writeText(password).catch(() => {});
    setCopied(true);
  };

  return (
    <Modal
      title="Temporary password"
      onClose={onClose}
      size="sm"
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          I have noted it
        </button>
      }
    >
      <p>
        Give this password to <strong>{email}</strong> in person or by phone. It is shown only now. They must choose
        their own password at first login.
      </p>
      <div className="temp-password">
        <KeyRound size={18} aria-hidden />
        <code>{password}</code>
        <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
          <Copy size={14} aria-hidden /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </Modal>
  );
}
