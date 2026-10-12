// Prepares the database (safe to run more than once):
//  1. Upgrades data from earlier versions, and makes sure every hospital has its standard care-plan templates.
//  The first super admin is NOT made here: on the very first start the sign-in page asks for their name, email and
//  password ("Create the first super admin") – nothing is kept in a settings file.
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { User } from '../src/models/User.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Membership } from '../src/models/Membership.js';
import { Tenant } from '../src/models/Tenant.js';
import { Patient } from '../src/models/Patient.js';
import { CarePlanTemplate } from '../src/models/CarePlanTemplate.js';
import { ensureStandardTemplates, recalculateForTemplate } from '../src/careplans/templatesService.js';

await mongoose.connect(config.MONGO_URI);
await Promise.all([User.init(), Tenant.init(), Membership.init()]);

// 1. Upgrade from the single-hospital version: the old "role" field is replaced by
//    isSuperAdmin (platform) and memberships (per hospital).
const upgraded = await User.collection.updateMany({ role: 'admin' }, { $set: { isSuperAdmin: true }, $unset: { role: '' } });
await User.collection.updateMany({ role: { $exists: true } }, { $unset: { role: '' } });
if (upgraded.modifiedCount) console.log(`ℹ️  Upgraded ${upgraded.modifiedCount} former admin account(s) to super admin.`);

// 1b. Memberships from before "several roles per person": role "x" becomes roles ["x"].
const legacy = await Membership.collection.find({ role: { $exists: true } }).toArray();
for (const m of legacy) {
  await Membership.collection.updateOne({ _id: m._id }, { $set: { roles: m.roles?.length ? m.roles : [m.role] }, $unset: { role: '' } });
}
if (legacy.length) console.log(`ℹ️  Converted ${legacy.length} hospital membership(s) to the multi-role format.`);

// 1c. Patients from before OBGY registration: first/last name + date of birth become full name + age.
const oldPatients = await Patient.collection.find({ fullName: { $exists: false } }).toArray();
for (const p of oldPatients) {
  const age = p.dateOfBirth ? Math.floor((Date.now() - new Date(p.dateOfBirth)) / (365.25 * 24 * 3600 * 1000)) : null;
  await Patient.collection.updateOne(
    { _id: p._id },
    {
      $set: { fullName: `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || 'Unknown', ageYears: age, ageRecordedOn: new Date(), careType: 'gynaecology' },
      $unset: { firstName: '', lastName: '', dateOfBirth: '', sex: '', email: '' },
    },
  );
}
if (oldPatients.length) console.log(`ℹ️  Converted ${oldPatients.length} patient(s) to the OBGY registration format.`);

// 1d. "Surgery on the uterus" moved from "problems in previous pregnancies" to the conditions list
//     (it can happen outside a pregnancy, e.g. a myomectomy).
const uterine = await Patient.collection.find({ 'obstetric.pastComplications': 'uterine_surgery' }, { projection: { _id: 1 } }).toArray();
for (const p of uterine) {
  await Patient.collection.updateOne({ _id: p._id }, { $pull: { 'obstetric.pastComplications': 'uterine_surgery' }, $addToSet: { 'medical.conditions': 'uterine_surgery' } });
}
if (uterine.length) console.log(`ℹ️  Moved "surgery on the uterus" to the conditions list for ${uterine.length} patient(s).`);

// 1e. Older risk audit entries held medical details (levels, reasons) that hospital admins could read.
//     Keep only who/which record; automatic risk changes are no longer logged at all.
const trimmed = await AuditLog.collection.updateMany(
  { action: { $in: ['PATIENT_RISK_CHANGED', 'RISK_OVERRIDDEN', 'RISK_OVERRIDE_REMOVED'] } },
  { $unset: { 'details.from': '', 'details.to': '', 'details.computed': '', 'details.level': '', 'details.reason': '', 'details.reasons': '' } },
);
if (trimmed.modifiedCount) console.log(`ℹ️  Removed medical details from ${trimmed.modifiedCount} older audit entr${trimmed.modifiedCount === 1 ? 'y' : 'ies'}.`);

// 1f. Risk levels: make sure every hospital's templates have risk rules, and every antenatal patient has a
//     current risk level (safe to repeat).
await CarePlanTemplate.init(); // the "one standard template per care type" index
for (const t of await Tenant.find({}, { _id: 1 })) {
  await ensureStandardTemplates(t._id);
  const std = await CarePlanTemplate.findOne({ tenantId: t._id, careType: 'antenatal', kind: 'standard' });
  if (std) {
    const r = await recalculateForTemplate(std);
    if (r.checked) console.log(`ℹ️  Risk levels checked for ${r.checked} antenatal patient(s) (${r.changed} changed).`);
  }
}

// 2. The first super admin: made in the app on the first start.
if (!(await User.exists({ isSuperAdmin: true }))) console.log('ℹ️  No super admin yet: start the app and open it – it asks you to create the first super admin.');

await mongoose.disconnect();
