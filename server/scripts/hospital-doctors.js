// The hospital's doctors by department (from the handwritten lists, 6 Nov 2026) – names and departments only.
//
//   npm run doctors:hospital -w server -- "Hospital name"
//
// Adds each doctor the hospital does not have yet as a doctor of that hospital, with their departments and OPD timings
// (Monday to Saturday 10:00–17:00, Sunday 11:00–16:00), as the hospital admin (USER_CREATED, MEMBER_ADDED and
// OPD_TIMINGS_CHANGED in the audit log). A doctor already there by the same name only gains any department missing.
// The real emails are not known yet: each account gets a made-up address that can receive nothing
// (…@doctors.<hospital>.invalid) and a random password that is never shown, so nobody can sign in with it. The hospital
// admin enters the real email in Hospital admin → Staff and resets the password, which gives the doctor a temporary one.
// Running it again adds nothing; it never removes a doctor, a department or a timing. A.S. (General) is left out until
// the full name is known.
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { DEPARTMENTS, Membership, OLD_DEPARTMENTS, newDepartments } from '../src/models/Membership.js';
import { OpdSchedule } from '../src/models/OpdSchedule.js';
import { Tenant } from '../src/models/Tenant.js';
import { User } from '../src/models/User.js';
import { audit } from '../src/utils/audit.js';
import { hashPassword } from '../src/utils/password.js';

const BY_DEPARTMENT = {
  'Obstetrics & Gynaecology': ['Amruta Pawar', 'Girish Solanke', 'Supriya Lokhande', 'Seema'],
  Pathology: ['A.G. Solanke'],
  Radiology: ['P.H. Kalamkar', 'Sunil Chute', 'Vivek Jaju'],
  Cardiology: ['Tushar Nikam'],
  Dietetics: ['Swapnali Pimple'],
  Gastroenterology: ['Nitin Bhople'],
  Paediatrics: ['Sunil Jadhav', 'Vinayak Magar', 'Abhijit Deshmukh'],
  'Genetic Counselling': ['Aarti Agrawal'],
  'General Medicine': ['Balaji Biradar', 'Wajid Mogal', 'Praful Pawar', 'Amit Patil', 'Ram Kadam'],
  Neonatology: ['Ram Kadam', 'Rahul Wahatule', 'Vijay Munde'],
  General: ['A.G. Solanke', 'Girish Solanke', 'Amruta Pawar'],
};
const WEEK = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, sessions: [day === 0 ? { from: '11:00', to: '16:00' } : { from: '10:00', to: '17:00' }] }));

for (const d of Object.keys(BY_DEPARTMENT)) if (!(d in OLD_DEPARTMENTS)) throw new Error(`Not a department in Perinexa: ${d}`);
// Each doctor with all their departments, in the departments list's order. The handwritten lists use the departments
// before 9 Nov 2026: they are moved to the owner's 9 (a doctor only in a department that is not one of them is added
// with none – the hospital admin chooses one in Staff).
const doctors = new Map();
for (const [department, names] of Object.entries(BY_DEPARTMENT)) for (const n of names) doctors.set(n, [...(doctors.get(n) ?? []), department]);
for (const [n, list] of doctors) doctors.set(n, newDepartments(list));

const name = process.argv.slice(2).join(' ').trim();
if (!name) {
  console.error('Give the hospital\'s name, e.g.: npm run doctors:hospital -w server -- "Hospital name"');
  process.exit(1);
}

await mongoose.connect(config.MONGO_URI);
const tenant = await Tenant.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean();
if (!tenant) {
  console.error(`No hospital is called "${name}".`);
  await mongoose.disconnect();
  process.exit(1);
}
const member = await Membership.findOne({ tenantId: tenant._id, isActive: true, roles: 'admin' }).lean();
const admin = member ? await User.findById(member.userId).lean() : null;
if (!admin) {
  console.error(`${tenant.name} has no active hospital admin to add the doctors as. Add one first.`);
  await mongoose.disconnect();
  process.exit(1);
}
const req = { tenantId: tenant._id, scopeTenantId: tenant._id, user: admin, ip: null, get: () => 'hospital-doctors script' };
const slug = tenant.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || String(tenant._id);

// The hospital's doctors now, by name (any capitals)
const memberships = await Membership.find({ tenantId: tenant._id, roles: 'doctor' }).lean();
const users = new Map((await User.find({ _id: { $in: memberships.map((m) => m.userId) } }, { name: 1 }).lean()).map((u) => [String(u._id), u]));
const byName = new Map(memberships.filter((m) => users.has(String(m.userId))).map((m) => [users.get(String(m.userId)).name.trim().toLowerCase(), m]));

let added = 0;
let updated = 0;
for (const [doctorName, departments] of doctors) {
  const have = byName.get(doctorName.toLowerCase());
  if (have) {
    const now = newDepartments(have.departments?.length ? have.departments : have.department ? [have.department] : []);
    const wanted = DEPARTMENTS.filter((d) => now.includes(d) || departments.includes(d));
    if (wanted.length !== now.length) {
      await Membership.updateOne({ _id: have._id, tenantId: tenant._id }, { $set: { departments: wanted, department: wanted[0] ?? '' } });
      await audit(req, 'MEMBER_ROLE_CHANGED', { target: users.get(String(have.userId)), tenantId: tenant._id, details: { department: { from: now.join(', '), to: wanted.join(', ') } } });
      updated += 1;
    }
    continue;
  }
  const local = doctorName.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
  let email = `${local}@doctors.${slug}.invalid`;
  for (let n = 2; await User.exists({ email }); n += 1) email = `${local}.${n}@doctors.${slug}.invalid`;
  const user = await User.create({ name: doctorName, email, passwordHash: await hashPassword(randomBytes(32).toString('base64url')), mustChangePassword: true });
  await audit(req, 'USER_CREATED', { target: user, tenantId: tenant._id, details: { name: user.name } });
  await Membership.create({ tenantId: tenant._id, userId: user._id, roles: ['doctor'], departments, department: departments[0] ?? '', createdBy: admin._id });
  await audit(req, 'MEMBER_ADDED', { target: user, tenantId: tenant._id, details: { roles: ['doctor'] } });
  await OpdSchedule.updateOne({ tenantId: tenant._id, doctorId: user._id }, { $setOnInsert: { tenantId: tenant._id, doctorId: user._id, week: WEEK, leave: [], updatedBy: admin._id, updatedByName: admin.name } }, { upsert: true });
  await audit(req, 'OPD_TIMINGS_CHANGED', { details: { doctorId: String(user._id), days: 7, leave: 0 } });
  added += 1;
}
console.log(`${tenant.name}: ${added} doctor${added === 1 ? '' : 's'} added, ${updated} given more departments; ${doctors.size} on the list.`);
await mongoose.disconnect();
