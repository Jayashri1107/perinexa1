// Registration details still missing (26 Oct 2026): a patient registered in a rush – often only her name and phone –
// is listed on reception's Today ("Details missing") until the agreed registration details are filled in: age (not
// for a baby, whose age comes from the birth), phone, address (or at least the city), the emergency contact's phone
// and her doctor. The ID proof stays optional. Identity details only – nothing clinical, so reception may see it.
import { addDays, hospitalToday } from '../careplans/dates.js';
import { Patient } from '../models/Patient.js';
import { IN_USE } from './deathRules.js';

/** How far back registrations are checked (older records are not listed: they were registered before this rule). */
export const MISSING_DETAILS_DAYS = 30;
const MAX_ROWS = 50;

/** The words for each missing detail, in the order of the form. */
export const MISSING_LABELS = { age: 'age', phone: 'phone', address: 'address', emergencyContact: 'emergency contact', doctor: 'doctor' };

const empty = (v) => v == null || String(v).trim() === '';

/** What is missing on this patient record: [] when complete, else keys of MISSING_LABELS in the form's order. */
export function missingDetails(p) {
  const out = [];
  if (p.careType !== 'newborn' && p.ageYears == null) out.push('age');
  if (empty(p.phone)) out.push('phone');
  if (empty(p.address) && empty(p.city)) out.push('address');
  if (empty(p.emergencyContact?.phone)) out.push('emergencyContact');
  if (!p.assignedDoctor) out.push('doctor');
  return out;
}

// The same rules as a query, so only records with a gap are read (strings may be '' or not there at all)
const blank = (field) => ({ $or: [{ [field]: '' }, { [field]: null }] });
const ANY_MISSING = {
  $or: [
    { careType: { $ne: 'newborn' }, ageYears: null },
    blank('phone'),
    { $and: [blank('address'), blank('city')] },
    blank('emergencyContact.phone'),
    { assignedDoctor: null },
  ],
};

/**
 * Patients registered in the last MISSING_DETAILS_DAYS days, and those on today's list (alsoIds), with a detail
 * missing – newest first, at most MAX_ROWS. Returns { rows: [{ p (lean), missing }], cut }.
 */
export async function patientsWithMissingDetails(tenantId, { now = new Date(), alsoIds = [], select } = {}) {
  const since = addDays(hospitalToday(now), -MISSING_DETAILS_DAYS);
  const found = await Patient.find({ tenantId, ...IN_USE, $and: [ANY_MISSING, { $or: [{ createdAt: { $gte: since } }, { _id: { $in: alsoIds } }] }] })
    .select(select)
    .sort({ createdAt: -1 })
    .limit(MAX_ROWS + 1)
    .lean();
  const rows = found.slice(0, MAX_ROWS).map((p) => ({ p, missing: missingDetails(p) })).filter((r) => r.missing.length);
  return { rows, cut: found.length > MAX_ROWS };
}
