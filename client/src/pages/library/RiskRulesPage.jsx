import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';

// Clinical rules → Risk rules: the risk rules are part of the hospital's standard antenatal care-plan template (the
// risk level is always worked out from its rules), so this opens that template at its risk rules.
export function RiskRulesPage() {
  const navigate = useNavigate();
  const { data, error } = useFetch('/care-plans/templates', { careType: 'antenatal' });
  const standard = data?.templates.find((t) => t.kind === 'standard' && t.careType === 'antenatal');
  useEffect(() => {
    if (standard) navigate(`/care-plans/templates/${standard.id}#risk-rules`, { replace: true });
  }, [standard, navigate]);
  if (error || (data && !standard)) {
    return (
      <>
        <PageHeader breadcrumbs={[{ label: 'Clinical rules' }, { label: 'Risk rules' }]} title="Risk rules" />
        <div className="pf-content">
          <Alert type="error">{error ?? "The hospital's standard antenatal template was not found."}</Alert>
        </div>
      </>
    );
  }
  return <FullPageSpinner />;
}
