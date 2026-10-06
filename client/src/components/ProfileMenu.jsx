// The profile circle beside "Log out": click it for your name, email and role, and Change password / My settings.
import { KeyRound, UserCog } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppConfig } from '../context/AppConfigContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { initialsOf } from '../utils/format.js';

export function ProfileMenu() {
  const { user, roles, activeMembership } = useAuth();
  const { roleLabel } = useAppConfig();
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  // close on a click outside or Escape
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !box.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const role = user.isSuperAdmin
    ? user.isPrimary ? 'Main super admin' : 'Super admin'
    : roles.map(roleLabel).join(', ');

  return (
    <div className="profile" ref={box}>
      <button type="button" className="avatar avatar-btn" aria-haspopup="true" aria-expanded={open} aria-label={`Your profile: ${user.name}`} onClick={() => setOpen((o) => !o)}>
        {initialsOf(user.name)}
      </button>
      {open && (
        <div className="profile-card" role="dialog" aria-label="Your profile">
          <div className="profile-head">
            <span className="avatar avatar-lg" aria-hidden>{initialsOf(user.name)}</span>
            <div>
              <strong className="block">{user.name}</strong>
              <span className="muted small block">{user.email}</span>
              {role && <span className="pill top-gap-sm">{role}</span>}
              {activeMembership && !user.isSuperAdmin && <span className="muted small block">{activeMembership.hospital.name}</span>}
            </div>
          </div>
          <Link to="/change-password" className="profile-link" onClick={() => setOpen(false)}>
            <KeyRound size={16} aria-hidden /> Change password
          </Link>
          <Link to="/account" className="profile-link" onClick={() => setOpen(false)}>
            <UserCog size={16} aria-hidden /> My settings
          </Link>
        </div>
      )}
    </div>
  );
}
