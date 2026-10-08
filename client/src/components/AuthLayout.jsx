// The frame of the sign-in pages (log in, choose a password, no hospital access): a calm indigo panel on the left, the
// form card on the right (owner, 8 Oct 2026: minimal sentences for doctors, small symbols, nothing crowded).
// The panel: the logo, a small stethoscope symbol with a soft pulse, one headline, one short line that changes every
// few seconds (each with its own icon; dots choose one) and three small chips. A photo put in src/assets/brand/ as
// login-photo.jpg (or .jpeg, .png, .webp) becomes the panel's background. On small screens the panel is hidden and the
// logo sits above the card. All still when the computer asks for reduced motion.
import { Baby, CalendarCheck, FlaskConical, HeartPulse, Pill, ShieldCheck, Stethoscope } from 'lucide-react';
import { useEffect, useState } from 'react';
import logo from '../assets/brand/perinexa-logo.png';
import logoReversed from '../assets/brand/perinexa-logo-reversed.png';
import { useAppConfig } from '../context/AppConfigContext.jsx';

const photos = import.meta.glob('../assets/brand/login-photo.{jpg,jpeg,png,webp}', { eager: true, import: 'default' });
const photo = Object.values(photos)[0] ?? null;
const EVERY_MS = 3500;

const LINES = [
  { icon: HeartPulse, text: 'Your patients, at a glance.' },
  { icon: CalendarCheck, text: 'Your OPD day, in order.' },
  { icon: Pill, text: 'Prescribe in seconds.' },
  { icon: FlaskConical, text: 'Results the moment they are ready.' },
];
const CHIPS = [
  { icon: Stethoscope, text: 'OPD' },
  { icon: Baby, text: 'Mother & baby' },
  { icon: ShieldCheck, text: 'Private' },
];

// One short line at a time, gliding up as the next comes in.
function RotatingLine() {
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const t = setInterval(() => document.visibilityState === 'visible' && setAt((i) => (i + 1) % LINES.length), EVERY_MS);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="auth-rotator">
      <div className="auth-rotator-window" aria-live="polite">
        {LINES.map(({ icon: Icon, text }, i) => (
          <p key={text} className={`auth-rotator-line${i === at ? ' is-on' : i === (at + LINES.length - 1) % LINES.length ? ' is-out' : ''}`} aria-hidden={i !== at}>
            <span className="auth-rotator-icon"><Icon size={18} aria-hidden /></span>
            {text}
          </p>
        ))}
      </div>
      <div className="auth-dots">
        {LINES.map((l, i) => (
          <button key={l.text} type="button" aria-label={l.text} aria-pressed={i === at} className={i === at ? 'is-on' : ''} onClick={() => setAt(i)} />
        ))}
      </div>
    </div>
  );
}

export function AuthLayout({ title, subtitle, children, footer }) {
  const { app } = useAppConfig();
  return (
    <div className="auth-shell">
      <aside className={`auth-brand${photo ? ' has-photo' : ''}`}>
        {photo && <img className="auth-photo" src={photo} alt="" />}
        <img className="auth-brand-logo auth-enter" src={logoReversed} alt={app.name} width="170" height="41" />
        <div className="auth-brand-body">
          <span className="auth-symbol auth-enter" style={{ '--i': 1 }} aria-hidden>
            <Stethoscope size={30} />
          </span>
          <h2 className="auth-headline auth-enter" style={{ '--i': 2 }}>Care, made simple for doctors.</h2>
          <div className="auth-enter" style={{ '--i': 3 }}>
            <RotatingLine />
          </div>
        </div>
        <ul className="auth-chips auth-enter" style={{ '--i': 4 }}>
          {CHIPS.map(({ icon: Icon, text }) => (
            <li key={text}><Icon size={14} aria-hidden /> {text}</li>
          ))}
        </ul>
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
