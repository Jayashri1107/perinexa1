// The frame of the sign-in pages (log in, choose a password, no hospital access), as in the owner's design (8 Oct 2026):
// a deep blue panel on the left – the logo, "Modern | Secure | Connected care", the headline, a short line that changes
// every few seconds (dots choose one), three features with round icons, three chips – and on wide screens a glowing
// circle with glass tiles floating on a dotted arc (stethoscope, heart, prescription, shield) and a glass caption card.
// The form card on the right, with faint "+" signs behind it.
// A photo put in src/assets/brand/ as login-photo.jpg (or .jpeg, .png, .webp) fills the circle (e.g. a doctor);
// otherwise it shows a stethoscope. On small screens the panel is hidden and the logo sits above the card. All still
// when the computer asks for reduced motion.
import { Baby, ClipboardList, HeartHandshake, HeartPulse, ShieldCheck, Stethoscope, Users, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import logo from '../assets/brand/perinexa-logo.png';
import logoReversed from '../assets/brand/perinexa-logo-reversed.png';
import { useAppConfig } from '../context/AppConfigContext.jsx';

const photos = import.meta.glob('../assets/brand/login-photo.{jpg,jpeg,png,webp}', { eager: true, import: 'default' });
const photo = Object.values(photos)[0] ?? null;
const EVERY_MS = 5000;

const LINES = [
  'A complete, easy-to-use hospital solution for better patient care, faster workflow and healthier communities.',
  'From OPD to discharge – appointments, prescriptions, lab and pharmacy in one place.',
  'Mother and baby care, followed from the first visit to the newborn’s check-ups.',
];
const FEATURES = [
  { icon: Zap, text: ['Prescribe', 'in seconds'] },
  { icon: Users, text: ['Mother & baby', 'care tracking'] },
  { icon: ShieldCheck, text: ['Secure', '& private'] },
];
const CHIPS = [
  { icon: Stethoscope, text: 'OPD' },
  { icon: Baby, text: 'Mother & Baby' },
  { icon: ShieldCheck, text: 'Private' },
];
// the glass tiles on the arc: icon, place (% of the picture area), float delay
const TILES = [
  { icon: Stethoscope, x: 6, y: 26, delay: 0 },
  { icon: HeartPulse, x: 40, y: 6, delay: 1.2, tone: 'heart' },
  { icon: ClipboardList, x: 8, y: 52, delay: 0.6, label: 'Rx' },
  { icon: ShieldCheck, x: 24, y: 72, delay: 1.8, tone: 'teal' },
];

function ChangingLine() {
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const t = setInterval(() => document.visibilityState === 'visible' && setAt((i) => (i + 1) % LINES.length), EVERY_MS);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <p key={at} className="auth-intro">{LINES[at]}</p>
      <div className="auth-dots">
        {LINES.map((l, i) => (
          <button key={l} type="button" aria-label={`Show line ${i + 1}`} aria-pressed={i === at} className={i === at ? 'is-on' : ''} onClick={() => setAt(i)} />
        ))}
      </div>
    </>
  );
}

function Visual() {
  return (
    <div className="auth-visual" aria-hidden>
      <svg className="auth-arc" viewBox="0 0 400 460" preserveAspectRatio="none">
        <path d="M150 20 C40 120 30 300 140 440" />
      </svg>
      <div className={`auth-orb${photo ? ' has-photo' : ''}`}>
        {photo ? <img src={photo} alt="" /> : <Stethoscope size={110} strokeWidth={1.4} />}
      </div>
      {TILES.map(({ icon: Icon, x, y, delay, tone, label }, i) => (
        <span key={i} className={`auth-tile${tone ? ` auth-tile-${tone}` : ''}`} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${delay}s` }}>
          <Icon size={26} strokeWidth={1.8} />
          {label && <b>{label}</b>}
        </span>
      ))}
      <div className="auth-caption">
        <HeartHandshake size={30} strokeWidth={1.6} />
        <span>Empowering doctors with simpler tools for a healthier tomorrow.</span>
        <i />
      </div>
    </div>
  );
}

// headIcon: a small tile at the top right of the card (the login uses a stethoscope)
export function AuthLayout({ title, subtitle, children, footer, headIcon: HeadIcon = Stethoscope }) {
  const { app } = useAppConfig();
  return (
    <div className="auth-shell">
      <aside className="auth-brand">
        <div className="auth-top auth-enter">
          <img className="auth-brand-logo" src={logoReversed} alt={app.name} width="170" height="41" />
          <span className="auth-tagline"><i aria-hidden /> Modern <span aria-hidden>|</span> Secure <span aria-hidden>|</span> Connected Care</span>
        </div>
        <div className="auth-hero">
          <div className="auth-copy">
            <h2 className="auth-headline auth-enter" style={{ '--i': 1 }}>Care, made simple <span>for doctors.</span></h2>
            <div className="auth-enter" style={{ '--i': 2 }}>
              <ChangingLine />
            </div>
            <ul className="auth-features">
              {FEATURES.map(({ icon: Icon, text }, n) => (
                <li key={text[0]} className="auth-enter" style={{ '--i': 3 + n }}>
                  <span className="auth-feature-icon"><Icon size={22} aria-hidden /></span>
                  <span>{text[0]}<br />{text[1]}</span>
                </li>
              ))}
            </ul>
          </div>
          <Visual />
        </div>
        <ul className="auth-chips auth-enter" style={{ '--i': 6 }}>
          {CHIPS.map(({ icon: Icon, text }) => (
            <li key={text}><Icon size={16} aria-hidden /> {text}</li>
          ))}
        </ul>
      </aside>

      <main className="auth-main">
        <span className="auth-plus auth-plus-1" aria-hidden />
        <span className="auth-plus auth-plus-2" aria-hidden />
        <div className="auth-panel">
          <img className="auth-mobile-logo" src={logo} alt={app.name} width="170" height="42" />
          <header className="auth-head">
            <div>
              <h1>{title}</h1>
              {subtitle && <p className="muted">{subtitle}</p>}
            </div>
            <span className="auth-head-icon" aria-hidden><HeadIcon size={24} /></span>
          </header>
          {children}
          {footer && <div className="auth-foot">{footer}</div>}
        </div>
        <p className="auth-notice">Fake sample data only.</p>
      </main>
    </div>
  );
}
