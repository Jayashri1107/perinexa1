// Analytics pages kept in memory for a short time (Analytics specification, section 4.8: "If their budget fails,
// add a 60-second in-memory cache for section payloads only, never for lists").
//
// Doctors (ANALYTICS_CACHE_SECONDS, 60 seconds):
// - Only a doctor's section page is kept, never a patient list (lists are worked out and audited every time).
// - The key always has the doctor's own id, because a doctor's numbers depend on the records they may see; and
//   the hospital, the scope ("whole hospital" or "my patients"), the page, the period and the type of care.
// - A page is kept for at most SECTION_CACHE_MS after it was worked out (its "calculated at" time says when), so
//   a change made in the hospital shows within a minute. Nothing is kept when the time is 0.
// - It holds what the doctor was sent anyway (numbers and the opaque codes of their cells), nothing more.
//
// The super admin (ANALYTICS_PLATFORM_CACHE_SECONDS, 5 minutes – the "all hospitals" pages work out every hospital
// one by one, see docs/PROGRESS.md "Analytics speed"):
// - The same page for every super admin (numbers only, no patient anywhere), so the key has no person's id: the
//   page, the hospital choice ("all" or the one hospital picked), the period, the type of care and the hospital
//   date. A new day is a new key.
// - Kept in its own store, so doctors' pages never push it out (and the other way round).
// - The hospital admin's numbers have their own 10-minute cache (adminView.js).

import { isoDay } from '../careplans/dates.js';

const MAX_ENTRIES = 500;
const cache = new Map(); // doctors' pages: key → { at, body }
const platformCache = new Map(); // the super admin's pages: key → { at, body }

/** For tests. */
export const resetSectionCache = () => {
  cache.clear();
  platformCache.clear();
};

/** The key of a doctor's page: hospital, audience, scope, doctor, page, period and type of care. */
export function sectionCacheKey({ tenantId, audience, scope, userId, section, period, careType }) {
  return JSON.stringify([String(tenantId), audience, scope, String(userId), section, period.key, isoDay(period.from), isoDay(period.to), careType]);
}

/**
 * The key of a super admin's page: page, hospital choice ('all' or the hospital's id), period, type of care and
 * the hospital date (YYYY-MM-DD). Never a person's or a patient's id.
 */
export function platformCacheKey({ section, hospital, period, careType, today }) {
  return JSON.stringify(['platform', section, String(hospital).toLowerCase(), period.key, isoDay(period.from), isoDay(period.to), careType, isoDay(today)]);
}

/** The page kept under this key, if it was worked out less than `ms` ago (else null). */
export function cachedSection(key, now, ms, { store = cache } = {}) {
  if (!(ms > 0)) return null;
  const hit = store.get(key);
  const t = new Date(now).getTime();
  if (!hit || t < hit.at || t - hit.at >= ms) {
    if (hit) store.delete(key);
    return null;
  }
  return hit.body;
}

/** Keeps a page worked out at `now` (no-op when ms is 0). Old pages are dropped first when there are many. */
export function keepSection(key, now, ms, body, { store = cache } = {}) {
  if (!(ms > 0)) return;
  const t = new Date(now).getTime();
  if (store.size >= MAX_ENTRIES) {
    for (const [k, v] of store) if (t - v.at >= ms || t < v.at) store.delete(k);
    while (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value); // the oldest kept first
  }
  store.set(key, { at: t, body });
}

/** A super admin's page kept under this key (platformCacheKey), if worked out less than `ms` ago (else null). */
export const cachedPlatformSection = (key, now, ms) => cachedSection(key, now, ms, { store: platformCache });

/** Keeps a super admin's page worked out at `now` (no-op when ms is 0). */
export const keepPlatformSection = (key, now, ms, body) => keepSection(key, now, ms, body, { store: platformCache });
