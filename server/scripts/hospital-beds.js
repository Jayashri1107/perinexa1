// The hospital's own bed list (from the handwritten list, 5 Nov 2026) – wards and rooms only, no patient data.
//
//   npm run beds:hospital -w server -- "Hospital name"
//
// Adds only the beds the hospital does not have yet, as Hospital admin -> Beds would (one BEDS_ADDED audit entry per
// ward, as the hospital admin), and puts beds that have no floor yet on the floor listed. Running it again changes
// nothing; it never deletes or takes anything out of use. Set the room prices in Billing -> Price list: until a ward has
// its own bed price, it is charged the general bed price.
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { Bed } from '../src/models/Bed.js';
import { Membership } from '../src/models/Membership.js';
import { Tenant } from '../src/models/Tenant.js';
import { User } from '../src/models/User.js';
import { audit } from '../src/utils/audit.js';

const numbered = (prefix, count) => Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);

const BED_LIST = [
  { floor: '1st floor', ward: 'Private AC', names: ['Dr. Room'] },
  { floor: '1st floor', ward: 'General ward', names: numbered('G', 10) },
  { floor: '1st floor', ward: 'NICU', names: numbered('N', 10) },
  { floor: '2nd floor', ward: 'Private AC', names: ['201', '202'] },
  { floor: '2nd floor', ward: 'Super Deluxe AC', names: ['203', '207'] },
  { floor: '2nd floor', ward: 'Deluxe AC', names: ['204', '205'] },
  { floor: '2nd floor', ward: 'Suite AC', names: ['206'] },
];

const name = process.argv.slice(2).join(' ').trim();
if (!name) {
  console.error('Give the hospital\'s name, e.g.: npm run beds:hospital -w server -- "Hospital name"');
  process.exit(1);
}

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
const req = { tenantId: tenant._id, user, ip: null, get: () => 'hospital-beds script' };

let added = 0;
let floorSet = 0;
for (const { floor, ward, names } of BED_LIST) {
  const existing = await Bed.find({ tenantId: tenant._id, ward: new RegExp(`^${ward}$`, 'i') }, { name: 1, ward: 1, floor: 1 }).lean();
  const wardName = existing[0]?.ward ?? ward; // keep the ward's first spelling
  const have = new Map(existing.map((b) => [b.name.toLowerCase(), b]));
  const missing = names.filter((n) => !have.has(n.toLowerCase()));
  const floorless = names.map((n) => have.get(n.toLowerCase())).filter((b) => b && !b.floor);
  if (!missing.length && !floorless.length) continue;
  if (missing.length) await Bed.insertMany(missing.map((n) => ({ tenantId: tenant._id, ward: wardName, floor, name: n })));
  if (floorless.length) await Bed.updateMany({ tenantId: tenant._id, _id: { $in: floorless.map((b) => b._id) } }, { $set: { floor } });
  await audit(req, 'BEDS_ADDED', { details: { ward: wardName, floor, count: missing.length, floorSet: floorless.length } });
  added += missing.length;
  floorSet += floorless.length;
}
const total = await Bed.countDocuments({ tenantId: tenant._id, active: true });
console.log(`${tenant.name}: ${added} bed${added === 1 ? '' : 's'} added, ${floorSet} put on their floor; ${total} bed${total === 1 ? '' : 's'} in use.`);
await mongoose.disconnect();
