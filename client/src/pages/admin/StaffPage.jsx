import { Navigate, useLocation } from 'react-router-dom';
import { AuditLogView } from '../../components/AuditLogView.jsx';
import { MembersPanel } from '../../components/MembersPanel.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { moduleByKey } from '../../platform/modules.js';

// Hospital admins: manage the people in the hospital they're working in.
export function StaffPage() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Hospital admin' }, { label: 'Staff' }]}
        title="Staff"
        help="People who can work in this hospital. Removing someone's access here doesn't affect other hospitals they work at."
        tabs={moduleByKey('hospital-admin').tabs}
      />
      <div className="pf-content">
        <MembersPanel basePath="/tenant/members" allowAccountChanges title="Staff members" />
      </div>
    </>
  );
}

// The audit log's event groups, chosen with the "Type" filter (one page instead of a tab for each).
export const AUDIT_CATEGORIES = [
  { value: 'security', label: 'Security' },
  { value: 'access', label: 'Access changes' },
  { value: 'sessions', label: 'Sign-ins' },
  { value: 'patients', label: 'Patient record access' },
];

export function HospitalAuditLogPage() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Hospital admin' }, { label: 'Audit log' }]}
        title="Audit log"
        help="Everything recorded for this hospital – who did what, and when. Entries cannot be edited or deleted. Patient records show as numbers only."
        tabs={moduleByKey('hospital-admin').tabs}
      />
      <div className="pf-content">
        <AuditLogView endpoint="/tenant/audit-logs" categories={AUDIT_CATEGORIES} />
      </div>
    </>
  );
}

/** An old address of one audit-log group (e.g. /admin/audit-log/security): the audit log with that Type chosen. */
export function AuditCategoryRedirect({ to, category }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('category', category);
  return <Navigate to={`${to}?${params}`} replace />;
}
