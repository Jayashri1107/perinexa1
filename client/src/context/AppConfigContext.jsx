// The server's public settings (app name, roles, master-data lists, pagination …), loaded once at start.
// Screens read them from here instead of repeating them in code.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { metaApi } from '../api/index.js';
import { Loader } from '../components/Loader.jsx';

const AppConfigContext = createContext(null);

export function AppConfigProvider({ children }) {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    metaApi.get().then(setConfig).catch((err) => setError(err.message));
  }, []);

  const value = useMemo(() => {
    if (!config) return null;
    const roleLabel = Object.fromEntries(config.roles.map((r) => [r.key, r.label]));
    return { ...config, roleLabel: (key) => roleLabel[key] ?? key };
  }, [config]);

  useEffect(() => {
    if (config) document.title = `${config.app.name} · ${config.app.tagline}`;
  }, [config]);

  if (error) return <div className="boot-error">{error}</div>;
  if (!value) return <Loader full />;
  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>;
}

export const useAppConfig = () => useContext(AppConfigContext);
