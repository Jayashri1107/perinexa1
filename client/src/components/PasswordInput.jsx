import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

// A password box with an eye button that shows or hides what was typed (owner, 13 Oct 2026). The button says what it
// will do ("Show password" / "Hide password"); everything else is passed to the input as it is.
export function PasswordInput({ id, label = 'password', className = '', ...props }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="pw-box">
      <input id={id} {...props} type={shown ? 'text' : 'password'} className={className} />
      <button type="button" className="pw-eye" onClick={() => setShown((s) => !s)} aria-label={shown ? `Hide ${label}` : `Show ${label}`} aria-controls={id} aria-pressed={shown} title={shown ? `Hide ${label}` : `Show ${label}`}>
        {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </button>
    </span>
  );
}
