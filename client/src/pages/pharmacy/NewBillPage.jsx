import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { InvoicesPage } from './InvoicesPage.jsx';
import { SellPage } from './SellPage.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { draftOwner, findDraft } from './billDraft.js';

// The Sales bill page (14 Nov 2026, the developer: one screen to search, bill and see the bills): the Bill list's
// screen – the Search patient panel on the left (patient type, first, middle and last name, mobile, UHID, dates), the
// day's bills or the people found on the right. A name clicked starts that person's bill here (someone admitted now
// gets an issue to the ward); New walk-in customer starts an External bill. Close goes back to the list; a bill saved
// comes back to it with its print preview open. Coming from Today or the register with someone chosen, the bill opens.

export function NewBillPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const routed = location.state;
  const { user, activeTenantId } = useAuth();
  // 18 Nov 2026: a bill left half made opens again as it was (billDraft.js) – unless someone else was chosen
  const [start, setStart] = useState(() => (routed?.patient || routed?.type === 'external' ? routed : !routed?.made && findDraft('sale', draftOwner(user, activeTenantId)) ? { resume: true } : null));
  const [n, setN] = useState(0); // a new bill each time someone is chosen
  // 18 Nov 2026 (the pharmacy's request): medicines scanned on the first page wait here and go on the next bill started
  const [scanned, setScanned] = useState([]);

  // A bill just saved comes back here (this same page) with its print preview: the list shows again. Not on the
  // page's first load (the start above has read it already).
  const firstKey = useRef(location.key);
  useEffect(() => {
    if (location.key === firstKey.current) return;
    if (routed?.made) {
      setStart(null);
      setN((x) => x + 1);
    } else if (routed?.patient || routed?.type === 'external') {
      setStart(routed);
      setN((x) => x + 1);
    }
  }, [location.key]);

  const choose = (next) => {
    setStart(scanned.length ? { ...next, scanned } : next);
    setScanned([]);
    setN((x) => x + 1);
  };
  const back = () => {
    setStart(null);
    setN((x) => x + 1);
    if (routed) navigate('.', { replace: true, state: null });
  };
  const onPick = async (x) => {
    if (!x.mrn) return choose({ type: 'external', customer: { name: x.name, phone: x.phone ?? '' } });
    const patient = { id: x.key, fullName: x.name, mrn: x.mrn, doctor: x.doctor ?? '' };
    try {
      const { inpatients } = await api('/pharmacy/inpatients');
      if (inpatients.some((s) => s.patient.id === x.key)) return navigate('/pharmacy/issue', { state: { patient, ...(scanned.length ? { scanned } : {}) } });
    } catch {
      // the counter sale is still right for someone not known to be admitted
    }
    return choose({ patient });
  };

  const onScan = (m) => {
    if (!m.active) return { error: `${m.name} is no longer in use (Medicines → Use again).` };
    if (scanned.some((x) => x.id === m.id)) return `${m.name} is already waiting for the bill.`;
    setScanned((xs) => [...xs, m]);
    return `${m.name} will go on the next bill – choose the patient or a walk-in customer.`;
  };
  if (!start) return <InvoicesPage key={`list-${n}`} pick={{ onPick, onWalkIn: () => choose({ type: 'external' }), onScan, scanned, clearScanned: () => setScanned([]) }} />;
  return <SellPage key={`bill-${n}`} kind="sale" start={start} fromList onCancel={back} />;
}
