// The heading and tabs shared by every Pharmacy page.
import { PageHeader } from '../../components/PageHeader.jsx';
import { SectionTabs } from '../../components/SectionTabs.jsx';
import { PHARMACY_TABS } from '../../config/navigation.js';

export function PharmacyFrame({ subtitle, actions, children }) {
  return (
    <>
      <PageHeader title="Pharmacy" subtitle={subtitle} actions={actions} />
      <SectionTabs tabs={PHARMACY_TABS} label="Pharmacy" />
      {children}
    </>
  );
}
