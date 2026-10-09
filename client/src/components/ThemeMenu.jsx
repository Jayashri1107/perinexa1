// The theme in the top bar, beside the bell (owner, 9 Oct 2026): Light, Dark or Match device. It changes at once and is
// remembered for the person on every computer (the same setting My settings used to hold).
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { accountApi } from '../api/index.js';
import { useAppConfig } from '../context/AppConfigContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const ICONS = { light: Sun, dark: Moon, system: Monitor };

export function ThemeMenu() {
  const { appearance } = useAppConfig();
  const { user, updateUser } = useAuth();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const current = user.preferences?.theme ?? appearance.theme[0].key;
  const Icon = ICONS[current] ?? Sun;

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !box.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const choose = async (theme) => {
    setOpen(false);
    if (theme === current) return;
    const prefs = { textSize: user.preferences?.textSize ?? appearance.textSize[0].key, density: user.preferences?.density ?? appearance.density[0].key, theme };
    updateUser({ ...user, preferences: { ...user.preferences, ...prefs } }); // at once on screen …
    try {
      updateUser((await accountApi.updateAppearance(prefs)).user); // … and remembered
    } catch {
      /* kept on this screen; saved the next time */
    }
  };

  const label = appearance.theme.find((t) => t.key === current)?.label ?? current;
  return (
    <div className="theme-menu" ref={box}>
      <button type="button" className="icon-btn" aria-haspopup="true" aria-expanded={open} aria-label={`Theme: ${label}. Change the theme`} title={`Theme: ${label}`} onClick={() => setOpen((o) => !o)}>
        <Icon size={18} aria-hidden />
      </button>
      {open && (
        <div className="theme-pop" role="menu" aria-label="Theme">
          {appearance.theme.map((t) => {
            const I = ICONS[t.key] ?? Sun;
            const on = t.key === current;
            return (
              <button key={t.key} type="button" role="menuitemradio" aria-checked={on} className={`theme-item${on ? ' on' : ''}`} onClick={() => choose(t.key)}>
                <I size={16} aria-hidden /> <span>{t.label}</span> {on && <Check size={14} className="theme-check" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
