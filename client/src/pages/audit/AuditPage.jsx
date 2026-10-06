// Module 1 – the platform audit log (every hospital).
import { auditApi } from '../../api/index.js';
import { AuditLogView } from '../../components/audit/AuditLogView.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';

export function AuditPage() {
  return (
    <>
      <PageHeader title="Audit log" subtitle="Who did what, and when. Entries cannot be changed or deleted." />
      <AuditLogView fetchPage={auditApi.list} allHospitals />
    </>
  );
}
