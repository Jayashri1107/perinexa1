// The frame of the sign-in pages (log in, choose a password, no hospital access): a brand panel on the left,
// the form card on the right. On small screens the brand panel shrinks to a strip above the card.
import logo from '../assets/brand/perinexa-logo.png';
import logoReversed from '../assets/brand/perinexa-logo-reversed.png';
import { AUTH_HEADLINE, AUTH_INTRO, AUTH_POINTS } from '../config/authContent.js';
import { useAppConfig } from '../context/AppConfigContext.jsx';

// A quiet heartbeat line, drawn behind the brand panel's text.
function Pulse() {
  return (
    <svg className="auth-pulse" viewBox="0 0 600 120" preserveAspectRatio="none" aria-hidden>
      <path d="M0 60 H170 L190 60 L205 25 L222 98 L240 10 L258 84 L272 60 H600" />
    </svg>
  );
}

export function AuthLayout({ title, subtitle, children, footer }) {
  const { app } = useAppConfig();
  const year = new Date().getFullYear();
  return (
    <div className="auth-shell">
      <aside className="auth-brand">
        <img className="auth-brand-logo" src={logoReversed} alt={app.name} width="200" height="49" />
        <div className="auth-brand-body">
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
        <Pulse />
        <p className="auth-brand-foot">© {year} {app.name} · {app.tagline}</p>
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
