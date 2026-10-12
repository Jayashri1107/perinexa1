// Analytics for one hospital: /api/analytics. Mounted behind login, the hospital check and
// requireAnalyticsAudience (doctors and hospital admins only), so req.analyticsAudience is 'doctor' or 'admin'.
//
// Every number is worked out for the hospital selected in the session only (analytics/load.js). Doctors count
// only the patients whose clinical details they may see (rule R8), and can narrow to their own patients.
// Hospital admins get whole-hospital numbers for whole finished months, with numbers from 1 to 4 shown as
// "fewer than 5" and the rows kept for doctors left out (analytics/adminView.js, analytics/mask.js).
// Opening a page writes only which page was opened. Opening a patient list (doctors only) writes the ids of
// the patients on that page – never which number, cell, label or period they came from.

import { Router } from 'express';
import { z } from 'zod';
import { hospitalToday, isoDay } from '../careplans/dates.js';
import { refreshDueRisks } from '../careplans/templatesService.js';
import { CARE_TYPES } from '../models/Patient.js';
import { audit } from '../utils/audit.js';
import { Membership, hasRole } from '../models/Membership.js';
import { User } from '../models/User.js';
import { HttpError } from '../utils/httpError.js';
import { pageParams, parse } from '../utils/validate.js';
import { adminSection } from '../analytics/adminView.js';
import { shouldLogView } from '../analytics/auditThrottle.js';
import { buildContext, computeSections, metricIdsFor, rawValue } from '../analytics/compute.js';
import { LISTS_FOR_DOCTORS_MESSAGE, listCell } from '../analytics/listService.js';
import { loadHospital, windowFromOf } from '../analytics/load.js';
import { cachedSection, keepSection, sectionCacheKey } from '../analytics/sectionCache.js';
import { parsePeriod, periodJSON } from '../analytics/period.js';
import { monthlyReport, monthlyTrend } from '../reports/monthlyReport.js';
import { countOf, tilesJSON, toPublicCards } from '../analytics/publicCards.js';
import { DRILLDOWN_ROLES } from '../analytics/roles.js';
import { REFRESH_RISK_SECTIONS, SECTIONS, needsOf } from '../analytics/registry.js';
import { visibleSet } from '../analytics/visibility.js';

export const analyticsRouter = Router();

const querySchema = z.object({
  period: z.string().max(20).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  scope: z.enum(['hospital', 'mine']).default('hospital'),
  careType: z.enum(['all', ...CARE_TYPES]).default('all'),
});

// A patient list: which number (opaque codes only, so the browser history never shows a diagnosis), the same
// filters as its page, and the page of the list.
const listSchema = querySchema.extend({
  // Checked against the cards in analytics/listService.js. A missing, too-long or repeated value is simply not a
  // listable number, so it becomes '' and listCell answers 400 NOT_LISTABLE (not the generic validation error).
  metric: z.string().max(8).catch(''),
  cell: z.string().max(24).catch(''),
  ...pageParams,
});

function sectionOf(req) {
  const { section } = req.params;
  if (!SECTIONS.includes(section)) throw new HttpError(404, "This analytics page doesn't exist.", 'NOT_FOUND');
  return section;
}

async function logView(req, section, scope) {
  const key = `${req.user._id}|${req.tenantId}|${section}|${scope}`;
  if (shouldLogView(key, req.now)) await audit(req, 'ANALYTICS_VIEWED', { details: { section, scope } });
}

// ---------- The monthly report (HMIS order) and the owner's 12-month charts ----------
// Doctors only, the whole hospital (as under Registers before 2 Oct 2026): in a small hospital even a count can
// point to a patient. RMOs, nurses and the other roles never get here (requireAnalyticsAudience answers 403);
// hospital admins reach /api/analytics, so the check is explicit. Opening the report records the month only.

export const REPORT_FOR_DOCTORS_MESSAGE = 'The monthly report is for doctors.';
const monthQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month').optional() });

function reportMonth(req) {
  if (req.analyticsAudience !== 'doctor') throw new HttpError(403, REPORT_FOR_DOCTORS_MESSAGE, 'FORBIDDEN');
  const { month = hospitalToday(req.now).toISOString().slice(0, 7) } = parse(monthQuery, req.query);
  return month;
}

analyticsRouter.get('/report/monthly', async (req, res) => {
  const month = reportMonth(req);
  const report = await monthlyReport(req.tenantId, month);
  await audit(req, 'REPORT_VIEWED', { details: { report: 'monthly', month } });
  res.json(report);
});

analyticsRouter.get('/report/trend', async (req, res) => {
  const month = reportMonth(req);
  res.json(await monthlyTrend(req.tenantId, month, 12));
});

analyticsRouter.get('/sections/:section', async (req, res) => {
  const section = sectionOf(req);
  const audience = req.analyticsAudience;
  const q = parse(querySchema, req.query);
  if (q.scope === 'mine' && audience !== 'doctor') throw new HttpError(400, '“My patients only” is for doctors.', 'BAD_SCOPE');
  const today = hospitalToday(req.now);
  const period = parsePeriod(q, { audience, today });
  const careType = section === 'overview' ? q.careType : 'all';
  const base = {
    section,
    audience,
    scope: q.scope,
    today: isoDay(today),
    calculatedAt: req.now,
    period: periodJSON(period),
    leftOut: null,
    masking: null,
    hospitals: null,
    noPatients: false,
    tiles: null,
    cards: [],
  };

  if (audience === 'admin') {
    // Hospital admins: the whole hospital, whole finished months, small numbers protected. Every admin page is
    // a slice of one masking of all sections, periods and filters (analytics/adminView.js); no patient lists.
    const view = await adminSection(req.tenantId, { now: req.now, today, section, periodKey: period.key, careType });
    await logView(req, section, q.scope);
    return res.json({ ...base, ...view });
  }

  // Doctors: a page worked out less than a minute ago for the same doctor, hospital, scope, period and type of
  // care is sent again as it was (its calculatedAt says when). Opening it is still recorded.
  const cacheMs = req.app.locals.analyticsCacheMs ?? 0;
  const cacheKey = sectionCacheKey({ tenantId: req.tenantId, audience, scope: q.scope, userId: req.user._id, section, period, careType });
  const kept = cachedSection(cacheKey, req.now, cacheMs);
  if (kept) {
    await logView(req, section, q.scope);
    return res.json(kept);
  }

  if (REFRESH_RISK_SECTIONS.includes(section)) await refreshDueRisks(req.tenantId, req.now);
  const metricIds = metricIdsFor([section], audience);
  const data = await loadHospital(req.tenantId, {
    now: req.now,
    today,
    windowFrom: windowFromOf(period, today),
    periodFrom: period.from,
    periodTo: period.to,
    needs: needsOf(metricIds).concat('patients'),
  });
  const visible = visibleSet(req, data.patients);
  const ctx = buildContext(data, { now: req.now, today, period, scope: q.scope, careType, audience, userId: req.user._id, visible });
  const { cards, tiles } = computeSections(ctx, [section]);

  const body = {
    ...base,
    // "Leaves out n sensitive records of other doctors" (whole hospital only; all types of care).
    leftOut: q.scope === 'hospital' ? data.patients.length - visible.size : null,
    noPatients: data.patients.length === 0,
    tiles: tiles ? tilesJSON(tiles, ctx, { audience }) : null,
    cards: toPublicCards(cards, ctx, { audience }),
  };
  keepSection(cacheKey, req.now, cacheMs, body);
  await logView(req, section, q.scope);
  res.json(body);
});

// ---------- Numbers per doctor ----------
// Doctors only (owner, 4 Oct 2026): the headline numbers of Overview for each doctor's own patients – the same cells
// as "My patients only" would show that doctor – and for the whole hospital. As everywhere for doctors, other
// doctors' sensitive records are left out (rule R8). Hospital admins get 403: numbers this small compare staff and
// can point to a patient. Counts only; no patient lists open from here.

export const BY_DOCTOR_MESSAGE = 'The numbers per doctor are for doctors.';

analyticsRouter.get('/doctors', async (req, res) => {
  if (req.analyticsAudience !== 'doctor') throw new HttpError(403, BY_DOCTOR_MESSAGE, 'FORBIDDEN');
  const q = parse(querySchema.pick({ period: true }), req.query);
  if (q.period === 'custom') throw new HttpError(400, 'Choose one of the periods offered.', 'VALIDATION');
  const today = hospitalToday(req.now);
  const period = parsePeriod(q, { audience: 'doctor', today });
  await refreshDueRisks(req.tenantId, req.now);
  const data = await loadHospital(req.tenantId, {
    now: req.now,
    today,
    windowFrom: windowFromOf(period, today),
    periodFrom: period.from,
    periodTo: period.to,
    needs: needsOf(metricIdsFor(['overview'], 'doctor')).concat('patients'),
  });
  const visible = visibleSet(req, data.patients);
  const numbers = (scope, userId) => {
    const ctx = buildContext(data, { now: req.now, today, period, scope, careType: 'all', audience: 'doctor', userId, visible });
    const { tiles } = computeSections(ctx, ['overview']);
    return { tiles, values: tiles.map((t) => countOf(rawValue(ctx, t.ref))) };
  };
  // Every doctor of the hospital now, and anyone else patients are still assigned to (a doctor who has left).
  const members = await Membership.find({ tenantId: req.tenantId, roles: 'doctor' }, { userId: 1, isActive: 1 }).lean();
  const active = new Map(members.map((m) => [String(m.userId), m.isActive !== false]));
  for (const p of data.patients) if (p.assignedDoctor && !active.has(String(p.assignedDoctor))) active.set(String(p.assignedDoctor), false);
  const users = await User.find({ _id: { $in: [...active.keys()] } }, { name: 1 }).lean();
  const hospital = numbers('hospital', req.user._id);
  const doctors = users
    .map((u) => ({ id: String(u._id), name: u.name, active: active.get(String(u._id)), you: String(u._id) === String(req.user._id), values: numbers('mine', u._id).values }))
    .filter((d) => d.active || d.values.some((v) => v > 0))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  await logView(req, 'doctors', 'hospital');
  res.json({
    today: isoDay(today),
    calculatedAt: req.now,
    period: periodJSON(period),
    columns: hospital.tiles.map((t) => ({ ref: t.ref, label: t.label, window: t.window })),
    doctors,
    hospital: hospital.values,
    leftOut: data.patients.length - visible.size,
  });
});

// The patients behind one number (doctors only; hospital admins and other roles never get patient lists).
// Every page served is recorded: the ids of the patients on it, each once (on the Deliveries tab a mother of twins
// has a row per baby), sorted by id so the entry shows no ranking.
analyticsRouter.get('/list', async (req, res) => {
  if (!hasRole(req.membership, ...DRILLDOWN_ROLES)) throw new HttpError(403, LISTS_FOR_DOCTORS_MESSAGE, 'FORBIDDEN');
  const q = parse(listSchema, req.query);
  const body = await listCell(req, q);
  const patientIds = [...new Set(body.patients.map((p) => p.id))].sort();
  await audit(req, 'ANALYTICS_LIST_VIEWED', { details: { patientIds, count: patientIds.length, page: body.page } });
  res.json(body);
});
