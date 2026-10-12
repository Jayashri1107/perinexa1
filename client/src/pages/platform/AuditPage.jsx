import { AuditLogView } from '../../components/AuditLogView.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { moduleByKey } from '../../platform/modules.js';
import { AUDIT_CATEGORIES } from '../admin/StaffPage.jsx';

// Audit & compliance (super admins): every event on the platform and in all hospitals, one page with a "Type" filter.
export function AuditPage() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Audit & compliance' }]}
        title="Audit & compliance"
        help="Everything recorded across the platform and all hospitals. Entries cannot be edited or deleted; patient records show as numbers only."
        tabs={moduleByKey('audit').tabs}
      />
      <div className="pf-content">
        <AuditLogView endpoint="/platform/audit-logs" categories={AUDIT_CATEGORIES} showHospital />
      </div>
    </>
  );
}
