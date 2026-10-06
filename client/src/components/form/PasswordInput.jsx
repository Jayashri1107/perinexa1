// A password box with an eye button to show or hide what was typed.
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

export function PasswordInput({ value, onChange, ...inputProps }) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;

  return (
    <div className="password-input">
      <input {...inputProps} type={visible ? 'text' : 'password'} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        title={visible ? 'Hide password' : 'Show password'}
      >
        <Icon size={18} aria-hidden />
      </button>
    </div>
  );
}
