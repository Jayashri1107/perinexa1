import { Hospital } from 'lucide-react';

// The hospital letterhead for the top of this hospital's printed documents.
// Printed pages stay print-friendly: dark text on white, Jost (Mukta for Hindi/Marathi), an indigo rule.
// The hospital's own logo when the admin has added one (owner, 27 Oct 2026), else a plain hospital mark.
// centered: the name and address in the middle with the logo on the left – the hospital's bills and receipts.
export function Letterhead({ letterhead, centered = false }) {
  const lh = letterhead ?? {};
  const contact = [lh.phone && `Phone: ${lh.phone}`, lh.email && `Email: ${lh.email}`].filter(Boolean).join('  ·  ');
  return (
    <header className={centered ? 'lh lh-centered' : 'lh'}>
      {lh.logo ? (
        <img className="lh-logo" src={lh.logo} alt="" />
      ) : (
        <div className="lh-mark" aria-hidden="true">
          <Hospital />
        </div>
      )}
      <div className="lh-text">
        <div className="lh-name">{lh.name || 'Hospital name'}</div>
        {lh.tagline && <div className="lh-tagline">{lh.tagline}</div>}
        {lh.address && <div className="lh-line">{lh.address}</div>}
        {contact && <div className="lh-line">{contact}</div>}
      </div>
      {lh.registrationNumber && <div className="lh-reg">Reg. No. {lh.registrationNumber}</div>}
    </header>
  );
}

export function LetterheadFooter({ letterhead }) {
  if (!letterhead?.footer) return null;
  return <footer className="lh-footer">{letterhead.footer}</footer>;
}

// Doctor's signature block: name, qualification and registration number.
export function DoctorSignature({ user }) {
  const p = user?.professional ?? {};
  return (
    <div className="lh-sign">
      <div className="lh-sign-line" />
      <strong className="lh-sign-name">{user?.name}</strong>
      {p.qualification && <div>{p.qualification}</div>}
      {p.registrationNumber && (
        <div className="tabular">
          Reg. No. {p.registrationNumber}
          {p.council ? ` (${p.council})` : ''}
        </div>
      )}
    </div>
  );
}
