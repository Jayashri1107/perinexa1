// Who may see Analytics (Feature 11), and how much. One constant each, so a change is a one-line edit.
// The first three are copied in the website (client/src/pages/analytics/analyticsRoles.js); a test checks that
// both copies are the same.

import { hasRole } from '../models/Membership.js';
import { HttpError } from '../utils/httpError.js';

export const ANALYTICS_ROLES = ['doctor', 'admin']; // who gets the Analytics page in a hospital
export const DRILLDOWN_ROLES = ['doctor']; // who may open patient lists from a number
export const EXACT_ROLES = ['doctor']; // who sees exact small numbers in a hospital

// Rows hidden from hospital admins (diagnosis-level detail). Remove an entry to show it to admins.
// Deliveries tab (5 Oct 2026): stillbirths and deaths are never shown to hospital admins – in a small hospital even
// a count can point to a family. The births card (H3) shows the stillbirths; Apgar (H4), NICU or SNCU (H5) and
// breastfeeding (H6) are counted out of the live births, and the deliveries (H1, shown to admins) minus the live
// births would give the stillbirths away – so these cards are kept from admins as a whole. H7: the deaths.
export const ADMIN_HIDDEN = ['C2', 'C9', 'C4.blood', 'D1.rows', 'D3.subRows', 'D4.split', 'E4.rhGroup', 'E.conditionalItems', 'H3', 'H4', 'H5', 'H6', 'H7'];
// Platform: hide clinical cards for a hospital whose denominator is below this. 0 = off (owner decision 1).
export const PLATFORM_MIN_DENOMINATOR = 0;

export const NO_ACCESS_MESSAGE = 'Analytics is for doctors and hospital admins. Ask your hospital admin if you need it.';

/**
 * The audience of this request: 'platform' (super admin), 'doctor' (anyone with the doctor role, also when they
 * are an admin too – the doctor role wins, as in patientAccess), 'admin', or null (RMOs, nurses, reception, lab).
 */
export function audienceOf(req) {
  if (req.user?.isSuperAdmin) return 'platform';
  if (hasRole(req.membership, ...EXACT_ROLES)) return 'doctor';
  if (hasRole(req.membership, ...ANALYTICS_ROLES)) return 'admin';
  return null;
}

/** Hospital analytics routes: sets req.analyticsAudience to 'doctor' or 'admin', or answers 403. */
export function requireAnalyticsAudience(req, _res, next) {
  const audience = audienceOf(req);
  if (audience !== 'doctor' && audience !== 'admin') throw new HttpError(403, NO_ACCESS_MESSAGE, 'FORBIDDEN');
  req.analyticsAudience = audience;
  next();
}
