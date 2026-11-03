import { BedDouble, CalendarClock, ChevronRight, FileText, MessageSquare, ScanLine, ScrollText, Share2, ShieldCheck, Users } from 'lucide-react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { AuditLogView } from '../../components/AuditLogView.jsx';
import { MembersPanel } from '../../components/MembersPanel.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { moduleByKey } from '../../platform/modules.js';

// Hospital admins: manage the people in the hospital they're working in.
export function StaffPage() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Hospital admin' }, { label: 'Staff' }]}
        title="Staff"
        help="People who can work in this hospital. Removing someone's access here doesn't affect other hospitals they work at."
        tabs={moduleByKey('hospital-admin').tabs}
      />
      <div className="pf-content">
        <MembersPanel basePath="/tenant/members" allowAccountChanges title="Staff members" />
      </div>
    </>
  );
}

// Phones, as in the app design (2 Nov 2026): the Admin tab opens one list of the admin's pages, in place of the section
// menu. A computer goes to Staff, as before. Every page here is one of the hospital-admin tabs.
const HUB_GROUPS = [
  { title: 'People', rows: [{ label: 'Staff', sub: 'Who works here and their roles', to: '/admin/staff', icon: Users }, { label: 'Audit log', sub: 'Who did what, and when', to: '/admin/audit-log', icon: ScrollText }] },
  {
    title: 'The hospital',
    rows: [
      { label: 'OPD timings', sub: "Each doctor's sessions", to: '/admin/opd-timings', icon: CalendarClock },
      { label: 'Beds', sub: 'Floors, wards and beds', to: '/admin/beds', icon: BedDouble },
      { label: 'Print letterhead', sub: 'Name, logo and address on paper', to: '/admin/settings', icon: FileText },
    ],
  },
  {
    title: 'Connections',
    rows: [
      { label: 'Patient messages', sub: 'Reminders and the patient portal', to: '/admin/messages', icon: MessageSquare },
      { label: 'ABDM', sub: 'ABHA and record sharing', to: '/admin/abdm', icon: ShieldCheck },
      { label: 'Referrals', sub: 'Referral settings', to: '/admin/referrals', icon: Share2 },
      { label: 'Ultrasound machine', sub: 'Connection to the machine', to: '/admin/ultrasound-machine', icon: ScanLine },
    ],
  },
];

export function AdminHomePage() {
  if (!(typeof window !== 'undefined' && window.matchMedia?.('(max-width: 719px)').matches)) return <Navigate to="/admin/staff" replace />;
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Hospital admin' }]} title="Admin" />
      <div className="pf-content adm-hub">
        {HUB_GROUPS.map((g) => (
          <section key={g.title} aria-label={g.title}>
            <h2>{g.title}</h2>
            <ul>
              {g.rows.map((r) => (
                <li key={r.to}>
                  <Link to={r.to}>
                    <span className="adm-hub-icon" aria-hidden="true">
                      <r.icon />
                    </span>
                    <span className="adm-hub-text">
                      <strong>{r.label}</strong>
                      {r.sub}
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

// The audit log's event groups, chosen with the "Type" filter (one page instead of a tab for each).
export const AUDIT_CATEGORIES = [
  { value: 'security', label: 'Security' },
  { value: 'access', label: 'Access changes' },
  { value: 'sessions', label: 'Sign-ins' },
  { value: 'patients', label: 'Patient record access' },
];

export function HospitalAuditLogPage() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Hospital admin' }, { label: 'Audit log' }]}
        title="Audit log"
        help="Everything recorded for this hospital – who did what, and when. Entries cannot be edited or deleted. Patient records show as numbers only."
        tabs={moduleByKey('hospital-admin').tabs}
      />
      <div className="pf-content">
        <AuditLogView endpoint="/tenant/audit-logs" categories={AUDIT_CATEGORIES} />
      </div>
    </>
  );
}

/** An old address of one audit-log group (e.g. /admin/audit-log/security): the audit log with that Type chosen. */
export function AuditCategoryRedirect({ to, category }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('category', category);
  return <Navigate to={`${to}?${params}`} replace />;
}
