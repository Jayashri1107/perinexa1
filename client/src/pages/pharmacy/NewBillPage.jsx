import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SellPage } from './SellPage.jsx';

// The Sales bill page's New bill tab: since 13 Nov 2026 it opens straight on the bill, as the pharmacy's earlier Sales
// Bill did – OPD / IPD / External and the patient's UHID with Search, or the name with its drop-down, on the left; the
// people list stays under Bill list. Coming from Today or the register with someone already chosen, the bill opens with
// them (Change goes back to an empty bill).

export function NewBillPage() {
  const navigate = useNavigate();
  const routed = useLocation().state;
  const [start, setStart] = useState(() => (routed?.patient || routed?.type === 'external' ? routed : null));
  const [n, setN] = useState(0); // a new, empty bill after Change

  const back = () => {
    setStart(null);
    setN((x) => x + 1);
    if (routed) navigate('.', { replace: true, state: null });
  };

  if (!start) return <SellPage key={`bill-${n}`} kind="sale" />;
  return <SellPage key={`bill-${n}`} kind="sale" start={start} fromList onCancel={back} />;
}
