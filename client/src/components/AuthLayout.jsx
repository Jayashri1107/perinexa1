// The frame of the sign-in pages (log in, choose a password, no hospital access): a picture panel on the left, the form
// card on the right. Kept simple on purpose (owner, 8 Oct 2026): the logo, one short line and a picture – no lists.
// The picture: a photo when one is put in src/assets/brand/ as login-photo.jpg (or .jpeg, .png, .webp) – otherwise a
// drawn stethoscope with a heartbeat line that draws itself in. On small screens the panel is hidden and the logo sits
// above the card. Still when the computer asks for reduced motion.
import logo from '../assets/brand/perinexa-logo.png';
import logoReversed from '../assets/brand/perinexa-logo-reversed.png';
import { useAppConfig } from '../context/AppConfigContext.jsx';

const photos = import.meta.glob('../assets/brand/login-photo.{jpg,jpeg,png,webp}', { eager: true, import: 'default' });
const photo = Object.values(photos)[0] ?? null;

// A stethoscope and a heartbeat line, drawn in white and teal on the indigo panel (decoration only).
function Illustration() {
  return (
    <svg className="auth-art" viewBox="0 0 400 400" aria-hidden focusable="false">
      <circle className="auth-art-halo" cx="200" cy="200" r="170" />
      <circle className="auth-art-halo auth-art-halo-2" cx="200" cy="200" r="120" />
      <g className="auth-art-scope">
        <path d="M150 70 C150 135 172 172 200 205" />
        <path d="M250 70 C250 135 228 172 200 205" />
        <circle cx="150" cy="62" r="9" className="auth-art-fill" />
        <circle cx="250" cy="62" r="9" className="auth-art-fill" />
        <path d="M200 205 L200 248 C200 318 292 322 292 268 L292 258" />
        <circle cx="292" cy="236" r="26" />
        <circle cx="292" cy="236" r="12" className="auth-art-fill" />
      </g>
      <path className="auth-art-beat" d="M20 330 H120 L136 300 L154 362 L172 282 L190 330 H380" />
    </svg>
  );
}

export function AuthLayout({ title, subtitle, children, footer }) {
  const { app } = useAppConfig();
  return (
    <div className="auth-shell">
      <aside className={`auth-brand${photo ? ' has-photo' : ''}`}>
        {photo ? <img className="auth-photo" src={photo} alt="" /> : <Illustration />}
        <img className="auth-brand-logo auth-enter" src={logoReversed} alt={app.name} width="190" height="46" />
        <p className="auth-line auth-enter" style={{ '--i': 2 }}>Calm, connected care.</p>
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
        <p className="auth-notice">Fake sample data only.</p>
      </main>
    </div>
  );
}
