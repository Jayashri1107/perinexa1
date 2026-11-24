// Sample staff for trying the payroll (the developer, 24 Nov 2026) – FAKE SAMPLE DATA ONLY, never in a real hospital.
//
//   npm run sample:payroll -w server -- "Anandi Hospital"
//
// For the hospital named: four made-up staff members with made-up pay, as Payroll → Staff would add them (one
// PAYROLL_STAFF_ADDED audit entry each, as the hospital admin). Their attendance codes are the ones in
// docs/samples/payroll-attendance-sample.csv (October 2026) – except the guard, whose code X-9 is left to be tied on
// Run payroll, and the code Y-1, which belongs to nobody and is left out there. No PF number, ESI number, PAN or bank
// account is made up here: type them on the person's page to try those. No login is made: the Accounts login is
// added by the hospital admin (Hospital admin → Users, group "Accounts").
// Running it again adds nothing; it never deletes or changes anything.
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { Membership } from '../src/models/Membership.js';
import { StaffMember } from '../src/models/StaffMember.js';
import { Tenant } from '../src/models/Tenant.js';
import { User } from '../src/models/User.js';
import { audit } from '../src/utils/audit.js';

const name = process.argv.slice(2).join(' ').trim();
if (!name) {
  console.error('Give the hospital\'s name, e.g.: npm run sample:payroll -w server -- "Anandi Hospital"');
  process.exit(1);
}

const FROM = new Date('2025-04-01T00:00:00Z');
const pay = (basic, hra, flags = {}) => [{ from: FROM, parts: [{ key: 'basic', amountPaise: basic * 100 }, ...(hra ? [{ key: 'hra', amountPaise: hra * 100 }] : [])], pf: { applies: Boolean(flags.pf) }, esi: { applies: Boolean(flags.esi) }, pt: { applies: Boolean(flags.pt) }, tdsPaise: 0 }];
const STAFF = [
  { staffNumber: 'S901', name: 'Sample Attendant One', designation: 'Ward attendant', department: 'Housekeeping', attendanceCodes: ['A-17'], ptSlab: 'men', pay: pay(12000, 3000, { pf: true, esi: true, pt: true }) },
  { staffNumber: 'S902', name: 'Sample Nurse Two', designation: 'Staff nurse', department: 'Labour room', attendanceCodes: ['N-12'], ptSlab: 'women', pay: pay(20000, 5000, { pf: true, pt: true }) },
  { staffNumber: 'S903', name: 'Sample Guard Three', designation: 'Security guard', department: 'Gate', attendanceCodes: [], ptSlab: '', pay: pay(13800, 0) },
  { staffNumber: 'S904', name: 'Sample Cleaner Four', designation: 'Cleaner', department: 'Housekeeping', attendanceCodes: ['C-4'], ptSlab: '', pay: pay(11000, 0, { esi: true }) },
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
  console.error(`${tenant.name} has no active hospital admin to add the staff as. Add one first.`);
  await mongoose.disconnect();
  process.exit(1);
}
const req = { tenantId: tenant._id, user, ip: null, get: () => 'sample-payroll script' };

let added = 0;
for (const person of STAFF) {
  // (a staff number or an attendance code already in use: that person is left alone, and so is this one)
  const taken = await StaffMember.findOne({ tenantId: tenant._id, $or: [{ staffNumber: person.staffNumber }, ...(person.attendanceCodes.length ? [{ attendanceCodes: { $in: person.attendanceCodes } }] : [])] }, { _id: 1 }).lean();
  if (taken) continue;
  const doc = await StaffMember.create({ tenantId: tenant._id, ...person, joinedOn: FROM, pay: person.pay.map((e) => ({ ...e, byName: user.name, at: new Date() })), createdByName: user.name, updatedByName: user.name });
  await audit(req, 'PAYROLL_STAFF_ADDED', { details: { staffId: String(doc._id), staffNumber: doc.staffNumber, name: doc.name, fields: ['pay'] } });
  added += 1;
}
const total = await StaffMember.countDocuments({ tenantId: tenant._id });
console.log(`${tenant.name}: ${added} sample staff member${added === 1 ? '' : 's'} added; ${total} on the payroll's staff list. FAKE SAMPLE DATA – remove before real use (Payroll → Staff → off the payroll).`);
await mongoose.disconnect();
