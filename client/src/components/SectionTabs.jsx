// The tabs at the top of a section (Billing, Pharmacy, Hospital admin): only those this person may open.
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export function SectionTabs({ tabs, label }) {
  const { canAccess } = useAuth();
  return (
    <nav className="tabs" aria-label={label}>
      {tabs
        .filter((t) => !t.access || canAccess(t.access))
        .map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className="tab">{t.label}</NavLink>
        ))}
    </nav>
  );
}
