// Fake accounts and patients for scripts/load-test.mjs, in a THROW-AWAY database only (its name must end in
// "_loadtest"). Never on a server with real patients.
//
//   MONGO_URI=mongodb://127.0.0.1:27017/perinexa_loadtest DEMO_PASSWORD=<a test password> \
//     node scripts/load-test-seed.mjs [--patients 2000] [--api http://localhost:4000]
//
// Makes one fake hospital with the demo staff accounts the load test signs in with (demo.doctor@example.com …), then
// registers fake patients through the running server's own API (so they are made exactly as reception makes them).
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith('--') ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []));
const PATIENTS = Number(args.patients ?? 2000);
const API = (args.api ?? 'http://localhost:4000').replace(/\/$/, '');
const uri = process.env.MONGO_URI ?? '';
const password = process.env.DEMO_PASSWORD ?? '';
if (!/_loadtest$/.test(uri.split('?')[0])) throw new Error('MONGO_URI must name a throw-away database ending in "_loadtest"');
if (password.length < 12) throw new Error('Set DEMO_PASSWORD (at least 12 characters) for the fake accounts');

const server = (p) => new URL(`../server/src/${p}`, import.meta.url).href;
const { default: mongoose } = await import(fileURLToPath(new URL('../server/node_modules/mongoose/index.js', import.meta.url))).catch(() => import('mongoose'));
const { User } = await import(server('models/User.js'));
const { Tenant } = await import(server('models/Tenant.js'));
const { Membership } = await import(server('models/Membership.js'));
const { hashPassword } = await import(server('utils/password.js'));

const STAFF = [
  ['demo.doctor@example.com', 'Dr. Riley Demo', ['doctor']],
  ['demo.doctor2@example.com', 'Dr. Sam Second (Demo)', ['doctor']],
  ['demo.rmo@example.com', 'Rani Demo-RMO', ['rmo']],
  ['demo.nurse@example.com', 'Nico Demo-Nurse', ['nurse']],
  ['demo.reception@example.com', 'Ravi Demo-Reception', ['receptionist']],
  ['demo.lab@example.com', 'Lata Demo-Lab', ['lab']],
  ['demo.sonologist@example.com', 'Dr. Sona Demo-Sonologist', ['sonologist']],
  ['demo.admin@example.com', 'Dana Demo-Admin', ['admin']],
];

await mongoose.connect(uri);
const tenant = (await Tenant.findOne({ name: 'Load Test Hospital (fake)' })) ?? (await Tenant.create({ name: 'Load Test Hospital (fake)' }));
const passwordHash = await hashPassword(password);
const users = {};
for (const [email, name, roles] of STAFF) {
  const user = (await User.findOne({ email })) ?? (await User.create({ name, email, passwordHash, mustChangePassword: false }));
  users[email] = user;
  if (!(await Membership.exists({ tenantId: tenant._id, userId: user._id }))) {
    await Membership.create({ tenantId: tenant._id, userId: user._id, roles }).catch(() => Membership.create({ tenantId: tenant._id, userId: user._id, roles: ['doctor'] }));
  }
}
await mongoose.disconnect();
console.log(`Fake hospital and ${STAFF.length} accounts ready.`);

// Patients through the API, as reception
const login = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo.reception@example.com', password }) });
if (login.status !== 200) throw new Error(`Sign-in to ${API} failed (${login.status}) – is the server running on the same database?`);
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const { activeTenantId } = await login.json();
const CARE = ['gynaecology', 'antenatal', 'gynaecology', 'infertility'];
let made = 0;
for (let i = 0; i < PATIENTS; i += 20) {
  const batch = Array.from({ length: Math.min(20, PATIENTS - i) }, (_, k) => {
    const n = i + k;
    const careType = CARE[n % CARE.length];
    const body = {
      careType,
      fullName: `Loadtest Patient ${n}`,
      ageYears: 20 + (n % 25),
      phone: `+91 00000 ${String(10000 + n).slice(-5)}`,
      address: `${n} Sample Road`,
      assignedDoctor: String(users[n % 2 ? 'demo.doctor2@example.com' : 'demo.doctor@example.com']._id),
      registerAnyway: true,
      ...(careType === 'antenatal' ? { pregnancy: { lmp: new Date(Date.now() - (60 + (n % 180)) * 86400000).toISOString().slice(0, 10) } } : {}),
    };
    return fetch(`${API}/api/patients`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-Tenant-Id': activeTenantId }, body: JSON.stringify(body) }).then(async (r) => {
      if (r.status === 201) made += 1;
      else if (made === 0 && n < 3) console.log('  refused:', r.status, (await r.text()).slice(0, 200));
    });
  });
  await Promise.all(batch);
}
console.log(`${made} fake patients registered.`);
