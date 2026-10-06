// The hospital admin's staff (their own hospital only – the server takes it from the session).
import { hospitalStaffApi } from '../../api/index.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StaffPanel } from '../../components/staff/StaffPanel.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

export function StaffPage() {
  const { activeMembership } = useAuth();
  return (
    <>
      <PageHeader
        title="Staff"
        subtitle="Everyone who works here, with their roles. Staff are deactivated, never deleted. A hospital always keeps at least one admin."
      />
      <StaffPanel api={hospitalStaffApi} hospitalName={activeMembership.hospital.name} />
    </>
  );
}
