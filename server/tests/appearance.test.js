// My account → Appearance: each person's look, saved to their account. Fake data only.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { User } from '../src/models/User.js';
import { APPEARANCE_CHOICES, STANDARD_APPEARANCE } from '../src/utils/appearance.js';
import * as website from '../../client/src/appearance.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

const app = createApp();
const URL = '/api/auth/me/appearance';
const LOOK = { theme: 'contrast', font: 'mukta', textSize: 'xlarge', density: 'compact', motion: 'off', help: 'shown' };

beforeAll(connectTestDb);
beforeEach(resetTestDb);
afterAll(disconnectTestDb);

async function nurse() {
  const user = await createUser({ name: 'Sample Nurse' });
  await addMember(user, await createTenant(), 'nurse');
  return { user, session: await loginAs(user, { app }) };
}

describe('a person’s look', () => {
  it('is the standard look until they choose', async () => {
    const { session } = await nurse();
    const me = await session.agent.get('/api/auth/me');
    expect(me.body.user.preferences.appearance).toEqual(STANDARD_APPEARANCE);
  });

  it('is saved to their account and comes back at every login, without an audit entry', async () => {
    const { user, session } = await nurse();
    const notLogins = { action: { $ne: 'LOGIN_SUCCESS' } };
    const before = await AuditLog.countDocuments(notLogins);
    const res = await session.agent.put(URL).send(LOOK);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.appearance).toEqual(LOOK);
    expect((await User.findById(user._id).lean()).preferences.appearance).toEqual(LOOK);
    const again = await loginAs(user, { app }); // another computer
    expect(again.body.user.preferences.appearance).toEqual(LOOK);
    expect(await AuditLog.countDocuments(notLogins)).toBe(before);
  });

  it('takes only the choices on offer', async () => {
    const { session } = await nurse();
    const bad = await session.agent.put(URL).send({ ...LOOK, theme: 'neon' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.theme).toMatch(/colour template/);
    expect((await session.agent.put(URL).send({ ...LOOK, fontSize: 30 })).status).toBe(400); // unknown field
    const { motion: _m, ...missing } = LOOK;
    expect((await session.agent.put(URL).send(missing)).body.error.fields.motion).toBeTruthy();
    // "help" came later: when it isn't sent, explanations stay hidden (the standard)
    const { help: _h, ...withoutHelp } = LOOK;
    const older = await session.agent.put(URL).send(withoutHelp);
    expect(older.status).toBe(200);
    expect(older.body.appearance.help).toBe('hidden');
    expect((await session.agent.put(URL).send({ ...LOOK, help: 'maybe' })).body.error.fields.help).toBeTruthy();
  });

  it('needs a login, and a changed first password', async () => {
    expect((await request(app).put(URL).send(LOOK)).status).toBe(401);
    const fresh = await createUser({ mustChangePassword: true });
    const session = await loginAs(fresh, { app });
    expect((await session.agent.put(URL).send(LOOK)).status).toBe(403);
  });

  it('offers the same choices on the website and the server', () => {
    expect(website.APPEARANCE_CHOICES).toEqual(APPEARANCE_CHOICES);
    expect(website.STANDARD_APPEARANCE).toEqual(STANDARD_APPEARANCE);
  });
});
