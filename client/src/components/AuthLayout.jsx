// The frame of the sign-in pages (log in, choose a password, no hospital access) – simple, as the owner's reference
// (8 Oct 2026): the form on a white left side under the logo; on the right a soft teal panel with the logo in the
// middle and a ring of small hospital icons around it. The icons pop in one by one, then the ring turns slowly (each
// icon stays upright); the middle pulses softly. All still when the computer asks for reduced motion. On small screens
// the panel is hidden.
import { Accessibility, Ambulance, Baby, BedDouble, ClipboardList, FlaskConical, HeartPulse, Microscope, Pill, Stethoscope, Syringe, Thermometer } from 'lucide-react';
import logo from '../assets/brand/perinexa-logo.png';
import { useAppConfig } from '../context/AppConfigContext.jsx';

const RING = [Stethoscope, HeartPulse, BedDouble, Pill, Ambulance, Syringe, Baby, Microscope, Accessibility, Thermometer, FlaskConical, ClipboardList];

function IconRing({ name }) {
  return (
    <div className="auth-ring-wrap" aria-hidden>
      <div className="auth-ring">
        {RING.map((Icon, i) => (
          <span key={i} className="auth-ring-item" style={{ '--a': `${(360 / RING.length) * i}deg`, '--i': i }}>
            <span className="auth-ring-icon"><Icon size={22} strokeWidth={1.8} /></span>
          </span>
        ))}
      </div>
      <div className="auth-ring-centre">
        <img src={logo} alt="" width="170" height="42" />
        <span>{name}</span>
      </div>
    </div>
  );
}

export function AuthLayout({ title, subtitle, children, footer }) {
  const { app } = useAppConfig();
  return (
    <div className="auth-shell">
      <main className="auth-main">
        <div className="auth-panel">
          <img className="auth-form-logo auth-enter" src={logo} alt={app.name} width="170" height="42" />
          <header className="auth-head auth-enter" style={{ '--i': 1 }}>
            <h1>{title}</h1>
            {subtitle && <p className="muted">{subtitle}</p>}
          </header>
          <div className="auth-enter" style={{ '--i': 2 }}>{children}</div>
          {footer && <div className="auth-foot">{footer}</div>}
        </div>
        <p className="auth-notice">© {new Date().getFullYear()} {app.name} · Fake sample data only.</p>
      </main>
      <aside className="auth-brand">
        <IconRing name="Hospital management" />
        <p className="auth-brand-line auth-enter" style={{ '--i': 4 }}>Care, made simple for doctors.</p>
      </aside>
    </div>
  );
}
