// The frame of the sign-in pages (log in, choose a password, no hospital access) – as hospital sign-in pages usually
// look (owner, 8 Oct 2026): a photo on the left with a soft indigo shade, the logo at the top and, at the bottom, one
// headline, one short line and three small chips; on the right a clean white sign-in area. No drawings or floating boxes.
// The photo: client/src/assets/brand/login-photo.jpg (or .jpeg, .png, .webp) – a plain indigo panel until there is one.
// On small screens the panel is hidden and the logo sits above the form.
import { Baby, ShieldCheck, Stethoscope } from 'lucide-react';
import logo from '../assets/brand/perinexa-logo.png';
import logoReversed from '../assets/brand/perinexa-logo-reversed.png';
import { useAppConfig } from '../context/AppConfigContext.jsx';

const photos = import.meta.glob('../assets/brand/login-photo.{jpg,jpeg,png,webp}', { eager: true, import: 'default' });
const photo = Object.values(photos)[0] ?? null;

const CHIPS = [
  { icon: Stethoscope, text: 'OPD & wards' },
  { icon: Baby, text: 'Mother & baby care' },
  { icon: ShieldCheck, text: 'Private & secure' },
];

// headIcon: kept for the pages that pass one (not shown in this design)
export function AuthLayout({ title, subtitle, children, footer }) {
  const { app } = useAppConfig();
  return (
    <div className="auth-shell">
      <aside className={`auth-brand${photo ? ' has-photo' : ''}`}>
        {photo && <img className="auth-photo" src={photo} alt="" />}
        <img className="auth-brand-logo auth-enter" src={logoReversed} alt={app.name} width="170" height="41" />
        <div className="auth-brand-foot auth-enter" style={{ '--i': 2 }}>
          <h2 className="auth-headline">Care, made simple <span>for doctors.</span></h2>
          <p className="auth-intro">Appointments, prescriptions, wards, lab, pharmacy and billing – one calm place for the whole hospital.</p>
          <ul className="auth-chips">
            {CHIPS.map(({ icon: Icon, text }) => (
              <li key={text}><Icon size={15} aria-hidden /> {text}</li>
            ))}
          </ul>
        </div>
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
        <p className="auth-notice">© {new Date().getFullYear()} {app.name} · Fake sample data only.</p>
      </main>
    </div>
  );
}
