// Analytics performance budget (Analytics specification, section 4.8). Fake data only.
//
// Skipped unless ANALYTICS_PERF=1. Only the main session runs it, once, with
// `ANALYTICS_PERF=1 PERINEXA_TEST_DB=<this copy's _test database> npm test` from the project folder, and writes the
// timings it prints into docs/PROGRESS.md. It seeds five fake hospitals of 10,000 patients, 60,000 visits over
// 24 months and 3,000 care plans each (analyticsPerfSeed.js, through the models) into the _test database, which
// every test file empties. Seeding takes about 20 minutes.
//
// Every page is measured first and the budgets are checked after, so one run gives the whole table even when a
// budget is missed.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { resetAdminViewCache } from '../src/analytics/adminView.js';
import { resetAnalyticsAuditThrottle } from '../src/analytics/auditThrottle.js';
import { resetSectionCache } from '../src/analytics/sectionCache.js';
import { SECTIONS } from '../src/analytics/registry.js';
import { resetRiskRefreshTimer } from '../src/careplans/templatesService.js';
import { connectTestDb, createSuperAdmin, disconnectTestDb, loginAs } from './helpers.js';
import { seedHospital } from './analyticsPerfSeed.js';

const RUN = process.env.ANALYTICS_PERF === '1';
const HOSPITALS = 5;
const RUNS = 10; // requests per measured page (p95 of these)

// Budgets in seconds (payload in KB).
const BUDGET = { doctor: 1.0, adminUncached: 3.0, adminCached: 0.2, list: 1.0, platformOne: 1.5, platformAll: 6.0, payloadKb: 150 };

const p95 = (times) => {
  const s = [...times].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)];
};

async function timed(fn) {
  const start = performance.now();
  const res = await fn();
  return { res, seconds: (performance.now() - start) / 1000 };
}

describe.skipIf(!RUN)('analytics performance (ANALYTICS_PERF=1)', () => {
  const now = new Date();
  let app;
  let hospitals;
  let sessions;
  const results = [];
  /** Records one timing (and payload) and returns whether it is within its budget. */
  const record = (what, seconds, budget, kb = null) => {
    const ok = seconds <= budget && (kb == null || kb <= BUDGET.payloadKb);
    results.push({ what, seconds: Number(seconds.toFixed(3)), budget, kb: kb == null ? null : Number(kb.toFixed(1)), ok });
    // eslint-disable-next-line no-console
    console.log(`Analytics performance: ${what}: ${seconds.toFixed(3)} s (budget ${budget} s)${kb == null ? '' : `, ${kb.toFixed(1)} KB`}${ok ? '' : ' – OVER BUDGET'}`);
    return ok;
  };
  const kbOf = (res) => Buffer.byteLength(res.text ?? JSON.stringify(res.body)) / 1024;
  /** p95 (and largest payload) of RUNS requests to one url. */
  async function measure(session, url) {
    const times = [];
    let kb = 0;
    for (let r = 0; r < RUNS; r += 1) {
      const { res, seconds } = await timed(() => session.get(url));
      expect(res.status, url).toBe(200);
      times.push(seconds);
      kb = Math.max(kb, kbOf(res));
    }
    return { seconds: p95(times), kb };
  }

  beforeAll(async () => {
    await connectTestDb();
    resetRiskRefreshTimer();
    resetAnalyticsAuditThrottle();
    resetAdminViewCache();
    resetSectionCache();
    app = createApp({ apiRateLimitMax: 100000, analyticsCacheMs: 60_000 }); // as in production (tests turn it off)
    hospitals = [];
    for (let n = 1; n <= HOSPITALS; n += 1) hospitals.push(await seedHospital(n, now));
    const superAdmin = await createSuperAdmin({ name: 'Super Admin Perf Sample' });
    sessions = {
      doctor: await loginAs(hospitals[0].drA, { app }),
      admin: await loginAs(hospitals[0].admin, { app }),
      superAdmin: await loginAs(superAdmin, { app }),
    };
  }, 40 * 60_000);
  afterAll(async () => {
    // eslint-disable-next-line no-console
    console.table(results);
    await disconnectTestDb();
  });

  it('a doctor, one section: p95 at most 1.0 s; every payload at most 150 KB', async () => {
    const over = [];
    // The first request of each section is worked out in full (risk levels brought up to date, nothing kept yet).
    // Recorded for information: the budget is the p95, and a doctor's page is then kept for 60 seconds (§4.8).
    for (const s of SECTIONS) {
      const first = await timed(() => sessions.doctor.get(`/api/analytics/sections/${s}`));
      expect(first.res.status).toBe(200);
      record(`doctor ${s}, first request, worked out in full (information)`, first.seconds, BUDGET.doctor, kbOf(first.res));
    }
    for (const s of SECTIONS) {
      const { seconds, kb } = await measure(sessions.doctor, `/api/analytics/sections/${s}`);
      if (!record(`doctor ${s} (p95 of ${RUNS})`, seconds, BUDGET.doctor, kb)) over.push(`doctor ${s}`);
    }
    expect(over).toEqual([]);
  }, 15 * 60_000);

  it('one patient list page: at most 1.0 s', async () => {
    const { seconds } = await measure(sessions.doctor, '/api/analytics/list?metric=A2&cell=c3&page=1&limit=25');
    expect(record(`list page (p95 of ${RUNS})`, seconds, BUDGET.list)).toBe(true);
  }, 10 * 60_000);

  it('a hospital admin: at most 3.0 s uncached, 0.2 s cached', async () => {
    const over = [];
    resetAdminViewCache();
    resetRiskRefreshTimer();
    const first = await timed(() => sessions.admin.get('/api/analytics/sections/overview'));
    expect(first.res.status).toBe(200);
    if (!record('admin overview, uncached (all sections, four periods, masking)', first.seconds, BUDGET.adminUncached, kbOf(first.res))) over.push('admin uncached');
    for (const s of SECTIONS) {
      const { seconds, kb } = await measure(sessions.admin, `/api/analytics/sections/${s}`);
      if (!record(`admin ${s}, cached (p95 of ${RUNS})`, seconds, BUDGET.adminCached, kb)) over.push(`admin ${s} cached`);
    }
    expect(over).toEqual([]);
  }, 10 * 60_000);

  it('the super admin: one hospital at most 1.5 s, all five at most 6 s', async () => {
    const over = [];
    const one = String(hospitals[0].tenant._id);
    for (const s of SECTIONS) {
      const single = await timed(() => sessions.superAdmin.get(`/api/platform/analytics/sections/${s}?hospital=${one}`));
      expect(single.res.status).toBe(200);
      if (!record(`platform ${s}, one hospital`, single.seconds, BUDGET.platformOne, kbOf(single.res))) over.push(`platform ${s} one`);

      const all = await timed(() => sessions.superAdmin.get(`/api/platform/analytics/sections/${s}`));
      expect(all.res.status).toBe(200);
      expect(all.res.body.hospitals).toHaveLength(HOSPITALS);
      if (!record(`platform ${s}, all ${HOSPITALS} hospitals`, all.seconds, BUDGET.platformAll, kbOf(all.res))) over.push(`platform ${s} all`);
    }
    expect(over).toEqual([]);
  }, 15 * 60_000);
});
