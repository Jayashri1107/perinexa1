import { useAuth } from '../../auth/AuthContext.jsx';
import { hasRole } from '../../components/ui.jsx';

// Clinical audit (Clinical Requirements Group A): who sees which page, and the module's tabs. The same role lists as
// the server's routes (server/src/routes/clinicalAudit.js and the Group A routes after it).

/** The Robson table and the caesarean audit: numbers for these roles; each caesarean for doctors and RMOs. */
export const CLINICAL_AUDIT_ROLES = ['doctor', 'rmo', 'quality', 'admin'];

export const QUALITY_TABS = [
  { label: 'Deliveries', to: '/clinical-audit', end: true },
  // Monthly dashboards with targets and the lead's sign-off (Group B item 17)
  { label: 'Monthly dashboards', to: '/clinical-audit/dashboards', end: true },
];

/** Death and near-miss reviews (Group C, PX-OBG-30): doctors, RMOs and the quality lead – not the hospital admin. */
export const CASE_REVIEW_ROLES = ['doctor', 'rmo', 'quality'];
const REVIEWS_TAB = { label: 'Death and near-miss reviews', to: '/clinical-audit/reviews' };
/** The module's tabs for this person (the reviews tab only for those who may open it). */
export function useQualityTabs() {
  const membership = useAuth()?.activeMembership;
  return membership && hasRole(membership, ...CASE_REVIEW_ROLES) ? [...QUALITY_TABS, REVIEWS_TAB] : QUALITY_TABS;
}
