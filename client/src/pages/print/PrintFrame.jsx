// A printable page (A5) with the hospital's letterhead; opens the print dialog once loaded.
import { Printer } from 'lucide-react';
import { useEffect } from 'react';

export function Letterhead({ letterhead = {}, hospitalName, extra }) {
  return (
    <header className="print-head">
      <div>
        <div className="print-name">{letterhead.name || hospitalName}</div>
        {letterhead.tagline && <div>{letterhead.tagline}</div>}
        {letterhead.address && <div>{letterhead.address}</div>}
        <div>{[letterhead.phone, letterhead.email].filter(Boolean).join(' · ')}</div>
        {letterhead.registrationNumber && <div>Reg. no. {letterhead.registrationNumber}</div>}
      </div>
      {extra}
    </header>
  );
}

export function PrintFrame({ ready, title, children, footer }) {
  useEffect(() => {
    if (ready) {
      document.title = title;
      const t = setTimeout(() => window.print(), 300);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [ready, title]);

  return (
    <div className="print-page">
      <div className="no-print print-actions">
        <button type="button" className="btn btn-primary" onClick={() => window.print()}><Printer size={16} aria-hidden /> Print</button>
        <button type="button" className="btn btn-ghost" onClick={() => window.close()}>Close</button>
      </div>
      <article className="print-sheet">
        {children}
        {footer && <footer className="print-foot">{footer}</footer>}
      </article>
    </div>
  );
}
