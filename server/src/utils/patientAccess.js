// "Need to know" rules for patient records: what each role may see and change for ONE patient.
// Everything here is decided on the server, so it can't be bypassed from the browser.
//
// Agreed rules (docs/USE_CASE.md, docs/FEATURES.md):
// - RMO: all patients, full access (including sensitive records).
// - Doctor: own patients (and patients not yet assigned) full access; other doctors' patients read-only,
//   plus an emergency note with a reason. Sensitive records of other doctors: identity only.
// - Nurse: medical details (not doctors' notes); records vital signs at visits. Sensitive records: identity only.
// - Receptionist: identity and contact details only (and newborn birth details); can edit those.
// - Lab staff: name and patient number only.
// - Pharmacist: name, patient number, phone and doctor (the medicines prescribed come through the pharmacy routes),
//   and whether the record is closed (no counter sale).
// - Billing department: name, patient number, phone, doctor and who pays, to find her bills, call about unpaid ones and
//   claim from an insurer or scheme.
// - Everyone but lab staff sees whether a record is closed after a death – never why or when (clinical details).
// - Hospital admin (with no clinical role): no patient data.
// A person with several roles gets everything any of their roles allows.

export const PATIENT_ROLES = ['doctor', 'rmo', 'nurse', 'receptionist', 'lab', 'pharmacist', 'billing'];

// duplicateOf: the record is marked as a duplicate of another (that record's number, who marked it and when) –
// everyone who may open the record sees it, so nobody works on the wrong record. earlierRecords: on the main
// record, the numbers of the records marked as its duplicates (only those this person may open).
// closed: the record is closed (a death was recorded on it by a doctor – patients/deathRules.js). Those who book,
// register or care for her (reception, nurses, other doctors) and the pharmacist (a counter sale is refused) see THAT
// it is closed, so nobody starts anything new on it; why and when are clinical details. Lab staff keep their name and
// number only: nothing they do is refused on a closed record (doctors order the tests; an order already made is
// finished).
const LAB_FIELDS = ['id', 'mrn', 'fullName', 'careType', 'tenantId', 'duplicateOf', 'earlierRecords'];
const IDENTITY_FIELDS = [
  ...LAB_FIELDS,
  'closed',
  'ageYears',
  'ageRecordedOn',
  'currentAge',
  'phone',
  'reminders', // her agreement to automatic reminders (Version 2): with the phone number
  'abha', // her ABHA, partly hidden (ABDM linking): with the identity details
  'address',
  'emergencyContact',
  'idProof',
  'pinCode',
  'city',
  'state',
  'referredBy',
  'payer',
  'assignedDoctor',
  'assignedDoctorName',
  'sensitive',
  'createdAt',
  'updatedAt',
];
const NEWBORN_FIELDS = ['newborn', 'motherInfo', 'babies'];
// carePlanSummary: the care plan's short summary (Feature 7) is a clinical detail too.
// redFlags: warnings from the latest visit's recorded values (Smart features) – a clinical detail too.
// lastDelivery: the delivery a doctor confirmed (Version 2, inpatients).
// abortion: the pregnancy-loss details (Abortion type of care) – reception and lab see only the word "Abortion".
// postnatal: whether she is breastfeeding (postnatal care) – a clinical detail.
// duplicateReason, duplicateHistory: why a doctor or RMO marked the record as a duplicate, and earlier markings
// that were undone – typed by a clinician, so shown with the medical details only.
// earlierRecordDetails: on the main record, what an earlier record has that this one does not (an allergy, a blood
// group, pregnancy dates …) – medical details of that record, sent only to those who may see them on both.
// newbornCare: a baby's admission to the NICU or SNCU and breastfeeding at discharge – clinical details (reception
// sees the birth details in `newborn`, not these).
// death, deathHistory: the death recorded on the record (date, place or timing, who recorded it), and deaths that
// were recorded in error and undone with their reason – only with the medical details. Everyone else sees `closed`.
const CLINICAL_FIELDS = [
  'pregnancy',
  'abortion',
  'gestationalAge',
  'obstetric',
  'medical',
  'risk',
  'riskOverrideHistory',
  'createdByName',
  'carePlanSummary',
  'redFlags',
  'lastDelivery',
  'postnatal',
  'newbornCare',
  'death',
  'deathHistory',
  'duplicateReason',
  'duplicateHistory',
  'earlierRecordDetails',
  ...NEWBORN_FIELDS,
];
const NOTES_FIELDS = ['notes'];

// Field groups that can be edited
export const IDENTITY_EDIT = ['careType', 'fullName', 'ageYears', 'phone', 'address', 'pinCode', 'city', 'state', 'referredBy', 'payer', 'emergencyContact', 'idProof'];
export const NEWBORN_EDIT = ['newborn'];
// delivery: a delivery at another hospital (no delivery note here), so the postnatal plan can start from it.
// postnatal: whether she is breastfeeding (postnatal patients).
// newbornCare: a baby's NICU or SNCU admission and breastfeeding at discharge (babies' records).
export const CLINICAL_EDIT = ['pregnancy', 'abortion', 'obstetric', 'medical', 'notes', 'delivery', 'postnatal', 'newbornCare'];

const NONE = { view: [], editIdentity: false, editNewborn: false, editClinical: false, emergencyNote: false, viewNotes: false, assign: false, markSensitive: false, overrideRisk: false, recordVitals: false };

function forRole(role, patient, userId) {
  const mine = patient.assignedDoctor && String(patient.assignedDoctor) === String(userId);
  const unassigned = !patient.assignedDoctor;
  const sensitive = Boolean(patient.sensitive);

  switch (role) {
    case 'rmo':
      return {
        view: [...IDENTITY_FIELDS, ...CLINICAL_FIELDS, ...NOTES_FIELDS],
        editIdentity: true,
        editNewborn: true,
        editClinical: true,
        emergencyNote: false,
        viewNotes: true,
        assign: true,
        markSensitive: true,
        recordVitals: true,
      };
    case 'doctor':
      if (mine || unassigned) {
        return {
          view: [...IDENTITY_FIELDS, ...CLINICAL_FIELDS, ...NOTES_FIELDS],
          editIdentity: true,
          editNewborn: true,
          editClinical: true,
          emergencyNote: false,
          viewNotes: true,
          assign: true,
          markSensitive: true,
          overrideRisk: true, // only the treating (or unassigned) doctor may override the risk level
          recordVitals: true,
        };
      }
      // Another doctor's patient: read-only (sensitive: identity only), plus an emergency note.
      return {
        ...NONE,
        view: sensitive ? IDENTITY_FIELDS : [...IDENTITY_FIELDS, ...CLINICAL_FIELDS, ...NOTES_FIELDS],
        emergencyNote: true,
        viewNotes: !sensitive,
      };
    case 'nurse':
      return { ...NONE, view: sensitive ? IDENTITY_FIELDS : [...IDENTITY_FIELDS, ...CLINICAL_FIELDS], recordVitals: !sensitive };
    case 'receptionist':
      return { ...NONE, view: [...IDENTITY_FIELDS, ...NEWBORN_FIELDS], editIdentity: true, editNewborn: true, assign: true };
    case 'lab':
      return { ...NONE, view: LAB_FIELDS };
    case 'pharmacist':
      return { ...NONE, view: [...LAB_FIELDS, 'closed', 'phone', 'assignedDoctor', 'assignedDoctorName'] };
    case 'billing':
      // payer: who pays and the card or policy number, for the bill and an insurance claim (owner, 14 Oct 2026)
      return { ...NONE, view: [...LAB_FIELDS, 'closed', 'phone', 'payer', 'assignedDoctor', 'assignedDoctorName'] };
    default:
      return NONE;
  }
}

/** What the logged-in person may see and do for this patient (req.membership has their roles here). */
export function patientAccess(req, patient) {
  const roles = req.membership?.roles ?? [];
  const merged = { ...NONE, view: new Set() };
  for (const role of roles) {
    const r = forRole(role, patient, req.user._id);
    r.view.forEach((f) => merged.view.add(f));
    for (const k of ['editIdentity', 'editNewborn', 'editClinical', 'emergencyNote', 'viewNotes', 'assign', 'markSensitive', 'overrideRisk', 'recordVitals']) {
      merged[k] = merged[k] || r[k];
    }
  }
  // Someone who can edit clinical details doesn't need the "emergency note" route.
  if (merged.editClinical) merged.emergencyNote = false;
  // Recording a death (and undoing one recorded in error) is for a DOCTOR who may change this record: the patient's
  // doctor, or any doctor for an unassigned patient – as for confirming a delivery note. Never an RMO, a nurse or
  // reception. Judged on the doctor role alone, so a doctor who is also an RMO gets no wider right from that role.
  merged.recordDeath = roles.includes('doctor') && forRole('doctor', patient, req.user._id).editClinical === true;

  const v = merged.view;
  let level = 'none';
  if (v.has('notes') && merged.editClinical) level = 'full';
  else if (v.has('pregnancy') && !merged.editClinical && merged.emergencyNote) level = 'read_only';
  else if (v.has('pregnancy')) level = 'clinical';
  else if (v.has('phone')) level = 'identity';
  else if (v.has('fullName')) level = 'name_only';
  return { ...merged, level };
}

/**
 * A copy of the whole record (routes/recordCopy.js): only with full clinical access to THIS record – her doctor (any
 * doctor while she has none) or an RMO. Never reception, nurses, the lab, the pharmacist or an admin; never another
 * doctor's patient (read-only there), so never another doctor's sensitive record either.
 */
export const mayCopyRecord = (access) => access.level === 'full';

/** Removes everything the person may not see, and adds their permissions for the page to use. */
export function projectPatient(json, access) {
  const out = {};
  for (const key of access.view) if (key in json) out[key] = json[key];
  out.access = {
    level: access.level,
    canEditIdentity: access.editIdentity === true,
    canEditNewborn: access.editNewborn === true,
    canEditClinical: access.editClinical === true,
    canAddEmergencyNote: access.emergencyNote === true,
    canViewNotes: access.viewNotes === true,
    canAssign: access.assign === true,
    canMarkSensitive: access.markSensitive === true,
    canOverrideRisk: access.overrideRisk === true,
    // Care plan: seen by those who may see the pregnancy details; changed by those who may edit clinical details.
    canViewCarePlan: access.view.has('pregnancy'),
    canEditCarePlan: access.editClinical === true,
    // Consent forms printed for this patient: seen with the medical details; printed by those who may change them.
    canViewConsents: access.view.has('pregnancy'),
    canPrintConsents: access.editClinical === true,
    // Visits (Feature 8): seen with the medical details; nurses record vital signs; the treating doctor and RMOs
    // write the details and prescriptions. The doctor's private note needs access to doctors' notes.
    canViewVisits: access.view.has('pregnancy'),
    canRecordVitals: access.recordVitals === true,
    canEditVisits: access.editClinical === true,
    canViewVisitNotes: access.viewNotes === true,
    // Marking this record as a duplicate of another, and undoing it: the patient's doctor or an RMO (who must also
    // be allowed to change the other record – checked when it is done).
    canMarkDuplicate: access.editClinical === true && !json.duplicateOf,
    canUndoDuplicate: access.editClinical === true && Boolean(json.duplicateOf),
    // Recording a death on this record, and undoing one recorded in error: a doctor who may change the record
    // (never on a record marked as a duplicate – the death is recorded on the main record).
    canRecordDeath: access.recordDeath === true && !json.closed && !json.duplicateOf,
    canUndoDeath: access.recordDeath === true && Boolean(json.closed),
    // More → "Copy of the whole record": her doctor or an RMO (see mayCopyRecord)
    canCopyRecord: mayCopyRecord(access),
  };
  return out;
}

/** Access rules that only depend on roles (for registering new patients). */
export function creationAccess(req) {
  const roles = req.membership?.roles ?? [];
  return {
    allowed: roles.some((r) => ['receptionist', 'rmo', 'doctor'].includes(r)),
    clinical: roles.some((r) => ['rmo', 'doctor'].includes(r)),
  };
}

/**
 * The database filter for the patients whose pregnancy details a person with these roles may see (mirrors
 * forRole above: CLINICAL_FIELDS for that patient). {} = all patients; null = none. Used to narrow a list
 * query before the rules above are checked again on each row (never instead of them).
 */
export function pregnancyVisibleFilter(roles = [], userId) {
  const filters = [];
  for (const role of roles) {
    if (role === 'rmo') return {};
    if (role === 'doctor') filters.push({ $or: [{ sensitive: { $ne: true } }, { assignedDoctor: userId }, { assignedDoctor: null }] });
    if (role === 'nurse') filters.push({ sensitive: { $ne: true } });
  }
  if (!filters.length) return null;
  return filters.length === 1 ? filters[0] : { $or: filters };
}
