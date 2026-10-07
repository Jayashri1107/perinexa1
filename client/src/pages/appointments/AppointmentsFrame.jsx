// The heading and tabs shared by every Appointments page.
import { PageHeader } from '../../components/PageHeader.jsx';
import { SectionTabs } from '../../components/SectionTabs.jsx';
import { APPOINTMENT_TABS } from '../../config/navigation.js';

export function AppointmentsFrame({ subtitle, actions, children }) {
  return (
    <>
      <PageHeader title="Appointments" subtitle={subtitle} actions={actions} />
      <SectionTabs tabs={APPOINTMENT_TABS} label="Appointments" />
      {children}
    </>
  );
}
