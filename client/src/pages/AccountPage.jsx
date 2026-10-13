import { Building2, KeyRound, Mail, Palette, Stethoscope } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Avatar, rolesLabel } from '../components/ui.jsx';
import { accountTabs, isPrescriber } from '../platform/modules.js';
import { AppearanceSection } from './AppearancePage.jsx';
import { ChangePasswordPage } from './ChangePasswordPage.jsx';
import { ProfessionalDetailsSection } from './ProfessionalDetailsPage.jsx';

const PLATFORM_ROLE = { superadmin: 'Super admin', platformadmin: 'Platform admin' };

// My profile – one page for every login, laid out like the profile page of most apps: a card on the left with who
// you are (name, email, role, hospitals) and links to the sections; the sections on the right – password,
// professional details (doctors and RMOs: printed on prescriptions) and appearance. Prescription design and Voice
// words stay tabs for those who use them.
export function AccountPage() {
  const { user, memberships, platform } = useAuth();
  const prescriber = isPrescriber(memberships);
  const sections = [
    { id: 'password', label: 'Password', icon: KeyRound },
    prescriber && { id: 'professional', label: 'Professional details', icon: Stethoscope },
    { id: 'appearance', label: 'Appearance', icon: Palette },
  ].filter(Boolean);

  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'My settings' }]} title="My profile" tabs={accountTabs(memberships)} />
      <div className="pf-content acc-profile">
        <aside className="card acc-id" aria-label="Your profile">
          <div className="acc-id-head">
            <Avatar name={user.name} seed={user.email} large />
            <div className="acc-id-who">
              <strong>{user.name}</strong>
              <span className="acc-id-line">
                <Mail aria-hidden="true" /> {user.email}
              </span>
            </div>
          </div>
          <dl className="acc-id-facts">
            {platform?.role && (
              <div>
                <dt>Role</dt>
                <dd>
                  <span className="pill">{PLATFORM_ROLE[platform.role] ?? platform.role}</span>
                </dd>
              </div>
            )}
            {memberships.map((m) => (
              <div key={m.tenantId}>
                <dt>
                  <Building2 aria-hidden="true" /> {m.tenantName}
                </dt>
                <dd>{rolesLabel(m.roles)}</dd>
              </div>
            ))}
          </dl>
          <nav className="acc-id-nav" aria-label="Sections of this page">
            {sections.map(({ id, label, icon: Icon }) => (
              <a key={id} href={`#${id}`}>
                <Icon aria-hidden="true" /> {label}
              </a>
            ))}
          </nav>
        </aside>
        <div className="acc-sections">
          <ChangePasswordPage embedded />
          {prescriber && <ProfessionalDetailsSection />}
          <AppearanceSection />
        </div>
      </div>
    </>
  );
}
