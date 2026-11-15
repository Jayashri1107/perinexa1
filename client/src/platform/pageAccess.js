// Page access (docs/USER_GROUPS_PLAN.md Part B; server: access/pages.js and middleware/pageAccess.js). One entry per menu
// item of a hospital's left menu; a user group, and a person's own changes, set each to None, View or Edit (Edit when
// not set). A None item leaves the menu and its pages show "no access"; a View item's pages say "View only" and the
// server refuses their changes. Same keys as the server.

export const PAGE_LEVELS = ['none', 'view', 'edit'];
export const PAGE_LEVEL_LABELS = { none: 'None', view: 'View', edit: 'Edit' };

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

/** The page-access key of a menu item: the pharmacist's six pharmacy items are one, "Pharmacy". PURE. */
export const pageKeyOf = (moduleKey) => (moduleKey?.startsWith('pharmacy') ? 'pharmacy' : moduleKey);

/** None / View / Edit of a menu item for this place (membership.pages lists only None and View). PURE. */
export const pageLevel = (pages, moduleKey) => pages?.[pageKeyOf(moduleKey)] ?? 'edit';

/** The menu without the items that are None here. PURE. */
export const visibleModules = (modules, pages) => modules.filter((m) => pageLevel(pages, m.key) !== 'none');

/**
 * Which menu item a page belongs to (the person's whole menu, before None items are taken out): the item with the
 * longest address that the page's address starts with – its own, a tab's, or one it stays highlighted for. "/" only
 * matches the start page itself. null when no menu item owns the page (e.g. My settings). PURE.
 */
export function pageForPath(pathname, modules) {
  let best = null;
  let length = -1;
  for (const m of modules) {
    if (!m.key || !PAGE_KEYS.includes(pageKeyOf(m.key))) continue;
    const prefixes = [m.to, ...(m.tabs ?? []).map((t) => t.to), ...[m.activeFor ?? []].flat()].filter(Boolean);
    for (const p of prefixes) {
      const path = p.split('?')[0];
      const hit = path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(path.endsWith('/') ? path : `${path}/`);
      if (hit && path.length > length) {
        best = pageKeyOf(m.key);
        length = path.length;
      }
    }
  }
  return best;
}
