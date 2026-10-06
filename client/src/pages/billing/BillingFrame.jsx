// The heading and tabs shared by every Billing page.
import { PageHeader } from '../../components/PageHeader.jsx';
import { SectionTabs } from '../../components/SectionTabs.jsx';
import { BILLING_TABS } from '../../config/navigation.js';

export function BillingFrame({ subtitle, actions, children }) {
  return (
    <>
      <PageHeader title="Billing" subtitle={subtitle} actions={actions} />
      <SectionTabs tabs={BILLING_TABS} label="Billing" />
      {children}
    </>
  );
}
