import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Membership } from '../src/models/Membership.js';
import { Tenant } from '../src/models/Tenant.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

export const PASSWORD = 'SamplePassw0rd!';

// Safety lock: tests empty the database they use, so they must only ever run against a database whose
// name ends in "_test" (set in vitest.config.js). If a test is started some other way (e.g. from another
// folder, so the config isn't used), stop instead of wiping the development data.
function assertTestDatabase() {
  const name = mongoose.connection.db?.databaseName ?? '';
  if (process.env.NODE_ENV !== 'test' || !name.endsWith('_test')) {
    throw new Error(`Refusing to run tests against the database "${name}" – run the tests with "npm test" from the project folder.`);
  }
}

export async function connectTestDb() {
  await mongoose.connect(process.env.MONGO_URI);
  try {
    assertTestDatabase();
  } catch (err) {
    await mongoose.disconnect();
    throw err;
  }
  // The test database is kept between test files and only emptied: building every index of a new database takes
  // about half a minute on a slower computer, more than a test file may wait to start. syncIndexes makes each
  // collection's indexes match the code (adding new ones, dropping old ones) – quick once they exist.
  await emptyTestDb();
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).syncIndexes()));
}

// Every collection of the test database emptied (also those of models this test file doesn't load).
async function emptyTestDb() {
  assertTestDatabase();
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

export async function resetTestDb() {
  assertTestDatabase();
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

export async function disconnectTestDb() {
  await emptyTestDb(); // emptied, not dropped: the next test file keeps the indexes (see connectTestDb)
  await mongoose.disconnect();
}

let counter = 0;
export async function createUser(overrides = {}) {
  counter += 1;
  const { password, ...rest } = overrides;
  return User.create({
    name: `Sample User ${counter}`,
    email: `sample${counter}@example.com`,
    passwordHash: await hashPassword(password ?? PASSWORD),
    mustChangePassword: false,
    ...rest,
  });
}

export const createSuperAdmin = (overrides = {}) => createUser({ isSuperAdmin: true, ...overrides });

export async function createTenant(name) {
  counter += 1;
  return Tenant.create({ name: name ?? `Sample Hospital ${counter}` });
}

// role can be one role ('doctor') or several (['doctor', 'admin']).
export const addMember = (user, tenant, role = 'doctor', extra = {}) =>
  Membership.create({ userId: user._id, tenantId: tenant._id, roles: [role].flat(), ...extra });

// Logs in and returns a browser-like agent that keeps the login cookie.
// Also returns activeTenantId, and helpers that send the "selected hospital" header.
export async function loginAs(user, { password = PASSWORD, app = createApp() } = {}) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password });
  if (res.status !== 200) throw new Error(`Login failed in test: ${res.status} ${JSON.stringify(res.body)}`);
  const session = { agent, activeTenantId: res.body.activeTenantId, body: res.body };
  const withTenant = (req) => req.set('X-Tenant-Id', session.activeTenantId ?? '');
  session.get = (url) => withTenant(agent.get(url));
  session.post = (url) => withTenant(agent.post(url));
  session.patch = (url) => withTenant(agent.patch(url));
  session.put = (url) => withTenant(agent.put(url));
  session.delete = (url) => withTenant(agent.delete(url));
  session.switchTo = async (tenant) => {
    const r = await agent.post('/api/auth/switch-tenant').send({ tenantId: tenant._id.toString() });
    if (r.status === 200) session.activeTenantId = r.body.activeTenantId;
    return r;
  };
  return session;
}

// registerAnyway: the tests register many sample patients with the same name, so every one is registered as the
// form does after "Register as a new patient anyway" (the warning itself is tested in patient-duplicates.test.js,
// which sends registerAnyway: false).
export const samplePatient = (overrides = {}) => ({
  careType: 'gynaecology',
  fullName: 'Test Patient',
  ageYears: 30,
  phone: '+91 00000 00000',
  address: '1 Sample Road',
  registerAnyway: true,
  ...overrides,
});
