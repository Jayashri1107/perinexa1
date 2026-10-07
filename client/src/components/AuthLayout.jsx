// The frame of the sign-in pages (log in, choose a password, no hospital access): an indigo brand panel on the left
// with what the platform does, the form card on the right. On small screens the brand panel is hidden and the logo
// sits above the card.
import logo from '../assets/brand/perinexa-logo.png';
import logoReversed from '../assets/brand/perinexa-logo-reversed.png';
import { AUTH_HEADLINE, AUTH_INTRO, AUTH_POINTS } from '../config/authContent.js';
import { useAppConfig } from '../context/AppConfigContext.jsx';

export function AuthLayout({ title, subtitle, children, footer }) {
  const { app } = useAppConfig();
  const year = new Date().getFullYear();
  return (
    <div className="auth-shell">
      <aside className="auth-brand">
        <span className="auth-glow auth-glow-1" aria-hidden />
        <span className="auth-glow auth-glow-2" aria-hidden />
        <img className="auth-brand-logo" src={logoReversed} alt={app.name} width="190" height="46" />
        <div className="auth-brand-body">
          <span className="auth-kicker">{app.tagline}</span>
          <h2>{AUTH_HEADLINE}</h2>
          <p>{AUTH_INTRO}</p>
          <ul className="auth-points">
            {AUTH_POINTS.map(({ icon: Icon, title: t, text }) => (
              <li key={t}>
                <span className="auth-point-icon" aria-hidden><Icon size={18} /></span>
                <span>
                  <strong className="block">{t}</strong>
                  <span>{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="auth-brand-foot">© {year} {app.name}</p>
      </aside>

      <main className="auth-main">
        <div className="auth-panel">
          <img className="auth-mobile-logo" src={logo} alt={app.name} width="170" height="42" />
          <header className="auth-head">
            <h1>{title}</h1>
            {subtitle && <p className="muted">{subtitle}</p>}
          </header>
          {children}
          {footer && <div className="auth-foot">{footer}</div>}
        </div>
        <p className="auth-notice">Use fake sample data only until the app has been reviewed for real patients.</p>
      </main>
    </div>
  );
}
