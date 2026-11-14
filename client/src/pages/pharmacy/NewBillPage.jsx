import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { InvoicesPage } from './InvoicesPage.jsx';
import { SellPage } from './SellPage.jsx';

// The Sales bill page (14 Nov 2026, the developer: one screen to search, bill and see the bills): the Bill list's
// screen – the Search patient panel on the left (patient type, first, middle and last name, mobile, UHID, dates), the
// day's bills or the people found on the right. A name clicked starts that person's bill here (someone admitted now
// gets an issue to the ward); New walk-in customer starts an External bill. Close goes back to the list; a bill saved
// comes back to it with its print preview open. Coming from Today or the register with someone chosen, the bill opens.

export function NewBillPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const routed = location.state;
  const [start, setStart] = useState(() => (routed?.patient || routed?.type === 'external' ? routed : null));
  const [n, setN] = useState(0); // a new bill each time someone is chosen

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
    setStart(next);
    setN((x) => x + 1);
  };
  const back = () => {
    setStart(null);
    setN((x) => x + 1);
    if (routed) navigate('.', { replace: true, state: null });
  };
  const onPick = async (x) => {
    if (!x.mrn) return choose({ type: 'external', customer: { name: x.name, phone: x.phone ?? '' } });
    const patient = { id: x.key, fullName: x.name, mrn: x.mrn };
    try {
      const { inpatients } = await api('/pharmacy/inpatients');
      if (inpatients.some((s) => s.patient.id === x.key)) return navigate('/pharmacy/issue', { state: { patient } });
    } catch {
      // the counter sale is still right for someone not known to be admitted
    }
    return choose({ patient });
  };

  if (!start) return <InvoicesPage key={`list-${n}`} pick={{ onPick, onWalkIn: () => choose({ type: 'external' }) }} />;
  return <SellPage key={`bill-${n}`} kind="sale" start={start} fromList onCancel={back} />;
}
