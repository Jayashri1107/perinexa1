// The frame of the sign-in pages (log in, choose a password, no hospital access): an indigo brand panel on the left
// with what the platform does, the form card on the right. On small screens the brand panel is hidden and the logo
// sits above the card.
// The look (owner, 8 Oct 2026): the panel and the card glide in, the points one after another, soft rings drift
// behind, and two small sample cards float beside the form (wide screens only). No gradients; all still when the
// computer asks for reduced motion. The sample cards are made-up examples – never real data.
import { BellRing, Pill } from 'lucide-react';
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
        <span className="auth-ring auth-ring-1" aria-hidden />
        <span className="auth-ring auth-ring-2" aria-hidden />
        <span className="auth-ring auth-ring-3" aria-hidden />
        <img className="auth-brand-logo auth-enter" src={logoReversed} alt={app.name} width="190" height="46" />
        <div className="auth-brand-body">
          <span className="auth-kicker auth-enter" style={{ '--i': 1 }}>{app.tagline}</span>
          <h2 className="auth-enter" style={{ '--i': 2 }}>{AUTH_HEADLINE}</h2>
          <p className="auth-enter" style={{ '--i': 3 }}>{AUTH_INTRO}</p>
          <ul className="auth-points">
            {AUTH_POINTS.map(({ icon: Icon, title: t, text }, n) => (
              <li key={t} className="auth-enter" style={{ '--i': 4 + n }}>
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
        <span className="auth-ring auth-ring-soft-1" aria-hidden />
        <span className="auth-ring auth-ring-soft-2" aria-hidden />
        <div className="auth-stage">
          <div className="auth-float auth-float-1" aria-hidden>
            <span className="auth-float-icon"><BellRing size={16} /></span>
            <span>
              <strong>Your day today</strong>
              <small>4 appointments · 1 waiting</small>
            </span>
          </div>
          <div className="auth-float auth-float-2" aria-hidden>
            <span className="auth-float-icon auth-float-icon-teal"><Pill size={16} /></span>
            <span>
              <strong>Prescription to give</strong>
              <small>Sent to the pharmacy</small>
            </span>
          </div>
          <div className="auth-panel">
            <img className="auth-mobile-logo" src={logo} alt={app.name} width="170" height="42" />
            <header className="auth-head">
              <h1>{title}</h1>
              {subtitle && <p className="muted">{subtitle}</p>}
            </header>
            {children}
            {footer && <div className="auth-foot">{footer}</div>}
          </div>
        </div>
        <p className="auth-notice">Use fake sample data only until the app has been reviewed for real patients.</p>
      </main>
    </div>
  );
}
