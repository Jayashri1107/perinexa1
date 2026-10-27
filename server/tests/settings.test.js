// Feature 2: hospital letterhead and doctors' professional details. Also the referral settings (docs/REFERRALS_PLAN.md).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Membership } from '../src/models/Membership.js';
import { Referral } from '../src/models/Referral.js';
import { Tenant } from '../src/models/Tenant.js';
import { User } from '../src/models/User.js';
import { PASSWORD, addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

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
    // A doctor who is also the admin changes the letterhead as the admin (22 Oct 2026)
    expect((await a.agent.put('/api/tenant/settings/letterhead').set('X-Tenant-Id', a.activeTenantId).send(LETTERHEAD)).status).toBe(403);
    expect((await a.post('/api/auth/switch-to-admin').send({ password: PASSWORD })).status).toBe(200);
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

// The hospital's logo on its letterhead (owner, 27 Oct 2026): a real PNG or JPEG, at most 150 KB, never in the audit log
describe('the hospital logo', () => {
  it('keeps a real picture, refuses anything else, and the audit log says only that it changed', async () => {
    const admin = await createUser();
    await addMember(admin, home, 'admin');
    const a = await loginAs(admin, { app });
    const put = (logo) => a.agent.put('/api/tenant/settings/letterhead').set('X-Tenant-Id', a.activeTenantId).send({ ...LETTERHEAD, logo });
    const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString('base64')}`;
    const res = await put(png);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.letterhead.logo).toBe(png);
    const fake = `data:image/png;base64,${Buffer.from('<svg onload=alert(1)>').toString('base64')}`;
    expect((await put(fake)).body.error.fields.logo).toMatch(/PNG or JPEG/);
    expect((await put('data:image/svg+xml;base64,AAAA')).status).toBe(400);
    const entry = await AuditLog.findOne({ action: 'TENANT_SETTINGS_UPDATED', 'details.changes.logo': { $exists: true } }).lean();
    expect(entry.details.changes.logo).toEqual({ changed: true });
    expect((await put('')).body.letterhead.logo).toBe('');
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

describe('referral settings', () => {
  const URL = '/api/tenant/settings/referrals';
  const DEFAULTS = {
    centres: [
      { key: 'sutgirni', name: 'Sutgirni Chowk', active: true },
      { key: 'adalat', name: 'Adalat Road', active: true },
    ],
    deskNumber: '',
    consultantLines: [],
    workingHours: { days: [1, 2, 3, 4, 5, 6], from: '09:00', to: '20:00' },
    holidays: [],
    urgentCutoff: '20:00',
    urgentNextMorning: '08:00',
  };
  const member = async (roles, tenant = home) => {
    const user = await createUser();
    await addMember(user, tenant, roles);
    return { user, s: await loginAs(user, { app }) };
  };
  // Fake sample values only: the audit entry must hold none of them
  const settingsWith = (doctorId) => ({
    centres: [
      { key: 'sutgirni', name: 'Sutgirni Chowk', active: true },
      { key: 'adalat', name: 'Adalat Road', active: false },
      { key: 'sample_centre', name: 'Sample Centre (Test)', active: true },
    ],
    deskNumber: '+91 00000 00099',
    consultantLines: [{ userId: doctorId, phone: '+91 00000 00098', note: 'Sample note: mornings only' }],
    workingHours: { days: [6, 1, 2, 3, 4, 5], from: '10:00', to: '19:00' },
    holidays: [
      { on: '2026-12-25', note: 'Sample holiday two' },
      { on: '2026-11-08', note: 'Sample holiday one' },
    ],
    urgentCutoff: '21:00',
    urgentNextMorning: '07:30',
  });

  it('everyone in the hospital reads them; a hospital that never saved them gets the defaults', async () => {
    const { s: d, user: doctor } = await member('doctor');
    const res = await d.get(URL);
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual(DEFAULTS);
    expect(res.body.canEdit).toBe(false);
    // the hospital's doctors who work here now, for the direct lines: id and name only
    expect(res.body.doctors).toEqual([{ id: String(doctor._id), name: doctor.name }]);
    for (const role of ['nurse', 'referral_desk', 'lab']) {
      const { s: other } = await member(role);
      const r = await other.get(URL);
      expect(r.status, role).toBe(200);
      expect(r.body.canEdit, role).toBe(false);
    }
    const { s: a } = await member('admin');
    expect((await a.get(URL)).body.canEdit).toBe(true);
  });

  it('only the hospital admin changes them; the audit entry names the settings changed, never their values', async () => {
    const { user: doctor, s: d } = await member('doctor');
    const { s: a } = await member('admin');
    const body = settingsWith(String(doctor._id));
    for (const who of [d, (await member('referral_desk')).s, (await member('nurse')).s]) {
      expect((await who.put(URL).send(body)).status).toBe(403);
    }
    expect(await AuditLog.countDocuments({ action: 'REFERRAL_SETTINGS_CHANGED' })).toBe(0);

    const res = await a.put(URL).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // working days Sunday→Saturday and holidays by date
    expect(res.body.settings).toEqual({
      ...body,
      workingHours: { days: [1, 2, 3, 4, 5, 6], from: '10:00', to: '19:00' },
      holidays: [
        { on: '2026-11-08', note: 'Sample holiday one' },
        { on: '2026-12-25', note: 'Sample holiday two' },
      ],
    });
    expect(res.body.canEdit).toBe(true);
    // everyone reads the new settings
    expect((await d.get(URL)).body.settings.deskNumber).toBe('+91 00000 00099');

    const entries = await AuditLog.find({ action: 'REFERRAL_SETTINGS_CHANGED' }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0].tenantId.toString()).toBe(home._id.toString());
    expect(entries[0].details).toEqual({ fields: ['centres', 'deskNumber', 'consultantLines', 'workingHours', 'holidays', 'urgentCutoff', 'urgentNextMorning'] });
    const written = JSON.stringify(entries[0].details);
    for (const value of ['00099', '00098', 'Sample', 'mornings', String(doctor._id), '2026-']) expect(written).not.toContain(value);

    // The same again changes nothing and writes nothing; one field sent changes only that one
    expect((await a.put(URL).send(body)).status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'REFERRAL_SETTINGS_CHANGED' })).toBe(1);
    const one = await a.put(URL).send({ deskNumber: '+91 00000 00097' });
    expect(one.body.settings).toMatchObject({ deskNumber: '+91 00000 00097', urgentCutoff: '21:00', consultantLines: body.consultantLines });
    const last = await AuditLog.findOne({ action: 'REFERRAL_SETTINGS_CHANGED' }).sort({ createdAt: -1 }).lean();
    expect(last.details).toEqual({ fields: ['deskNumber'] });

    // Never in the hospital's JSON (the platform's lists of hospitals); kept per hospital
    const tenant = await Tenant.findById(home._id);
    expect(tenant.toJSON().referrals).toBeUndefined();
    expect(tenant.referrals.deskNumber).toBe('+91 00000 00097');
    const { s: elsewhere } = await member('doctor', other);
    expect((await elsewhere.get(URL)).body.settings).toEqual(DEFAULTS);
  });

  it('checks the fields', async () => {
    const { s: a } = await member('admin');
    const res = await a.put(URL).send({
      centres: [
        { key: 'Bad Key', name: '' },
        { key: 'waluj', name: 'Waluj', active: false },
        { key: 'waluj', name: 'Waluj again', active: false },
      ],
      deskNumber: 'call us',
      consultantLines: [{ userId: 'nope', phone: '' }],
      workingHours: { days: [1, 1, 7], from: '20:00', to: '09:00' },
      holidays: [{ on: '2026-02-30' }, { on: '2026-12-25' }, { on: '2026-12-25' }],
      urgentCutoff: '8 pm',
      urgentNextMorning: '08:00',
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual([
      'centres.0.key',
      'centres.0.name',
      'centres.2.key',
      'consultantLines.0.phone',
      'consultantLines.0.userId',
      'deskNumber',
      'holidays.0.on',
      'holidays.2.on',
      'urgentCutoff',
      'workingHours.days',
      'workingHours.days.2',
      'workingHours.to',
    ]);
    // At least one centre in use and one working day; at most 10 centres, 30 direct lines and 100 holidays
    const counts = await a.put(URL).send({ centres: [{ key: 'only', name: 'Only Centre', active: false }], workingHours: { days: [], from: '09:00', to: '20:00' } });
    expect(counts.body.error.fields).toMatchObject({ centres: 'Keep at least one centre in use.', 'workingHours.days': 'Choose at least one working day.' });
    const many = await a.put(URL).send({
      centres: Array.from({ length: 11 }, (_, i) => ({ key: `centre_${i}`, name: `Centre ${i}` })),
      consultantLines: Array.from({ length: 31 }, () => ({ userId: String(home._id), phone: '1' })),
      holidays: Array.from({ length: 101 }, (_, i) => ({ on: new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10) })),
    });
    expect(Object.keys(many.body.error.fields)).toEqual(expect.arrayContaining(['centres', 'consultantLines', 'holidays']));
    expect(await AuditLog.countDocuments({ action: 'REFERRAL_SETTINGS_CHANGED' })).toBe(0);
  });

  it('a direct line is for a doctor who works at this hospital now', async () => {
    const { s: a } = await member('admin');
    const { user: nurse } = await member('nurse');
    const { user: outsider } = await member('doctor', other);
    const { user: left } = await member('doctor');
    await Membership.updateOne({ tenantId: home._id, userId: left._id }, { $set: { isActive: false } });
    const { user: closedAccount } = await member('doctor');
    await User.updateOne({ _id: closedAccount._id }, { $set: { isActive: false } });
    const { user: doctor } = await member('doctor');
    const lines = [nurse, outsider, left, closedAccount, doctor].map((u) => ({ userId: String(u._id), phone: '+91 00000 00098' }));
    const res = await a.put(URL).send({ consultantLines: lines });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['consultantLines.0.userId', 'consultantLines.1.userId', 'consultantLines.2.userId', 'consultantLines.3.userId']);
    // only the doctor who works here now is offered
    expect((await a.get(URL)).body.doctors.map((d) => d.id)).toEqual([String(doctor._id)]);
    const ok = await a.put(URL).send({ consultantLines: [lines[4]] });
    expect(ok.status).toBe(200);
    expect(ok.body.settings.consultantLines).toEqual([{ userId: String(doctor._id), phone: '+91 00000 00098', note: '' }]);
    // the same doctor twice
    expect((await a.put(URL).send({ consultantLines: [lines[4], lines[4]] })).body.error.fields).toHaveProperty(['consultantLines.1.userId']);
  });

  it('a centre that referrals were logged for stays on the list (marked not in use instead)', async () => {
    const { s: a } = await member('admin');
    // A referral at Adalat Road (written directly: only its centre matters here)
    await Referral.collection.insertOne({ tenantId: home._id, centre: 'adalat', number: 'REF-000001' });
    const removed = await a.put(URL).send({ centres: [{ key: 'sutgirni', name: 'Sutgirni Chowk', active: true }] });
    expect(removed.status).toBe(400);
    expect(removed.body.error.fields.centres).toMatch(/Adalat Road has referrals/);
    const notInUse = await a.put(URL).send({ centres: [{ key: 'sutgirni', name: 'Sutgirni Chowk', active: true }, { key: 'adalat', name: 'Adalat Road', active: false }] });
    expect(notInUse.status).toBe(200);
    // a centre with no referrals can be taken off the list
    const noSutgirni = await a.put(URL).send({ centres: [{ key: 'adalat', name: 'Adalat Road', active: true }] });
    expect(noSutgirni.status).toBe(200);
    expect(noSutgirni.body.settings.centres).toEqual([{ key: 'adalat', name: 'Adalat Road', active: true }]);
  });
});
