// The hospital admin's audit log: this hospital only.
import { hospitalAuditApi } from '../../api/index.js';
import { AuditLogView } from '../../components/audit/AuditLogView.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';

export function HospitalAuditPage() {
  return (
    <>
      <PageHeader title="Audit log" subtitle="Who did what in this hospital, and when. Entries cannot be changed or deleted." />
      <AuditLogView fetchPage={hospitalAuditApi.list} />
    </>
  );
}
