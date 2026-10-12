import { useEffect, useRef } from 'react';
import { Info } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Alert } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';

// "Information to give": a reminder at the top of the patient's record – on the Overview, at an OPD visit and
// during a stay – when the record shows a condition (e.g. high BP at the latest visit, a high OGTT, low thyroid)
// whose information form has not been given in this pregnancy. Goes away once the form is printed. Only for
// those who may see the consent and information forms.

export function InformationDue({ patient }) {
  const { pathname } = useLocation();
  const base = `/patients/${patient.id}`;
  const onTab = pathname.startsWith(`${base}/information`);
  const canView = Boolean(patient.access?.canViewConsents);
  const { data, reload } = useFetch(canView && !onTab ? `${base}/consents/information-due` : null);

  // Checked again on every other screen of the record (e.g. after a visit's vital signs are saved); the first
  // check is the load above.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (canView && !onTab) reload();
  }, [pathname, canView, onTab, reload]);

  const due = data?.due ?? [];
  if (onTab || !due.length) return null;
  return (
    <Alert type="info" icon={Info}>
      <strong>Information to give:</strong> {due.map((d) => d.title.en.replace(/^Information:\s*/, '')).join('; ')}. Explain it to the patient and her
      relatives and have them sign. <Link to={`${base}/information`}>Open Information given</Link>
    </Alert>
  );
}
