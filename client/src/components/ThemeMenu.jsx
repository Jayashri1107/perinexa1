// The theme button in the top bar, beside the bell (owner, 9 Oct 2026): one click switches light ↔ dark, and the symbol
// with it (sun in the light theme, moon in the dark one). Remembered for the person on every computer.
import { Moon, Sun } from 'lucide-react';
import { accountApi } from '../api/index.js';
import { useAppConfig } from '../context/AppConfigContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export function ThemeMenu() {
  const { appearance } = useAppConfig();
  const { user, updateUser } = useAuth();
  // an older "match device" choice counts as what the page shows now
  const saved = user.preferences?.theme;
  const dark = saved === 'dark' || (saved === 'system' && document.documentElement.dataset.theme === 'dark');
  const next = dark ? 'light' : 'dark';

  const toggle = async () => {
    const prefs = { textSize: user.preferences?.textSize ?? appearance.textSize[0].key, density: user.preferences?.density ?? appearance.density[0].key, theme: next };
    updateUser({ ...user, preferences: { ...user.preferences, ...prefs } }); // at once on screen …
    try {
      updateUser((await accountApi.updateAppearance(prefs)).user); // … and remembered
    } catch {
      /* kept on this screen; saved the next time */
    }
  };

  const label = dark ? 'Dark theme on. Switch to the light theme' : 'Light theme on. Switch to the dark theme';
  return (
    <button type="button" className="icon-btn theme-toggle" aria-label={label} title={label} aria-pressed={dark} onClick={toggle}>
      {dark ? <Moon size={18} aria-hidden /> : <Sun size={18} aria-hidden />}
    </button>
  );
}
