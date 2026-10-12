import { useAuth } from '../auth/AuthContext.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { accountTabs, isPrescriber } from '../platform/modules.js';
import { AppearanceSection } from './AppearancePage.jsx';
import { ChangePasswordPage } from './ChangePasswordPage.jsx';
import { ProfessionalDetailsSection } from './ProfessionalDetailsPage.jsx';

// My settings – one page for every login: password, professional details (doctors and RMOs: printed on
// prescriptions) and appearance. Prescription design and Voice words are tabs for those who use them.
export function AccountPage() {
  const { user, memberships } = useAuth();
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'My settings' }]} title="My settings" subtitle={`${user.name} · ${user.email}`} tabs={accountTabs(memberships)} />
      <div className="pf-content acc-settings">
        <ChangePasswordPage embedded />
        {isPrescriber(memberships) && <ProfessionalDetailsSection />}
        <AppearanceSection />
      </div>
    </>
  );
}
