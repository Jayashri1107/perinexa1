// Small helpers for the metric definitions.

import { createHash } from 'node:crypto';
import { ADMIN_HIDDEN } from '../roles.js';

/** { key: new Set() } for each key. */
export const sets = (...keys) => Object.fromEntries(keys.map((k) => [k, new Set()]));

/** { key: 0 } for each key (for counts of visits or items, which are never listed). */
export const zeros = (...keys) => Object.fromEntries(keys.map((k) => [k, 0]));

/** The code of a trend cell ('b:m:2026-10' → 'bm202610'): stable, opaque, no words. */
export const bucketCode = (key) => key.replace(/[^0-9a-z]/gi, '');

/** A stable, opaque code for a cell named by data (a risk reason, a care-plan item): 'k' + 8 hex of sha256. */
export const hashCode = (text) => `k${createHash('sha256').update(String(text)).digest('hex').slice(0, 8)}`;

/** True when this audience does not get the named rows (hospital admins: analytics/roles.js ADMIN_HIDDEN). */
export const hiddenFor = (ctx, name) => ctx.audience === 'admin' && ADMIN_HIDDEN.includes(name);

/** Gestation as a list detail. */
export const gaDetail = (ga) => (ga ? { type: 'ga', weeks: ga.weeks, days: ga.days } : null);
