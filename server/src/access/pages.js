// Page access (developer, 14 Nov 2026 – docs/USER_GROUPS_PLAN.md Part B): one entry per menu item of a hospital's left
// menu. A user group says, per menu item, None / View / Edit; a person may have their own changes on top
// (Membership.pageOverrides). A menu item not listed in either is Edit – so a group with no pages set changes nothing.
//
// What this does and does not do:
//  - The website hides a None item, and shows a View item without letting it save.
//  - The website sends the menu item a request comes from (X-Perinexa-Page); the server refuses a request from a None item
//    and a change (POST/PUT/PATCH/DELETE) from a View item (middleware/pageAccess.js).
//  - It never widens anything: what a person may do and which patient records they may open stay decided by the group's
//    roles and the need-to-know rules (utils/patientAccess.js), exactly as before.
// The same keys are in client/src/platform/pageAccess.js.

export const PAGE_LEVELS = ['none', 'view', 'edit'];

export const PAGES = [
  { key: 'today', label: 'Today' },
  { key: 'follow-ups', label: 'Follow-ups' },
  { key: 'patients', label: 'Patients' },
  { key: 'records', label: 'Medical records' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'beds', label: 'Beds' },
  { key: 'lab', label: 'Lab' },
  { key: 'scans', label: 'Scans' },
  { key: 'referrals', label: 'Referrals' },
  { key: 'billing', label: 'Billing' },
  { key: 'expenses', label: 'Daily expenses' },
  { key: 'pharmacy', label: 'Pharmacy' },
  { key: 'theatre', label: 'Theatre' },
  { key: 'specimens', label: 'Specimens' },
  { key: 'newborn-follow-up', label: 'Newborn follow-up' },
  { key: 'clinical-audit', label: 'Clinical audit' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'knowledge', label: 'Library' },
  { key: 'formulary', label: 'Formulary' },
  { key: 'incidents', label: 'Incidents' },
  { key: 'privileges', label: 'Privileges' },
  { key: 'hospital-admin', label: 'Hospital admin' },
];
export const PAGE_KEYS = PAGES.map((p) => p.key);

/** Only known menu items and levels, and only those that are not Edit (Edit is the default). PURE. */
export function cleanPages(pages = {}) {
  const out = {};
  for (const key of PAGE_KEYS) {
    const level = pages?.[key];
    if (level === 'none' || level === 'view') out[key] = level;
  }
  return out;
}

const plain = (m) => (m instanceof Map ? Object.fromEntries(m) : (m ?? {}));

/** A person's menu items here: the group's, then their own changes. Only None and View are listed. PURE. */
export const effectivePages = (group, membership) => cleanPages({ ...plain(group?.pages), ...plain(membership?.pageOverrides) });
