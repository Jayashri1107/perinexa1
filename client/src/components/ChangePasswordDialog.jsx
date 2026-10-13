import { ChangePasswordPage } from '../pages/ChangePasswordPage.jsx';
import { useDialogFocus } from './ui.jsx';

// Change password in a pop-up, where you are (from the profile menu). The first login with a temporary password
// still uses its own page (/change-password), because nothing else may be done before it.
export function ChangePasswordDialog({ onClose }) {
  const ref = useDialogFocus(onClose);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="modal pw-dialog" role="dialog" aria-modal="true" aria-label="Change password">
        <ChangePasswordPage embedded onClose={onClose} />
      </div>
    </div>
  );
}
