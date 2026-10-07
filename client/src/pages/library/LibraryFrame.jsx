// The heading and tabs shared by every Clinic library page. Which tabs a person has comes from the server (prescription
// sets only for those who write prescriptions); a tab shows how many of its entries wait for a doctor's approval.
// The Clinical rules tab has a second row: red-flag rules, medicine safety and risk rules.
import { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { libraryApi } from '../../api/index.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LIBRARY_TABS, RULE_TABS } from '../../config/navigation.js';

const SummaryContext = createContext(null);
export const useLibrarySummary = () => useContext(SummaryContext);

export function LibraryFrame({ subtitle, actions, children, reloadKey = 0 }) {
  const [summary, setSummary] = useState(null);
  const { pathname } = useLocation();

  useEffect(() => {
    libraryApi.summary().then(setSummary).catch(() => setSummary(null));
  }, [reloadKey]);

  const kinds = new Map((summary?.kinds ?? []).map((k) => [k.key, k]));
  const totalDrafts = (summary?.kinds ?? []).reduce((n, k) => n + k.drafts, 0);
  const tabs = LIBRARY_TABS.filter((t) => !t.kinds || t.kinds.some((k) => kinds.has(k)));
  const inRules = RULE_TABS.some((t) => pathname.startsWith(t.to));

  return (
    <SummaryContext.Provider value={summary}>
      <PageHeader title="Clinic library" subtitle={subtitle} actions={actions} />
      <nav className="tabs" aria-label="Clinic library">
        {tabs.map((t) => {
          const drafts = t.kinds ? t.kinds.reduce((n, k) => n + (kinds.get(k)?.drafts ?? 0), 0) : totalDrafts;
          return (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab${isActive || (t.kinds?.length > 1 && inRules) ? ' active' : ''}`}>
              {t.label}
              {drafts > 0 && <span className="tab-count" aria-label={`${drafts} to approve`}>{drafts}</span>}
            </NavLink>
          );
        })}
      </nav>
      {inRules && (
        <nav className="tabs sub-tabs" aria-label="Clinical rules">
          {RULE_TABS.map((t) => (
            <NavLink key={t.to} to={t.to} className="tab">{t.label}</NavLink>
          ))}
        </nav>
      )}
      {children}
    </SummaryContext.Provider>
  );
}
