import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { InvoicesPage } from './InvoicesPage.jsx';
import { SellPage } from './SellPage.jsx';

// The Sales bill page's New bill tab (9 Nov 2026): it opens with the same panel as Bill list – All, OPD, IPD or External,
// Search and the filters – and its people list; a name clicked starts that person's bill on this same tab. Someone
// admitted now gets an issue to the ward; an External customer a walk-in bill with the name and phone. Change goes back
// to the list. Coming from Today or the register with someone already chosen, the bill opens straight away.

export function NewBillPage() {
  const navigate = useNavigate();
  const routed = useLocation().state;
  const [start, setStart] = useState(() => (routed?.patient || routed?.type === 'external' ? routed : null));
  const [n, setN] = useState(0); // a new bill each time someone is chosen

  const choose = (next) => {
    setStart(next);
    setN((x) => x + 1);
  };
  const back = () => {
    setStart(null);
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

  if (!start) return <InvoicesPage pick={{ onPick, onWalkIn: () => choose({ type: 'external' }) }} />;
  return <SellPage key={`bill-${n}`} kind="sale" start={start} fromList onCancel={back} />;
}
