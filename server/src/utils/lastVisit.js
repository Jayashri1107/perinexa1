import { Patient } from '../models/Patient.js';
import { Visit } from '../models/Visit.js';

// Each patient's last visit day (Patient.lastVisitOn), so the patients list can sort by it: worked out again from
// her visits whenever one is started or marked entered in error; records saved before the field existed are filled
// in the first time the list is sorted by it.

/** Sets the patient's last visit day from her visits that were not cancelled. */
export async function updateLastVisit(tenantId, patientId) {
  const last = await Visit.findOne({ tenantId, patientId, status: 'active' }, { visitOn: 1 }).sort({ visitOn: -1 }).lean();
  await Patient.updateOne({ _id: patientId, tenantId }, { $set: { lastVisitOn: last?.visitOn ?? null } });
}

/** Fills in lastVisitOn for this hospital's records that don't have the field yet. */
export async function backfillLastVisits(tenantId) {
  const missing = await Patient.find({ tenantId, lastVisitOn: { $exists: false } }, { _id: 1 }).limit(5000).lean();
  if (!missing.length) return 0;
  const ids = missing.map((p) => p._id);
  const last = await Visit.aggregate([
    { $match: { tenantId, status: 'active', patientId: { $in: ids } } },
    { $group: { _id: '$patientId', visitOn: { $max: '$visitOn' } } },
  ]);
  const byId = new Map(last.map((l) => [String(l._id), l.visitOn]));
  await Patient.bulkWrite(ids.map((_id) => ({ updateOne: { filter: { _id, tenantId }, update: { $set: { lastVisitOn: byId.get(String(_id)) ?? null } } } })));
  return ids.length;
}
