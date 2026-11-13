import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { formatDateTime } from '../ui.jsx';
import { Letterhead } from './Letterhead.jsx';
import { StoreHead } from './StoreHead.jsx';

// The header on paper when a screen of the app is printed with the browser's Print (Ctrl+P) – the patient's
// Pregnancies, Scores, Specimens or Anaesthesia tab, for example. Hidden on screen. The hospital's letterhead at the
// fixed print size, then who printed it and when; the page's own heading (her name and patient no. on her record)
// follows below it. Documents made for printing (care plans, bills, prescriptions) use the print preview instead,
// which hides the app and this header altogether.
// A pharmacy screen (13 Nov 2026) carries the pharmacy store's heading instead of the hospital's – the same name block
// as on every pharmacy bill (the hospital's when the store's can't be read, e.g. a nurse on a ward-store page).
export function PagePrintHead() {
  const { user, activeTenantId } = useAuth();
  const store = useLocation().pathname.startsWith('/pharmacy');
  const { data } = useFetch(activeTenantId ? '/tenant/settings/letterhead' : null);
  const pharmacy = useFetch(activeTenantId && store ? '/pharmacy/settings' : null).data;
  const [at, setAt] = useState(() => new Date().toISOString());
  // The time it is printed, not the time the page was opened
  useEffect(() => {
    const now = () => setAt(new Date().toISOString());
    window.addEventListener('beforeprint', now);
    return () => window.removeEventListener('beforeprint', now);
  }, []);
  if (!activeTenantId) return null;
  return (
    <div className="page-print-head pdoc" aria-hidden="true">
      {pharmacy?.settings ? <StoreHead settings={pharmacy.settings} /> : <Letterhead letterhead={data?.letterhead ?? { name: data?.hospitalName }} />}
      <p className="page-print-meta">{`Printed ${formatDateTime(at)}${user?.name ? ` by ${user.name}` : ''}`}</p>
    </div>
  );
}
