// Super admin overview numbers, sorting, filters and audit log search.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

const app = createApp();
let root;
let s;

beforeAll(connectTestDb);
beforeEach(async () => {
  await resetTestDb();
  root = await createSuperAdmin({ name: 'Root Admin' });
  s = await loginAs(root, { app });
});
afterAll(disconnectTestDb);

describe('GET /api/platform/stats', () => {
  it('summarises hospitals, accounts and security events', async () => {
    const withAdmin = await createTenant('Has Admin');
    await createTenant('Needs Admin');
    const off = await createTenant('Closed');
    off.isActive = false;
    await off.save();
    const a = await createUser();
    await addMember(a, withAdmin, 'admin');
    await createUser({ mustChangePassword: true });
    await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'x' });

    const res = await s.agent.get('/api/platform/stats');
    expect(res.status).toBe(200);
    expect(res.body.tenants).toEqual({ total: 3, active: 2, withoutAdmin: 1 });
    expect(res.body.tenantsWithoutAdmin.map((t) => t.name)).toEqual(['Needs Admin']);
    expect(res.body.users).toMatchObject({ active: 3, superAdmins: 1, pendingFirstLogin: 1 });
    expect(res.body.security.failedLogins24h).toBe(1);
    expect(res.body.recentActivity.length).toBeGreaterThan(0);
  });

  it('is for super admins only', async () => {
    const t = await createTenant();
    const u = await createUser();
    await addMember(u, t, 'admin');
    const h = await loginAs(u, { app });
    expect((await h.get('/api/platform/stats')).status).toBe(403);
  });
});

describe('sorting and filters', () => {
  it('sorts hospitals by name either way', async () => {
    for (const n of ['Bravo', 'Alpha', 'Charlie']) await createTenant(n);
    const asc = await s.agent.get('/api/platform/tenants?sort=name');
    expect(asc.body.tenants.map((t) => t.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    const desc = await s.agent.get('/api/platform/tenants?sort=-name');
    expect(desc.body.tenants.map((t) => t.name)).toEqual(['Charlie', 'Bravo', 'Alpha']);
    expect((await s.agent.get('/api/platform/tenants?sort=hack')).status).toBe(400);
  });

  it('sorts users and filters those who still need to change their password', async () => {
    await createUser({ name: 'Zed' });
    await createUser({ name: 'Amy', mustChangePassword: true });
    const byName = await s.agent.get('/api/platform/users?sort=name');
    expect(byName.body.users.map((u) => u.name)).toEqual(['Amy', 'Root Admin', 'Zed']);
    const pending = await s.agent.get('/api/platform/users?status=pending');
    expect(pending.body.users.map((u) => u.name)).toEqual(['Amy']);
  });

  it('pages through large lists', async () => {
    for (let i = 0; i < 30; i++) await createTenant(`Hospital ${String(i).padStart(2, '0')}`);
    const p2 = await s.agent.get('/api/platform/tenants?sort=name&limit=25&page=2');
    expect(p2.body).toMatchObject({ total: 30, totalPages: 2, page: 2 });
    expect(p2.body.tenants.map((t) => t.name)).toEqual(['Hospital 25', 'Hospital 26', 'Hospital 27', 'Hospital 28', 'Hospital 29']);
    expect((await s.agent.get('/api/platform/tenants?limit=500')).status).toBe(400);
  });
});

describe('audit log search', () => {
  it('filters by category, person and date range', async () => {
    const t = await createTenant('Audit Hospital');
    const person = await createUser({ email: 'person@example.com' });
    await AuditLog.create([
      { action: 'LOGIN_FAILED', actorEmail: 'x@example.com', createdAt: new Date('2026-01-10T10:00:00Z') },
      { action: 'MEMBER_ADDED', tenantId: t._id, target: person._id, targetEmail: person.email, createdAt: new Date('2026-02-10T10:00:00Z') },
      { action: 'PATIENT_VIEWED', tenantId: t._id, actor: person._id, actorEmail: person.email, createdAt: new Date('2026-03-10T10:00:00Z') },
    ]);

    const security = await s.agent.get('/api/platform/audit-logs?category=security');
    expect(security.body.entries.map((e) => e.action)).toEqual(['LOGIN_FAILED']);
    expect(security.body.actions).toContain('PASSWORD_RESET');

    const byPerson = await s.agent.get(`/api/platform/audit-logs?userId=${person._id}`);
    expect(byPerson.body.entries.map((e) => e.action)).toEqual(['PATIENT_VIEWED', 'MEMBER_ADDED']);

    const range = await s.agent.get('/api/platform/audit-logs').query({ from: '2026-02-01T00:00:00.000Z', to: '2026-02-28T23:59:59.999Z' });
    expect(range.body.entries.map((e) => e.action)).toEqual(['MEMBER_ADDED']);

    const bad = await s.agent.get('/api/platform/audit-logs').query({ from: '2026-03-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' });
    expect(bad.status).toBe(400);
  });
});
