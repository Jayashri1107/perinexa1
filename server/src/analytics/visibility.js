// Doctors count only the patients whose clinical details they may see (rule R8): the same need-to-know rule as
// the patient record (utils/patientAccess.js), applied to every loaded row. Other doctors' sensitive records
// are left out, as the Patients list already does for risk.

import { patientAccess } from '../utils/patientAccess.js';

/** The ids (strings) of the rows whose clinical details this person may see. */
export function visibleSet(req, rows) {
  const out = new Set();
  for (const row of rows) if (patientAccess(req, row).view.has('pregnancy')) out.add(String(row._id));
  return out;
}
