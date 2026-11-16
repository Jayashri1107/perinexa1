import { PAGE_KEYS, effectivePages, pageOfRoute } from '../access/pages.js';
import { UserGroup } from '../models/UserGroup.js';
import { HttpError } from '../utils/httpError.js';

// Page access (docs/USER_GROUPS_PLAN.md Part B; access/pages.js). The website names the menu item each request comes
// from in this header. After requireTenant: a request from a menu item that is None for this person is refused, and a
// change from one that is View. Platform users (super admin, platform admin) are not limited by page access.
// It only ever takes away: the roles and the need-to-know rules decide the rest, as before.
export const PAGE_HEADER = 'X-Perinexa-Page';
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** This person's None / View menu items in the hospital they work in now ({} for platform users and no hospital). */
export async function pagesOf(membership) {
  if (!membership || membership.platform) return {};
  const group = membership.groupId ? await UserGroup.findById(membership.groupId, { pages: 1 }).lean() : null;
  return effectivePages(group, membership);
}

// Health check M1 (16 Nov 2026): besides the menu item the request names, the menu item its API area belongs to on its
// own (access/pages.js PAGE_ROUTES) – that one is checked even when the header is left out or names another page.
export async function pageAccessGuard(req, _res, next) {
  if (!req.membership || req.membership.platform) return next();
  const named = req.get(PAGE_HEADER);
  const fromRoute = pageOfRoute(req.originalUrl.split('?')[0].replace(/^\/api/, ''), req.method);
  const toCheck = [...new Set([PAGE_KEYS.includes(named) ? named : null, fromRoute].filter(Boolean))];
  if (!toCheck.length) return next();
  const pages = await pagesOf(req.membership);
  for (const page of toCheck) {
    const level = pages[page] ?? 'edit';
    if (level === 'none') throw new HttpError(403, 'You do not have access to this page. Ask your hospital admin.', 'PAGE_HIDDEN');
    if (level === 'view' && !READS.has(req.method)) throw new HttpError(403, 'View only: you may look at this page but not change anything on it.', 'PAGE_VIEW_ONLY');
  }
  next();
}
