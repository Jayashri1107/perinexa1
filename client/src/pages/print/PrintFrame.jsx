// A printable page with the hospital's letterhead; opens the print dialog once loaded. A5 by default; `size="A4"` for
// the discharge card and the bill (owner, 9 Oct 2026 – as the hospital's own printed forms).
import { Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiUrl } from '../../api/http.js';
import { useAuth } from '../../context/AuthContext.jsx';

// The letterhead (owner, 9 Oct 2026, from the hospital's printed forms): a ruled box – the logo on the left, the name
// large and bold, then the address, "Mob." and "E-mail" lines – all from Hospital admin → Print letterhead.
export function Letterhead({ letterhead = {}, hospitalName, extra }) {
  const { activeHospitalId } = useAuth();
  const [logoOk, setLogoOk] = useState(true);
  // the hospital in the address too: each hospital's logo is its own in the browser's memory
  const logo = letterhead.logoVersion > 0 && logoOk ? apiUrl(`/hospital/logo?h=${activeHospitalId}&v=${letterhead.logoVersion}`) : null;
  return (
    <>
      <header className="print-head lh-box">
        {logo && <img className="lh-logo" src={logo} alt="" onError={() => setLogoOk(false)} />}
        <div className="lh-text">
          <div className="print-name lh-name">{letterhead.name || hospitalName}</div>
          {letterhead.tagline && <div className="lh-tagline">{letterhead.tagline}</div>}
          {letterhead.address && <div className="lh-line">{letterhead.address}</div>}
          {(letterhead.phone || letterhead.email) && (
            <div className="lh-line">{[letterhead.phone && `Mob.: ${letterhead.phone}`, letterhead.email && `E-mail: ${letterhead.email}`].filter(Boolean).join(', ')}</div>
          )}
          {letterhead.registrationNumber && <div className="lh-line">Reg. no. {letterhead.registrationNumber}</div>}
        </div>
      </header>
      {extra}
    </>
  );
}

// "DISCHARGE CARD" in a dark band on the left, the date on the right (under the letterhead).
export function DocTitle({ children, right }) {
  return (
    <div className="lh-title-row">
      <span className="lh-title">{children}</span>
      {right && <span className="lh-title-right">{right}</span>}
    </div>
  );
}

// Shown inside a pop-up (PrintPreviewModal) the page is a preview: no print dialog by itself, and the pop-up has the
// Print and Close buttons.
const embedded = typeof window !== 'undefined' && window.self !== window.top;

export function PrintFrame({ ready, title, children, footer, size = 'A5' }) {
  useEffect(() => {
    if (ready && embedded) {
      document.title = title;
      return undefined;
    }
    if (ready) {
      document.title = title;
      const t = setTimeout(() => window.print(), 300);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [ready, title]);

  return (
    <div className="print-page">
      <div className={`no-print print-actions${embedded ? ' hidden' : ''}`}>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}><Printer size={16} aria-hidden /> Print</button>
        <button type="button" className="btn btn-ghost" onClick={() => window.close()}>Close</button>
      </div>
      <article className={`print-sheet${size === 'A4' ? ' sheet-a4' : ''}`}>
        {children}
        {footer && <footer className="print-foot">{footer}</footer>}
      </article>
    </div>
  );
}
