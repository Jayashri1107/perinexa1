// A patient's department (owner, 9 Nov 2026 – docs/DEPARTMENT_ACCESS_PLAN.md): the mother's record keeps her babies'
// departments, so the doctors of a baby's department may read the mother's record (utils/patientAccess.js doctorReach).
import { Patient } from '../models/Patient.js';
import { DEPARTMENTS } from '../models/Membership.js';

/** Sets the mother's babyDepartments from her babies' records now (after a baby is registered or moved). */
export async function refreshBabyDepartments(tenantId, motherId) {
  if (!motherId) return;
  const found = await Patient.distinct('department', { tenantId, 'newborn.mother': motherId });
  const babyDepartments = DEPARTMENTS.filter((d) => found.includes(d));
  await Patient.updateOne({ _id: motherId, tenantId }, { $set: { babyDepartments } });
}

/** A baby is in Pediatric unless another department was chosen. */
export const departmentForNew = (careType, department) => department || (careType === 'newborn' ? 'Pediatric' : '');
