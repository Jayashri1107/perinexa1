import { createContext, useContext, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
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
 */
export function PageHeader({ breadcrumbs = [], title, subtitle, help, badges, actions, tabs, subtabs, documentTitle }) {
  const slot = useContext(TitleSlotContext);
  const { pathname } = useLocation();

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
      </div>
    </div>
  );

  // A single tab adds nothing to navigate to, so tabs show only when there are two or more.
  const showTabs = tabs?.length > 1;
  const showSubtabs = subtabs?.length > 1;
  const inSection = (t) => [t.activeFor ?? []].flat().some((p) => pathname === p || pathname.startsWith(`${p}/`));
  return (
    <>
      {slot ? createPortal(heading, slot) : <div className="ph">{heading}</div>}
      {(subtitle || help || actions || showTabs || showSubtabs) && (
        <header className="ph">
          {(subtitle || help || actions) && (
            <div className="ph-main">
              {subtitle && <p className="ph-subtitle">{subtitle}</p>}
              {help && <p className="ph-subtitle help">{help}</p>}
              {actions && <div className="ph-actions">{actions}</div>}
            </div>
          )}
          {showTabs && (
            <nav className="ph-tabs segmented" aria-label="Sections">
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
      )}
    </>
  );
}
