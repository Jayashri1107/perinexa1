import { createContext, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { MenuButton } from './MenuButton.jsx';

// The app layout's 88 px title bar has a spot on the left for the screen title (brand guide page 7:
// "title bar – screen title + user"). Each page's PageHeader puts its title there.
export const TitleSlotContext = createContext(null);

/**
 * Top of every page: breadcrumbs and title (shown in the title bar), then an optional subtitle (help: a description
 * of the page, an explanation shown only while Explanations are on – see .help),
 * actions (at most ONE primary button per screen) and the sub-module tabs.
 * tabs: [{ label, to, end?, icon?, menu?, activeFor? }] – a tab with a `menu` ([{ label, to }]) opens that list of
 *   links; one with `activeFor` (a path or paths) is the current tab on every page under them (e.g. Care plans on
 *   its red-flag rules too)
 * subtabs: a second, smaller row of tabs for the sections of the current tab ([{ label, to, end? }])
 * pinned: phones – the header stays at the top while the page scrolls, slimmer once the page has moved under it (a patient's record)
 * className: added to the header (styling one kind of page)
 * caption: phones – a short line under the title (Today's date)
 * inline: keep the title in the page, not in the phone's top row (a page with its own back button beside it)
 */
export function PageHeader({ breadcrumbs = [], title, subtitle, help, badges, actions, tabs, subtabs, documentTitle, pinned = false, className = '', caption, inline = false }) {
  const topRow = useContext(TitleSlotContext);
  // A patient's pinned header keeps its own title: it stays in view with her name and main button
  const slot = pinned || inline ? null : topRow;
  const { pathname } = useLocation();
  // Phones: the subtitle waits behind an ⓘ beside the title (mobile.css), shown when it is tapped
  const [infoOpen, setInfoOpen] = useState(false);
  // Phones, more than three sections: one "jump to" button with the current section's name, opening the list of all
  const [jumpOpen, setJumpOpen] = useState(false);
  useEffect(() => setJumpOpen(false), [pathname]);
  // pinned: slimmer ("stuck") once the page has been scrolled
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!pinned) return undefined;
    // Two limits and only on a page with room to spare: the header shrinking must not move the page back and forth, or
    // the buttons jump away from under a finger
    const check = () => setStuck((was) => {
      const room = document.documentElement.scrollHeight - window.innerHeight;
      if (was) return window.scrollY > 8;
      return window.scrollY > 80 && room > 300;
    });
    check();
    window.addEventListener('scroll', check, { passive: true });
    return () => window.removeEventListener('scroll', check);
  }, [pinned]);

  // The browser tab shows the screen and the hospital, e.g. "Patients · Sunrise General Hospital" ("Perinexa" before a
  // hospital is chosen), so a computer shared by two hospitals shows which one is open. PRIVACY: the tab title is kept in the
  // browser's history, so never let patient-identifying text reach it – patient pages pass a generic
  // documentTitle ("Patient record"). documentTitle={false} leaves the tab title alone.
  const place = useAuth()?.activeMembership?.tenantName || 'Perinexa';
  const tabTitle = documentTitle === false ? null : (documentTitle ?? (typeof title === 'string' ? title : null));
  useEffect(() => {
    if (!tabTitle) return undefined;
    const before = document.title;
    document.title = `${tabTitle} · ${place}`;
    return () => {
      document.title = before;
    };
  }, [tabTitle, place]);

  const heading = (
    <div className="ph-heading">
      {/* A path of one step is only the page itself (the title says it): shown from two steps on */}
      {breadcrumbs.length > 1 && (
        <nav className="ph-crumbs" aria-label="Breadcrumb">
          <ol>
            {breadcrumbs.map((b, i) => (
              <li key={`${b.label}-${i}`}>
                {b.to && i < breadcrumbs.length - 1 ? <Link to={b.to}>{b.label}</Link> : <span aria-current={i === breadcrumbs.length - 1 ? 'page' : undefined}>{b.label}</span>}
                {i < breadcrumbs.length - 1 && <ChevronRight aria-hidden="true" />}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="ph-title-row">
        {/* Long names (e.g. a template's full name) use the smaller card-title size so they don't fill the screen */}
        <h1 className={`ph-title ${typeof title === 'string' && title.length > 36 ? 'ph-title-long' : ''}`}>{title}</h1>
        {badges && <span className="ph-badges">{badges}</span>}
        {subtitle && (
          <button type="button" className="icon-btn ph-info-btn" aria-label="About this page" aria-expanded={infoOpen} onClick={() => setInfoOpen(!infoOpen)}>
            <Info aria-hidden="true" />
          </button>
        )}
      </div>
      {caption && <p className="ph-caption">{caption}</p>}
    </div>
  );

  // A single tab adds nothing to navigate to, so tabs show only when there are two or more.
  const showTabs = tabs?.length > 1;
  const showSubtabs = subtabs?.length > 1;
  const inSection = (t) => [t.activeFor ?? []].flat().some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const jump = showTabs && tabs.length > 3;
  const isCurrent = (t) => (t.end ? pathname === t.to : pathname === t.to || pathname.startsWith(`${t.to}/`)) || inSection(t);
  const current = jump ? (tabs.filter(isCurrent).sort((a, b) => b.to.length - a.to.length)[0] ?? tabs[0]) : null;
  return (
    <>
      {slot && createPortal(heading, slot)}
      {(!slot || subtitle || help || actions || showTabs || showSubtabs) && (
        <>
        <header className={['ph', className, infoOpen && 'ph-info-open', pinned && 'ph-pinned', stuck && 'ph-stuck', jump && 'ph-has-jump', jumpOpen && 'ph-jump-open'].filter(Boolean).join(' ')}>
          {/* One row (owner, 13 Oct 2026): the title with its subtitle on the left, the buttons on the right */}
          {(!slot || subtitle || help || actions) && (
            <div className={slot ? 'ph-main' : 'ph-main ph-top'}>
              {(!slot || subtitle || help) && (
                <div className="ph-text">
                  {!slot && heading}
                  {subtitle && <p className="ph-subtitle">{subtitle}</p>}
                  {help && <p className="ph-subtitle help">{help}</p>}
                </div>
              )}
              {actions && <div className="ph-actions">{actions}</div>}
            </div>
          )}
          {jump && (
            <button type="button" className="ph-jump-btn" aria-expanded={jumpOpen} aria-controls="ph-sections" onClick={() => setJumpOpen(!jumpOpen)}>
              <span className="ph-jump-label">{current.label === title ? 'Other pages' : current.label}</span>
              <span className="ph-jump-more">{tabs.length} sections</span>
              <ChevronDown aria-hidden="true" />
            </button>
          )}
          {showTabs && (
            <nav className="ph-tabs segmented" id="ph-sections" aria-label="Sections">
              {tabs.map((t) =>
                t.menu ? (
                  <MenuButton key={t.to} label={t.label} icon={t.icon} items={t.menu} active={pathname === t.to || pathname.startsWith(`${t.to}/`)} />
                ) : t.activeFor ? (
                  <Link key={t.to} to={t.to} className={inSection(t) ? 'active' : ''} aria-current={inSection(t) ? 'page' : undefined}>
                    {t.icon && <t.icon aria-hidden="true" />}
                    {t.label}
                  </Link>
                ) : (
                  <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                    {t.icon && <t.icon aria-hidden="true" />}
                    {t.label}
                  </NavLink>
                ),
              )}
            </nav>
          )}
          {showSubtabs && (
            <nav className="ph-subtabs" aria-label="In this section">
              {subtabs.map((t) => (
                <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                  {t.label}
                </NavLink>
              ))}
            </nav>
          )}
        </header>
        </>
      )}
    </>
  );
}
