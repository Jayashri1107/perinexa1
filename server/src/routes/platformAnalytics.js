// Analytics for the super admin: /api/platform/analytics. Mounted behind login and the super-admin check.
//
// Numbers only (analytics/platformTotals.js): exact totals per hospital and for all active hospitals together,
// for whole finished months. There is no patient list here, and no id, name or record number of a patient ever
// leaves this route. Nothing is written in a hospital (risk levels are not brought up to date on this path).
// Opening a page writes only which page and which hospital choice was opened.
// A page worked out in the last 5 minutes for the same page, hospital choice, period, type of care and hospital
// date is sent again as it was (analytics/sectionCache.js; its calculatedAt says when). Opening it is still recorded.

import { Router } from 'express';
import { z } from 'zod';
import { hospitalToday } from '../careplans/dates.js';
import { CARE_TYPES } from '../models/Patient.js';
import { Tenant } from '../models/Tenant.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { parse } from '../utils/validate.js';
import { shouldLogView } from '../analytics/auditThrottle.js';
import { parsePeriod } from '../analytics/period.js';
import { platformSection } from '../analytics/platformTotals.js';
import { SECTIONS } from '../analytics/registry.js';
import { cachedPlatformSection, keepPlatformSection, platformCacheKey } from '../analytics/sectionCache.js';

export const platformAnalyticsRouter = Router();

const querySchema = z.object({
  // One spelling for the cache key, the calculation and the audit line: 'ALL' is 'all'; hospital ids in any case.
  // An unknown hospital of any length is 404 (platformHospitals).
  hospital: z.string().max(200).default('all').transform((s) => s.toLowerCase()),
  period: z.string().max(20).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  scope: z.enum(['hospital', 'mine']).optional(),
  careType: z.enum(['all', ...CARE_TYPES]).default('all'),
});

// The hospitals for the picker: every hospital, by name (inactive ones can be picked on their own).
platformAnalyticsRouter.get('/hospitals', async (_req, res) => {
  const rows = await Tenant.find({}).sort({ name: 1, _id: 1 }).select('_id name isActive').lean();
  res.json({ hospitals: rows.map((t) => ({ id: String(t._id), name: t.name, isActive: t.isActive })) });
});

platformAnalyticsRouter.get('/sections/:section', async (req, res) => {
  const { section } = req.params;
  if (!SECTIONS.includes(section)) throw new HttpError(404, "This analytics page doesn't exist.", 'NOT_FOUND');
  const q = parse(querySchema, req.query);
  if (q.scope === 'mine') throw new HttpError(400, '“My patients only” is for doctors.', 'BAD_SCOPE');
  const careType = section === 'overview' ? q.careType : 'all'; // the type-of-care filter is on Overview only
  const cacheMs = req.app.locals.platformAnalyticsCacheMs ?? 0;
  const today = hospitalToday(req.now);
  const cacheKey = platformCacheKey({ section, hospital: q.hospital, period: parsePeriod(q, { audience: 'platform', today }), careType, today });
  let page = cachedPlatformSection(cacheKey, req.now, cacheMs);
  if (!page) {
    const body = await platformSection({ section, hospital: q.hospital, periodQuery: q, careType, now: req.now });
    page = {
      section,
      audience: 'platform',
      scope: 'platform',
      today: body.today,
      calculatedAt: req.now,
      period: body.period,
      leftOut: null,
      masking: null,
      hospitals: body.hospitals,
      noPatients: body.noPatients,
      tiles: body.tiles,
      cards: body.cards,
    };
    keepPlatformSection(cacheKey, req.now, cacheMs, page);
  }

  // "Analytics opened": which page and which hospital choice, never a number (at most once per 10 minutes).
  const hospital = q.hospital === 'all' ? 'all' : page.hospitals[0].id;
  const key = `${req.user._id}|platform|${hospital}|${section}|platform`;
  if (shouldLogView(key, req.now)) await audit(req, 'ANALYTICS_VIEWED', { tenantId: null, details: { section, scope: 'platform', hospital } });

  res.json(page);
});
