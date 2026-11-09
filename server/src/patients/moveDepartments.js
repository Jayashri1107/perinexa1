// The owner's 9 departments (9 Nov 2026 – docs/DEPARTMENT_ACCESS_PLAN.md, "Moving the old records"). Run at every start
// (index.js); a second run finds nothing to do.
// - Doctors: the departments before 9 Nov 2026 move to the new ones (OLD_DEPARTMENTS); a doctor only in a department that
//   is not one of the 9 is left with none – the hospital admin chooses again in Staff.
// - Stays: the department on an admission moves the same way.
// - Patients with no department: her doctor's first department; a baby with none: Pediatric. A patient whose doctor has
//   no department (or with no doctor) stays without one – every doctor with a department sees her until reception
//   gives her one.
// - Mothers: babyDepartments from their babies' records.
import mongoose from 'mongoose';
import { Admission } from '../models/Admission.js';
import { DEPARTMENTS, Membership, OLD_DEPARTMENTS, departmentsOf, newDepartments } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { Tenant } from '../models/Tenant.js';

const OLD = Object.keys(OLD_DEPARTMENTS).filter((d) => !DEPARTMENTS.includes(d));

export async function moveDepartments() {
  const done = { doctors: 0, stays: 0, patients: 0, mothers: 0 };
  const tenants = await Tenant.find({}, { _id: 1 }).lean();
  for (const { _id: tenantId } of tenants) {
    // Doctors (raw update: the stored names are not in the model's list any more)
    const old = await Membership.find({ tenantId, $or: [{ department: { $in: OLD } }, { departments: { $in: OLD } }] }).lean();
    for (const m of old) {
      const departments = newDepartments(departmentsOf(m));
      await Membership.collection.updateOne({ _id: m._id, tenantId }, { $set: { departments, department: departments[0] ?? '' } });
      done.doctors += 1;
    }
    // Stays
    for (const name of OLD) {
      const r = await Admission.collection.updateMany({ tenantId, department: name }, { $set: { department: OLD_DEPARTMENTS[name] } });
      done.stays += r.modifiedCount;
    }
    // Patients with no department: her doctor's first one; a baby: Pediatric
    const doctors = await Membership.find({ tenantId, roles: 'doctor' }, { userId: 1, department: 1, departments: 1 }).lean();
    const first = new Map(doctors.map((m) => [String(m.userId), newDepartments(departmentsOf(m))[0] ?? '']));
    const none = await Patient.find({ tenantId, department: { $in: ['', null] }, $or: [{ assignedDoctor: { $ne: null } }, { careType: 'newborn' }] }, { assignedDoctor: 1, careType: 1 }).lean();
    for (const p of none) {
      const department = (p.assignedDoctor && first.get(String(p.assignedDoctor))) || (p.careType === 'newborn' ? 'Pediatric' : '');
      if (!department) continue;
      await Patient.collection.updateOne({ _id: p._id, tenantId }, { $set: { department } });
      done.patients += 1;
    }
    // Mothers: their babies' departments
    const babies = await Patient.find({ tenantId, careType: 'newborn', 'newborn.mother': { $ne: null } }, { 'newborn.mother': 1, department: 1 }).lean();
    const byMother = new Map();
    for (const b of babies) {
      const k = String(b.newborn.mother);
      byMother.set(k, [...(byMother.get(k) ?? []), b.department]);
    }
    for (const [motherId, list] of byMother) {
      const babyDepartments = DEPARTMENTS.filter((d) => list.includes(d));
      const r = await Patient.collection.updateOne({ _id: new mongoose.Types.ObjectId(motherId), tenantId, babyDepartments: { $ne: babyDepartments } }, { $set: { babyDepartments } });
      done.mothers += r.modifiedCount;
    }
  }
  return done;
}
