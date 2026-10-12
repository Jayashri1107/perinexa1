// Who gets Analytics (Feature 11). The server has the same lists in server/src/analytics/roles.js, where they
// are enforced; a server test checks that both copies are the same. This file has no imports, so that test
// can read it.

export const ANALYTICS_ROLES = ['doctor', 'admin']; // who gets the Analytics page in a hospital
export const DRILLDOWN_ROLES = ['doctor']; // who may open patient lists from a number
export const EXACT_ROLES = ['doctor']; // who sees exact small numbers in a hospital
