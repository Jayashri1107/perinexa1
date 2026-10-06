// The hospital admin's audit log: this hospital only.
import { hospitalAuditApi } from '../../api/index.js';
import { AuditLogView } from '../../components/audit/AuditLogView.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { SectionTabs } from '../../components/SectionTabs.jsx';
import { HOSPITAL_ADMIN_TABS } from '../../config/navigation.js';

export function HospitalAuditPage() {
  return (
    <>
      <PageHeader title="Audit log" subtitle="Who did what in this hospital, and when. Entries cannot be changed or deleted." />
      <SectionTabs tabs={HOSPITAL_ADMIN_TABS} label="Hospital admin" />
      <AuditLogView fetchPage={hospitalAuditApi.list} />
    </>
  );
}
