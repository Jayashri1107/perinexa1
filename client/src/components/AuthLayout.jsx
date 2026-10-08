// The frame of the sign-in pages (log in, choose a password, no hospital access): a picture panel on the left, the form
// card on the right (owner, 8 Oct 2026: minimal words, attractive, things that slide).
// The panel: the logo, then three slides that glide past by themselves (a drawn picture and a few words each – care,
// appointments, pharmacy), dots to choose one, and small "+" signs and dots floating up behind. Sliding pauses while the
// mouse is over it or the tab is hidden. A photo put in src/assets/brand/ as login-photo.jpg (or .jpeg, .png, .webp)
// becomes the panel's background. On small screens the panel is hidden and the logo sits above the card. All still
// when the computer asks for reduced motion.
import { useEffect, useState } from 'react';
import logo from '../assets/brand/perinexa-logo.png';
import logoReversed from '../assets/brand/perinexa-logo-reversed.png';
import { useAppConfig } from '../context/AppConfigContext.jsx';

const photos = import.meta.glob('../assets/brand/login-photo.{jpg,jpeg,png,webp}', { eager: true, import: 'default' });
const photo = Object.values(photos)[0] ?? null;
const EVERY_MS = 4500;

// ---------- The drawn pictures (decoration only; white lines, teal accents) ----------

function Halo() {
  return (
    <>
      <circle className="art-halo" cx="200" cy="200" r="168" />
      <circle className="art-halo art-halo-teal" cx="200" cy="200" r="118" />
    </>
  );
}

function CareArt() {
  return (
    <svg className="auth-art" viewBox="0 0 400 400" aria-hidden focusable="false">
      <Halo />
      <g className="art-line">
        <path d="M150 70 C150 135 172 172 200 205" />
        <path d="M250 70 C250 135 228 172 200 205" />
        <path d="M200 205 L200 248 C200 318 292 322 292 268 L292 258" />
        <circle cx="292" cy="236" r="26" />
      </g>
      <circle className="art-dot" cx="150" cy="62" r="9" />
      <circle className="art-dot" cx="250" cy="62" r="9" />
      <circle className="art-dot art-pulse" cx="292" cy="236" r="12" />
      <path className="art-beat" d="M20 330 H120 L136 300 L154 362 L172 282 L190 330 H380" />
    </svg>
  );
}

function CalendarArt() {
  return (
    <svg className="auth-art" viewBox="0 0 400 400" aria-hidden focusable="false">
      <Halo />
      <g className="art-line">
        <rect x="95" y="105" width="190" height="180" rx="22" />
        <path d="M95 155 H285" />
        <path d="M140 85 V125 M240 85 V125" />
      </g>
      <g className="art-soft">
        <rect x="122" y="180" width="26" height="22" rx="6" />
        <rect x="177" y="180" width="26" height="22" rx="6" />
        <rect x="122" y="225" width="26" height="22" rx="6" />
      </g>
      <rect className="art-dot" x="232" y="180" width="26" height="22" rx="6" />
      <g className="art-clock">
        <circle className="art-clock-face" cx="290" cy="280" r="46" />
        <path className="art-hand art-hand-spin" d="M290 280 V252" />
        <path className="art-hand" d="M290 280 H310" />
      </g>
      <path className="art-check" d="M172 236 L188 252 L214 222" />
    </svg>
  );
}

function PharmacyArt() {
  return (
    <svg className="auth-art" viewBox="0 0 400 400" aria-hidden focusable="false">
      <Halo />
      <g className="art-line">
        <rect x="110" y="140" width="110" height="160" rx="18" />
        <path d="M125 140 V115 H205 V140" />
        <path d="M165 190 V250 M135 220 H195" />
      </g>
      <g className="art-capsule" transform="rotate(-35 284 172)">
        <path className="art-dot" d="M258 150 H284 V194 H258 A22 22 0 0 1 258 150 Z" />
        <rect className="art-capsule-shell" x="236" y="150" width="96" height="44" rx="22" />
      </g>
      <circle className="art-dot art-float" cx="270" cy="262" r="14" />
      <circle className="art-dot art-float art-float-late" cx="306" cy="232" r="9" />
      <path className="art-beat" d="M60 340 H340" />
    </svg>
  );
}

const SLIDES = [
  { key: 'care', art: CareArt, line: 'Calm, connected care.' },
  { key: 'appointments', art: CalendarArt, line: 'Every appointment, on time.' },
  { key: 'pharmacy', art: PharmacyArt, line: 'Prescriptions, straight to pharmacy.' },
];

// Small "+" signs and dots drifting up behind the slides: [left %, size px, seconds, delay s, kind]
const FLOATERS = [
  [8, 18, 14, 0, 'plus'], [22, 8, 11, 3, 'dot'], [38, 14, 16, 6, 'plus'], [55, 6, 12, 1, 'dot'],
  [68, 20, 18, 4, 'plus'], [82, 10, 13, 8, 'dot'], [92, 14, 15, 2, 'plus'], [30, 6, 10, 9, 'dot'],
];

function Slides() {
  const [at, setAt] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const t = setInterval(() => document.visibilityState === 'visible' && setAt((i) => (i + 1) % SLIDES.length), EVERY_MS);
    return () => clearInterval(t);
  }, [paused]);
  return (
    <div className="auth-slides" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="auth-track" style={{ transform: `translateX(-${at * 100}%)` }}>
        {SLIDES.map(({ key, art: Art, line }, i) => (
          <figure key={key} className={`auth-slide${i === at ? ' is-on' : ''}`} aria-hidden={i !== at}>
            <Art />
            <figcaption className="auth-line">{line}</figcaption>
          </figure>
        ))}
      </div>
      <div className="auth-dots" role="tablist" aria-label="Slides">
        {SLIDES.map((s, i) => (
          <button key={s.key} type="button" role="tab" aria-selected={i === at} aria-label={s.line} className={i === at ? 'is-on' : ''} onClick={() => setAt(i)} />
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
        <div className="auth-floaters" aria-hidden>
          {FLOATERS.map(([left, size, secs, delay, kind], i) => (
            <span key={i} className={`auth-floater auth-floater-${kind}`} style={{ left: `${left}%`, '--s': `${size}px`, animationDuration: `${secs}s`, animationDelay: `-${delay}s` }} />
          ))}
        </div>
        <img className="auth-brand-logo auth-enter" src={logoReversed} alt={app.name} width="190" height="46" />
        <Slides />
      </aside>

      <main className="auth-main">
        <span className="auth-orbit" aria-hidden />
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
