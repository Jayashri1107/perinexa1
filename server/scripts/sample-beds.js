// Sample wards and beds for trying admission (owner, 14 Oct 2026) – FAKE SAMPLE DATA ONLY, never in a real hospital.
//
//   npm run sample:beds -w server -- "Anandi Hospital"
//
// For the hospital named: General ward G1–G6, Private P1–P2 and Labour room L1–L2 – only the beds it does not have yet,
// as Hospital admin → Beds would add them (one BEDS_ADDED audit entry per ward, as the hospital admin). The bed charge
// comes from the price list (Private has its own; any other ward is charged as the general ward). Running it again adds
// nothing; it never deletes anything. Rename or switch beds off in Hospital admin → Beds.
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { Bed } from '../src/models/Bed.js';
import { Membership } from '../src/models/Membership.js';
import { Tenant } from '../src/models/Tenant.js';
import { User } from '../src/models/User.js';
import { audit } from '../src/utils/audit.js';

const name = process.argv.slice(2).join(' ').trim();
if (!name) {
  console.error('Give the hospital\'s name, e.g.: npm run sample:beds -w server -- "Anandi Hospital"');
  process.exit(1);
}

const WARDS = [
  { ward: 'General ward', names: ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'] },
  { ward: 'Private', names: ['P1', 'P2'] },
  { ward: 'Labour room', names: ['L1', 'L2'] },
];

await mongoose.connect(config.MONGO_URI);
const tenant = await Tenant.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean();
if (!tenant) {
  console.error(`No hospital is called "${name}".`);
  await mongoose.disconnect();
  process.exit(1);
}
// Added as the hospital admin, so the audit log names a real account
const member = await Membership.findOne({ tenantId: tenant._id, isActive: true, roles: 'admin' }).lean();
const user = member ? await User.findById(member.userId).lean() : null;
if (!user) {
  console.error(`${tenant.name} has no active hospital admin to add the beds as. Add one first.`);
  await mongoose.disconnect();
  process.exit(1);
}
const req = { tenantId: tenant._id, user, ip: null, get: () => 'sample-beds script' };

let added = 0;
for (const { ward, names } of WARDS) {
  const existing = await Bed.find({ tenantId: tenant._id, ward: new RegExp(`^${ward}$`, 'i') }, { name: 1, ward: 1 }).lean();
  const wardName = existing[0]?.ward ?? ward; // keep the ward's first spelling
  const have = new Set(existing.map((b) => b.name.toLowerCase()));
  const missing = names.filter((n) => !have.has(n.toLowerCase()));
  if (!missing.length) continue;
  await Bed.insertMany(missing.map((n) => ({ tenantId: tenant._id, ward: wardName, name: n })));
  await audit(req, 'BEDS_ADDED', { details: { ward: wardName, count: missing.length } });
  added += missing.length;
}
const total = await Bed.countDocuments({ tenantId: tenant._id, active: true });
console.log(`${tenant.name}: ${added} sample bed${added === 1 ? '' : 's'} added; ${total} bed${total === 1 ? '' : 's'} in use.`);
await mongoose.disconnect();
