import { Handshake } from 'lucide-react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { DataTable } from '../../components/DataTable.jsx';
import { Alert } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { referralColumns, useNow } from './ReferralsDeskPage.jsx';

// The Referrals tab of a patient's record (docs/REFERRALS_PLAN.md): the referrals from other doctors that brought
// her here, newest first, each with its next promise; a referral opens on its own page in Referrals. The server
// lists only those this person may open.

export function PatientReferralsTab() {
  const { patient } = useOutletContext();
  const navigate = useNavigate();
  const now = useNow();
  const { data, error, loading } = useFetch('/referrals', { list: 'all', patientId: patient.id });
  return (
    <section className="vs-tab" aria-labelledby="ref-tab-title">
      <div className="plan-card-head">
        <h2 id="ref-tab-title">
          <Handshake aria-hidden="true" /> Referrals from other doctors
        </h2>
      </div>
      <Alert type="error">{error}</Alert>
      {!(error && !data) && (
        <DataTable
          caption="Her referrals"
          columns={referralColumns(now, { showPatient: false })}
          rows={data?.referrals}
          loading={loading}
          onRowClick={(r) => navigate(`/referrals/${r.id}`)}
          emptyText="No referrals from other doctors."
        />
      )}
    </section>
  );
}
