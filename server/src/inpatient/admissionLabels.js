import { Admission, STAY_TYPES } from '../models/Admission.js';
import { ClinicalDocument } from '../models/ClinicalDocument.js';
import { hasRole } from '../models/Membership.js';
import { PAYER_TYPES, Patient } from '../models/Patient.js';
import { HttpError } from '../utils/httpError.js';

// The billing type and the admission type of a stay (owner, 9 Nov 2026 – docs/ADMISSION_COLOURS_PLAN.md).
//  - Billing type: Insurance, Cash or Package – asked at every admission, the mother's and the baby's. A government
//    scheme or a company counts as Insurance (its name goes in the name field). The admission records only "Package";
//    which package is chosen on the bill.
//  - Admission type: ANC, PNC, Delivered or Other – chosen at admission, changed by hand during the stay (audited).
// Shown with a colour label on the doctor's and RMO's dashboard. The billing type is sent only to doctors and RMOs
// (and kept by the admission desk and billing, who work with it) – never to nurses.

export const BILLING_TYPES = PAYER_TYPES;
export { STAY_TYPES };

// The four payer types before 9 Nov 2026
export const OLD_PAYER = { self: 'cash', insurance: 'insurance', govt_scheme: 'insurance', corporate: 'insurance' };

/** Who is sent the billing type of a stay on the inpatient lists: doctors and RMOs. */
export const seesBillingType = (membership) => hasRole(membership, 'doctor', 'rmo');

/** The admission type to start with for her type of care (the desk still chooses): a baby is Other. */
export function suggestedStayType(careType) {
  if (careType === 'newborn') return 'other';
  if (careType === 'postnatal') return 'pnc';
  if (careType === 'antenatal') return 'anc';
  return '';
}

/** The admission type sent with an admission – a baby's is Other when not chosen; anyone else's must be chosen. */
export function stayTypeOf(body, patient) {
  if (body.stayType) return body.stayType;
  if (patient.careType === 'newborn') return 'other';
  throw Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields: { stayType: 'Choose ANC, PNC, Delivered or Other' } });
}

/**
 * Moves the old records to the 3 billing types, and gives old stays an admission type from the record – once per
 * hospital; running again finds nothing to do. A delivery recorded in the stay → Delivered; postnatal care → PNC;
 * antenatal care → ANC; anything else → Other. Returns how many records were changed.
 */
export async function migrateAdmissionLabels(tenantId) {
  let changed = 0;
  for (const [from, to] of Object.entries(OLD_PAYER)) {
    if (from === to) continue;
    changed += (await Patient.collection.updateMany({ tenantId, 'payer.type': from }, { $set: { 'payer.type': to } })).modifiedCount;
    changed += (await Admission.collection.updateMany({ tenantId, 'checklist.payer': from }, { $set: { 'checklist.payer': to } })).modifiedCount;
  }
  // Old stays: the billing type from the checklist, when it had one
  for (const t of BILLING_TYPES) {
    changed += (await Admission.collection.updateMany({ tenantId, billingType: { $exists: false }, 'checklist.payer': t }, { $set: { billingType: t } })).modifiedCount;
  }
  const open = await Admission.find({ tenantId, stayType: { $in: [null, ''] } }, { careType: 1 }).lean();
  if (open.length) {
    const delivered = new Set(
      (await ClinicalDocument.find({ tenantId, kind: 'delivery', status: { $ne: 'cancelled' }, admissionId: { $in: open.map((s) => s._id) } }, { admissionId: 1 }).lean()).map((d) => String(d.admissionId)),
    );
    for (const s of open) {
      const stayType = delivered.has(String(s._id)) ? 'delivered' : suggestedStayType(s.careType) || 'other';
      changed += (await Admission.updateOne({ tenantId, _id: s._id }, { $set: { stayType } })).modifiedCount;
    }
  }
  return changed;
}

