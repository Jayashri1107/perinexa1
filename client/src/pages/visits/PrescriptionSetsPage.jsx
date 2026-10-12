import { FilePlus2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { knowledgeTabs } from '../../platform/modules.js';
import { careTypesText } from '../consents/consentFormat.js';
import { CARE_TYPE_SHORT } from '../patients/patientFormat.js';
import { LOSS_SETS_NOTE, SetStatus, THREATENED_NOTE, setMedicinesText } from './PrescriptionSetParts.jsx';

// The hospital's ready-made prescription sets (Feature 8b): the built-in drafts for common OBGY situations and
// the hospital's own. Doctors and RMOs read them and add them on the Prescription tab; doctors add, edit, approve
// and stop using sets.

/** "2 medicines · tests · advice" */
export const setContentsText = (s) =>
  [s.items.length ? `${s.items.length} ${s.items.length === 1 ? 'medicine' : 'medicines'}` : 'No medicines', s.investigations && 'tests', s.advice && 'advice']
    .filter(Boolean)
    .join(' · ');

export function PrescriptionSetsPage() {
  const { activeMembership } = useAuth();
  const navigate = useNavigate();
  const { data, error, loading } = useFetch('/prescription-sets');

  const columns = [
    {
      key: 'name',
      header: 'Set',
      className: 'rxs-col-name',
      render: (s) => (
        <span className="name-cell-text">
          <Link to={`/prescription-sets/${s.id}`} className="cp-template-link">
            {s.name}
          </Link>
          <span className="t-caption muted">{setMedicinesText(s)}</span>
        </span>
      ),
    },
    { key: 'for', header: 'For', width: 170, className: 'rxs-col-wrap', render: (s) => careTypesText(s.careTypes, CARE_TYPE_SHORT) },
    { key: 'contents', header: 'Holds', width: 170, className: 'rxs-col-wrap', render: setContentsText },
    { key: 'status', header: 'Status', width: 200, render: (s) => <SetStatus set={s} /> },
    { key: 'updated', header: 'Last changed', width: 160, render: (s) => formatDateTime(s.updatedAt) },
  ];

  const anyDraft = data?.sets.some((s) => s.isActive && s.status === 'draft');

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Clinic library', to: '/care-plans/templates' }, { label: 'Prescription sets' }]}
        title="Prescription sets"
        help="Ready-made prescriptions for common situations. On a visit's Prescription tab, add one with a click and change it before saving."
        tabs={knowledgeTabs(activeMembership.roles)}
        actions={
          data?.canEdit && (
            <Link to="/prescription-sets/new" className="btn btn-primary">
              <FilePlus2 aria-hidden="true" /> New set
            </Link>
          )
        }
      />
      <div className="pf-content">
        <Alert type="error">{error}</Alert>
        {anyDraft && (
          <Alert type="warning">
            <strong>Draft sets have not been checked by a doctor.</strong> The built-in sets were prepared by the software developer from published guidance.
            A doctor must check every medicine, dose and instruction, then approve each set. A draft added to a prescription is marked as a draft there too.
          </Alert>
        )}
        <DataTable
          caption="Prescription sets"
          columns={columns}
          rows={data?.sets}
          loading={loading}
          onRowClick={(s) => navigate(`/prescription-sets/${s.id}`)}
          rowClassName={(s) => (s.isActive ? '' : 'row-inactive')}
          emptyText="No prescription sets yet."
        />
        <p className="hint help">
          {LOSS_SETS_NOTE} {THREATENED_NOTE}
        </p>
      </div>
    </>
  );
}
