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
  { key: 'payroll', label: 'Payroll' },
  { key: 'hospital-admin', label: 'Hospital admin' },
];
export const PAGE_KEYS = PAGES.map((p) => p.key);

// Health check M1 (16 Nov 2026): API areas that belong to ONE menu item only – checked on the server whatever menu item
// the request names (or none), so None and View on these pages hold even for a request typed by hand. Paths are
// relative to /api. Found by reading which screens call each area (client/src): an area is listed only when no other
// menu item's screens use it. readsElsewhere: reads another menu item also needs (Formulary → Stock places reads the
// pharmacy's medicines and their stock). Areas shared by several menu items (patients, billing, lab, the Today page's
// summaries …) stay with the menu item the request names, and with the roles and need-to-know rules as always.
export const PAGE_ROUTES = [
  { page: 'pharmacy', prefix: '/pharmacy', readsElsewhere: [/^\/pharmacy\/medicines$/, /^\/pharmacy\/stock\/[^/]+$/] },
  { page: 'theatre', prefix: '/theatre' },
  { page: 'specimens', prefix: '/specimens' },
  { page: 'formulary', prefix: '/formulary' },
  { page: 'privileges', prefix: '/privileges' },
  { page: 'payroll', prefix: '/payroll' },
  { page: 'clinical-audit', prefix: '/clinical-audit' },
  { page: 'clinical-audit', prefix: '/case-reviews' },
  { page: 'clinical-audit', prefix: '/dashboards' },
  { page: 'clinical-audit', prefix: '/pph-reviews' },
  { page: 'analytics', prefix: '/analytics' },
  { page: 'billing', prefix: '/tally' },
  { page: 'lab', prefix: '/lab-qc' },
  { page: 'lab', prefix: '/lab-setup' },
  { page: 'lab', prefix: '/lab-stock' },
  { page: 'referrals', prefix: '/referring-doctors' },
];

/** The menu item an API path (relative to /api, no query) belongs to on its own, or null. PURE. */
export function pageOfRoute(path, method = 'GET') {
  const route = PAGE_ROUTES.find((r) => path === r.prefix || path.startsWith(`${r.prefix}/`));
  if (!route) return null;
  if (method === 'GET' && route.readsElsewhere?.some((rx) => rx.test(path))) return null;
  return route.page;
}

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
