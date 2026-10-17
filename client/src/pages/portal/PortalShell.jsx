import { useEffect, useRef, useState } from 'react';
import { Building2, CalendarDays, House, KeyRound, LogOut, Menu, UserRound, X } from 'lucide-react';
import appIcon from '../../assets/brand/perinexa-app-icon.png';
import logoReversed from '../../assets/brand/perinexa-logo-reversed.png';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Avatar } from '../../components/ui.jsx';
import { RECORD_TABS, recordIcon } from './PortalRecords.jsx';
import { accountWords } from './portalAccountWords.js';
import { PORTAL_LANGUAGES, PORTAL_LANGUAGE_NAMES, portalWords } from './portalWords.js';

// The patient's own pages in the app's own frame (owner, 16 Oct 2026: "like the other modules"): the same left menu,
// top bar and page header as the staff screens – Home, Appointments, Prescriptions, Lab reports, Visits, Bills, and
// Change password for an account with an email. On a tablet the menu is an icon rail, on a phone it opens from the menu
// button, as for staff. Only her own sections are ever in it. The tab title never holds her name (browser history).

/** The sections of her menu: [{ key, Icon }]. */
export function portalSections(canChangePassword) {
  return [
    { key: 'home', Icon: House },
    { key: 'appointments', Icon: CalendarDays },
    ...RECORD_TABS.map((key) => ({ key, Icon: recordIcon(key) })),
    { key: 'profile', Icon: UserRound },
    ...(canChangePassword ? [{ key: 'password', Icon: KeyRound }] : []),
  ];
}

const RAIL_QUERY = '(max-width: 1023px)';
function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(RAIL_QUERY).matches);
  useEffect(() => {
    const m = window.matchMedia?.(RAIL_QUERY);
    if (!m) return undefined;
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** English, मराठी, हिंदी – in her top bar. */
function LanguageSwitch({ lang, onChange }) {
  return (
    <div className="segmented portal-lang" role="group" aria-label={portalWords(lang).language}>
      {PORTAL_LANGUAGES.map((l) => (
        <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => onChange?.(l)}>
          {PORTAL_LANGUAGE_NAMES[l]}
        </button>
      ))}
    </div>
  );
}

export function PortalShell({ patientName, hospitalName, section, onSection, canChangePassword, lang, onLanguage, onSignOut, children }) {
  const w = portalWords(lang);
  const aw = accountWords(lang);
  const [open, setOpen] = useState(false);
  const narrow = useNarrow();
  const toggle = useRef(null);
  useEffect(() => setOpen(false), [section, narrow]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const sections = portalSections(canChangePassword);
  const label = (key) => aw.tabs[key];
  const current = sections.find((s) => s.key === section) ?? sections[0];
  return (
    <div className={`pf portal-shell ${open ? 'pf-mobile-open' : ''}`} lang={lang}>
      <aside className="sb" id="portal-menu" aria-label={aw.menu}>
        <div className="sb-brand">
          <button type="button" className="sb-toggle" ref={toggle} onClick={() => (narrow ? setOpen((o) => !o) : null)} aria-label={aw.menu} aria-controls="portal-menu" aria-expanded={!narrow || open}>
            <Menu aria-hidden="true" />
          </button>
          <span>
            <img className="sb-logo" src={logoReversed} alt="Perinexa by Docvritta" width="150" height="37" />
            <img className="sb-appicon" src={appIcon} alt="Perinexa" width="40" height="40" />
          </span>
          {open && (
            <button type="button" className="sb-close icon-btn" onClick={() => setOpen(false)} aria-label={w.dismiss}>
              <X aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="sb-subtitle" title={hospitalName}>
          <Building2 aria-hidden="true" /> <span>{hospitalName}</span>
        </p>
        <nav className="sb-nav">
          {sections.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`sb-link ${section === s.key ? 'active' : ''}`}
              aria-current={section === s.key ? 'page' : undefined}
              title={narrow && !open ? label(s.key) : undefined}
              onClick={() => onSection(s.key)}
            >
              <span className="sb-tile" aria-hidden="true">
                <s.Icon />
              </span>
              <span className="sb-label">{label(s.key)}</span>
            </button>
          ))}
        </nav>
        <div className="sb-foot" title={patientName}>
          <Avatar name={patientName} seed={patientName} />
          <span className="sb-foot-text">
            <strong>{patientName}</strong>
            <span>{aw.patientRole}</span>
          </span>
        </div>
      </aside>
      <div className="sb-overlay" onClick={() => setOpen(false)} aria-hidden="true" />
      <div className="pf-body">
        <header className="pf-topbar">
          <div className="pf-topbar-start">
            <button type="button" className="icon-btn pf-menu-btn" onClick={() => setOpen(true)} aria-label={aw.menu} aria-expanded={open} aria-controls="portal-menu">
              <Menu size={24} />
            </button>
            <span className="portal-place">
              <span className="muted">{aw.yourHospital}</span>
              <strong>{hospitalName}</strong>
            </span>
          </div>
          <div className="pf-topbar-actions">
            <LanguageSwitch lang={lang} onChange={onLanguage} />
            <button type="button" className="btn btn-sm pf-logout" onClick={onSignOut}>
              <LogOut aria-hidden="true" /> {w.signOut}
            </button>
          </div>
        </header>
        <main className="pf-main" id="main">
          <PageHeader title={label(current.key)} subtitle={current.key === 'home' ? aw.welcome(patientName) : hospitalName} documentTitle={false} />
          <div className="pf-content portal-content">
            {w.draftNote && <p className="hint portal-draft">{w.draftNote}</p>}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
