// My profile (owner, 13 Oct 2026): name, work phone and staff number; the photo; the join date of each hospital.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

let app;
let person;
let s;
beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetTestDb();
  app = createApp();
  const hospital = await createTenant('Profile Hospital');
  person = await createUser({ name: 'Sample Reception' });
  await addMember(person, hospital, 'receptionist');
  s = await loginAs(person, { app });
});

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('my details', () => {
  it('the person changes their name, work phone and staff number; the change is audited', async () => {
    const res = await s.put('/api/auth/me/details').send({ name: 'Sample Front Desk', phone: '+91 98765 43210', employeeId: 'REC001' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.user).toMatchObject({ name: 'Sample Front Desk', phone: '+91 98765 43210', employeeId: 'REC001' });
    const entry = await AuditLog.findOne({ action: 'PROFILE_UPDATED' }).lean();
    expect(Object.keys(entry.details.changes).sort()).toEqual(['employeeId', 'name', 'phone']);
    expect((await s.get('/api/auth/me')).body.user.employeeId).toBe('REC001');
  });

  it('refuses a missing name, letters in the phone number, and the email (changed by the super admin only)', async () => {
    expect((await s.put('/api/auth/me/details').send({ name: '', phone: '', employeeId: '' })).body.error.fields.name).toBeTruthy();
    expect((await s.put('/api/auth/me/details').send({ name: 'Sample', phone: 'call me', employeeId: '' })).body.error.fields.phone).toBeTruthy();
    expect((await s.put('/api/auth/me/details').send({ name: 'Sample', email: 'new@example.com' })).status).toBe(400);
  });

  it('the hospitals come with the day the person joined', async () => {
    const me = (await s.get('/api/auth/me')).body;
    expect(me.memberships[0].joinedAt).toBeTruthy();
  });
});

describe('my photo', () => {
  it('a small picture is saved and removed; anything else is refused; the audit has no picture', async () => {
    expect((await s.put('/api/auth/me/photo').send({ photo: PIXEL })).body.user.photo).toBe(PIXEL);
    expect((await s.put('/api/auth/me/photo').send({ photo: 'data:text/html;base64,PHNjcmlwdD4=' })).status).toBe(400);
    expect((await s.put('/api/auth/me/photo').send({ photo: `data:image/png;base64,${'A'.repeat(130000)}` })).status).toBe(400);
    expect((await s.put('/api/auth/me/photo').send({ photo: null })).body.user.photo).toBeNull();
    const entries = await AuditLog.find({ action: 'PROFILE_UPDATED' }).lean();
    expect(entries.map((e) => e.details.changes.photo)).toEqual(['changed', 'removed']);
  });
});
