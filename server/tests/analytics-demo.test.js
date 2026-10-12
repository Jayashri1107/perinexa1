// The Analytics demo set of `npm run seed:demo` (Feature 11, Step 3): about 60 FAKE patients over 12 months in
// the first demo hospital, so the owner's test shows real-looking cards and a hospital admin view that is not all
// "fewer than 5". These tests run the seed on the test database (never the development one) with the clock
// pinned, and open every Analytics page as each demo role.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedDemo } from '../scripts/seed-demo.js';
import { resetAdminViewCache } from '../src/analytics/adminView.js';
import { resetAnalyticsAuditThrottle } from '../src/analytics/auditThrottle.js';
import { createApp } from '../src/app.js';
import { resetApprovalBackfill, resetRiskRefreshTimer } from '../src/careplans/templatesService.js';
import { CarePlan } from '../src/models/CarePlan.js';
import { ClinicalDocument } from '../src/models/ClinicalDocument.js';
import { Patient } from '../src/models/Patient.js';
import { Visit } from '../src/models/Visit.js';
import { PASSWORD, connectTestDb, createSuperAdmin, disconnectTestDb, loginAs } from './helpers.js';

const NOW = new Date('2026-10-15T04:30:00Z'); // 10:00 in India
const SECTIONS = ['overview', 'pregnancy', 'risk', 'care', 'deliveries', 'newborn'];

let app;
let tenants;
const sessions = {};

/** Every cell value of a payload (tiles, totals, cells). */
function valuesOf(body) {
  const out = [...(body.tiles ?? []).map((t) => t.value)];
  for (const card of body.cards) {
    if (card.total) out.push(card.total.value);
    for (const c of card.cells) out.push(c.value);
  }
  return out;
}
const cellOf = (card, key) => (card.total?.key === key ? card.total : card.cells.find((c) => c.key === key));

beforeAll(async () => {
  await connectTestDb();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetRiskRefreshTimer();
  resetApprovalBackfill();
  resetAnalyticsAuditThrottle();
  resetAdminViewCache();
  ({ tenants } = await seedDemo(PASSWORD, { analytics: true }));
  app = createApp({ apiRateLimitMax: 100000 });
  const login = async (email) => {
    const s = await loginAs({ email }, { app });
    await s.switchTo(tenants[0]);
    return s;
  };
  sessions.doctor = await login('demo.doctor@example.com');
  sessions.admin = await login('demo.admin@example.com');
  sessions.rmo = await login('demo.rmo@example.com');
  sessions.reception = await login('demo.reception@example.com');
  sessions.lab = await login('demo.lab@example.com');
  sessions.nurse = await loginAs({ email: 'demo.nurse@example.com' }, { app }); // the nurse works in the second hospital
  const owner = await createSuperAdmin();
  sessions.platform = await loginAs(owner, { app });
});

afterAll(async () => {
  vi.useRealTimers();
  await disconnectTestDb();
});

describe('analytics demo data', () => {
  it('about 60 fake patients over the last 12 months in the first demo hospital, made once', async () => {
    const [first, second] = tenants.map((t) => t._id);
    const set = await Patient.find({ tenantId: first, fullName: /^Sample / }).lean();
    expect(set.length).toBeGreaterThanOrEqual(55);
    expect(set.length).toBeLessThanOrEqual(70);
    expect(set.every((p) => p.fullName.endsWith('(Demo)'))).toBe(true);
    expect(set.every((p) => !p.phone || p.phone.startsWith('+91 00000'))).toBe(true);
    expect(await Patient.countDocuments({ tenantId: second, fullName: /^Sample / })).toBe(0);
    const types = new Set(set.map((p) => p.careType));
    expect([...types].sort()).toEqual(['abortion', 'antenatal', 'gynaecology', 'infertility', 'newborn', 'postnatal']);
    // Spread over the year, with visits (BP and Hb) and care plans with items marked.
    const months = new Set(set.map((p) => p.createdAt.toISOString().slice(0, 7)));
    expect(months.size).toBeGreaterThanOrEqual(8);
    expect(set.every((p) => p.createdAt <= NOW)).toBe(true);
    const visits = await Visit.find({ tenantId: first, clientRequestId: /^demo-analytics-/ }).lean();
    expect(visits.length).toBeGreaterThan(100);
    expect(visits.some((v) => v.vitals?.hb != null)).toBe(true);
    expect(visits.some((v) => v.vitals?.bpSystolic >= 140)).toBe(true);
    expect(visits.filter((v) => v.status === 'cancelled')).toHaveLength(1);
    const plans = await CarePlan.find({ tenantId: first }).lean();
    expect(plans.length).toBeGreaterThanOrEqual(20);
    expect(plans.some((pl) => pl.items.some((i) => i.state === 'done'))).toBe(true);
    // A confirmed delivery note for each postnatal mother (the Deliveries tab), with her delivery on her record.
    const notes = await ClinicalDocument.find({ tenantId: first, kind: 'delivery', clientRequestId: /^demo-delivery-/ }).lean();
    expect(notes).toHaveLength(8);
    expect(notes.every((d) => d.status === 'signed' && d.signed?.role === 'doctor')).toBe(true);
    const mothers = await Patient.find({ tenantId: first, _id: { $in: notes.map((d) => d.patientId) } }).lean();
    expect(mothers.every((m) => m.careType === 'postnatal' && m.lastDelivery?.at)).toBe(true);
    // Running the seed again adds nothing.
    await seedDemo(PASSWORD, { analytics: true });
    expect(await Patient.countDocuments({ tenantId: first, fullName: /^Sample / })).toBe(set.length);
    expect(await Visit.countDocuments({ tenantId: first, clientRequestId: /^demo-analytics-/ })).toBe(visits.length);
    expect(await ClinicalDocument.countDocuments({ tenantId: first, kind: 'delivery', clientRequestId: /^demo-delivery-/ })).toBe(8);
  });

  it('the demo doctor sees every tab with real-looking numbers, and can open a list', async () => {
    const bodies = {};
    for (const section of SECTIONS) {
      const res = await sessions.doctor.get(`/api/analytics/sections/${section}`);
      expect(res.status, section).toBe(200);
      bodies[section] = res.body;
      expect(valuesOf(res.body).every((v) => v === null || typeof v === 'number')).toBe(true);
    }
    const tiles = Object.fromEntries(bodies.overview.tiles.map((t) => [t.ref, t.value]));
    expect(tiles['A2.total']).toBeGreaterThanOrEqual(20);
    expect(tiles['A4.all']).toBeGreaterThan(100);
    expect(tiles['G1.total']).toBeGreaterThanOrEqual(10);
    expect(bodies.overview.leftOut).toBeGreaterThanOrEqual(1); // the sensitive records of the second demo doctor
    const g1 = bodies.newborn.cards.find((c) => c.id === 'G1');
    expect(cellOf(g1, 'multiple').value).toBe(4); // two pairs of twins
    const a2 = bodies.pregnancy.cards.find((c) => c.id === 'A2');
    const t3 = cellOf(a2, 't3');
    expect(t3.value).toBeGreaterThan(0);
    const list = await sessions.doctor.get(`/api/analytics/list?metric=A2&cell=${t3.code}`);
    expect(list.status).toBe(200);
    expect(list.body.count).toBe(t3.value);
    // Deliveries: the 8 postnatal mothers' notes (two of twins, one with a stillborn twin).
    const h = (id) => bodies.deliveries.cards.find((c) => c.id === id);
    expect(h('H1').total.value).toBe(8);
    expect([cellOf(h('H3'), 'total').value, cellOf(h('H3'), 'still').value]).toEqual([11, 1]);
    expect(cellOf(h('H2'), 'yes').value).toBe(1);
    expect(cellOf(h('H4'), 'low').value).toBeGreaterThan(0);
  });

  it('the demo hospital admin sees numbers, not only "fewer than 5", and no 1 to 4', async () => {
    let exactFiveOrMore = 0;
    for (const section of SECTIONS) {
      const res = await sessions.admin.get(`/api/analytics/sections/${section}`);
      expect(res.status, section).toBe(200);
      const values = valuesOf(res.body);
      expect(values.some((v) => typeof v === 'number' && v >= 1 && v <= 4)).toBe(false);
      exactFiveOrMore += values.filter((v) => typeof v === 'number' && v >= 5).length;
      expect(res.body.cards.every((c) => c.allMasked)).toBe(false);
    }
    expect(exactFiveOrMore).toBeGreaterThanOrEqual(30);
  });

  it('RMOs, nurses, reception and lab staff get no Analytics', async () => {
    for (const who of ['rmo', 'nurse', 'reception', 'lab']) {
      const res = await sessions[who].get('/api/analytics/sections/overview');
      expect(res.status, who).toBe(403);
      expect(res.body.error).toEqual({ message: 'Analytics is for doctors and hospital admins. Ask your hospital admin if you need it.', code: 'FORBIDDEN' });
    }
  });

  it('the super admin sees both demo hospitals, numbers only', async () => {
    const res = await sessions.platform.get('/api/platform/analytics/sections/overview');
    expect(res.status).toBe(200);
    expect(res.body.hospitals.map((h) => h.name).sort()).toEqual(['Lakeside Clinic (Demo)', 'Sunrise General Hospital (Demo)']);
    expect(JSON.stringify(res.body)).not.toMatch(/P-\d{6}|Sample /);
  });
});
