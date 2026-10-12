// Feature 2: hospital letterhead and doctors' professional details.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Tenant } from '../src/models/Tenant.js';
import { addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

const app = createApp();
let home;
let other;

beforeAll(connectTestDb);
beforeEach(async () => {
  await resetTestDb();
  home = await createTenant('Home Hospital');
  other = await createTenant('Other Hospital');
});
afterAll(disconnectTestDb);

const LETTERHEAD = {
  name: 'Home Maternity Hospital',
  tagline: "Women's & Newborn Care",
  address: '1 Sample Road, Test City',
  phone: '+91 00000 00000',
  email: 'Info@Example.com',
  registrationNumber: 'HOSP-REG-123',
  footer: 'Sample footer',
};

describe('hospital letterhead', () => {
  it('uses the hospital name until the admin sets a letterhead', async () => {
    const doc = await createUser();
    await addMember(doc, home, 'doctor');
    const d = await loginAs(doc, { app });
    const res = await d.get('/api/tenant/settings/letterhead');
    expect(res.status).toBe(200);
    expect(res.body.letterhead.name).toBe('Home Hospital');
  });

  it('only the hospital admin can change it, and the change is audited', async () => {
    const admin = await createUser();
    await addMember(admin, home, ['admin', 'doctor']);
    const a = await loginAs(admin, { app });
    const res = await a.agent.put('/api/tenant/settings/letterhead').set('X-Tenant-Id', a.activeTenantId).send(LETTERHEAD);
    expect(res.status).toBe(200);
    expect(res.body.letterhead).toMatchObject({ name: 'Home Maternity Hospital', email: 'info@example.com' });
    const entry = await AuditLog.findOne({ action: 'TENANT_SETTINGS_UPDATED' });
    expect(entry.tenantId.toString()).toBe(home._id.toString());

    const nurse = await createUser();
    await addMember(nurse, home, 'nurse');
    const n = await loginAs(nurse, { app });
    expect((await n.agent.put('/api/tenant/settings/letterhead').set('X-Tenant-Id', n.activeTenantId).send(LETTERHEAD)).status).toBe(403);
    expect((await n.get('/api/tenant/settings/letterhead')).body.letterhead.name).toBe('Home Maternity Hospital');
  });

  it('is kept separate per hospital', async () => {
    const admin = await createUser();
    await addMember(admin, home, 'admin');
    await addMember(admin, other, 'admin');
    const a = await loginAs(admin, { app });
    await a.switchTo(home);
    await a.agent.put('/api/tenant/settings/letterhead').set('X-Tenant-Id', a.activeTenantId).send(LETTERHEAD);
    await a.switchTo(other);
    expect((await a.get('/api/tenant/settings/letterhead')).body.letterhead.name).toBe('Other Hospital');
  });

  it('validates the fields', async () => {
    const admin = await createUser();
    await addMember(admin, home, 'admin');
    const a = await loginAs(admin, { app });
    const res = await a.agent.put('/api/tenant/settings/letterhead').set('X-Tenant-Id', a.activeTenantId).send({ email: 'nope', name: 'x'.repeat(200) });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['email', 'name']);
  });

  it('has no PC-PNDT number any more (removed 2 Oct 2026): an old stored one is kept but never returned or changed', async () => {
    // Stored before the field was removed (written directly: the model no longer knows the field).
    await Tenant.collection.updateOne({ _id: home._id }, { $set: { 'letterhead.pcpndtRegistration': 'OLD-PNDT-1' } });
    const admin = await createUser();
    await addMember(admin, home, 'admin');
    const a = await loginAs(admin, { app });
    const before = await a.get('/api/tenant/settings/letterhead');
    expect(before.status).toBe(200);
    expect(before.body.letterhead).not.toHaveProperty('pcpndtRegistration');
    expect(before.body.saved).not.toHaveProperty('pcpndtRegistration');

    const res = await a.agent.put('/api/tenant/settings/letterhead').set('X-Tenant-Id', a.activeTenantId).send({ ...LETTERHEAD, pcpndtRegistration: 'NEW-PNDT-2' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.letterhead).not.toHaveProperty('pcpndtRegistration');
    expect(res.body.saved).not.toHaveProperty('pcpndtRegistration');
    expect(res.body.saved).toMatchObject({ name: 'Home Maternity Hospital', registrationNumber: 'HOSP-REG-123' });
    const raw = await Tenant.collection.findOne({ _id: home._id });
    expect(raw.letterhead.pcpndtRegistration).toBe('OLD-PNDT-1'); // kept as it was, not wiped and not replaced
    expect(raw.letterhead.name).toBe('Home Maternity Hospital');
    const entry = await AuditLog.findOne({ action: 'TENANT_SETTINGS_UPDATED' }).lean();
    expect(entry.details.changes).not.toHaveProperty('pcpndtRegistration');
  });
});

describe('professional details', () => {
  it('a doctor sets their own qualification and registration number', async () => {
    const doc = await createUser();
    await addMember(doc, home, 'doctor');
    const d = await loginAs(doc, { app });
    const res = await d.agent.put('/api/auth/me/professional').send({ qualification: 'MBBS, MS (OBGY)', registrationNumber: 'REG-001', council: 'Sample Medical Council' });
    expect(res.status).toBe(200);
    expect(res.body.user.professional).toEqual({ qualification: 'MBBS, MS (OBGY)', registrationNumber: 'REG-001', council: 'Sample Medical Council' });
    expect((await d.agent.get('/api/auth/me')).body.user.professional.registrationNumber).toBe('REG-001');
    expect(await AuditLog.countDocuments({ action: 'PROFILE_UPDATED' })).toBe(1);
  });

  it('a super admin can correct them', async () => {
    const doc = await createUser();
    const root = await createSuperAdmin();
    const r = await loginAs(root, { app });
    const res = await r.agent.patch(`/api/platform/users/${doc._id}`).send({ professional: { qualification: 'MBBS', registrationNumber: 'R-9', council: '' } });
    expect(res.body.user.professional.registrationNumber).toBe('R-9');
  });
});
