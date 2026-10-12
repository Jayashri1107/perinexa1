// Finding one patient of the hospital selected in the session. Shared by the patient routes and the
// care-plan routes, so every lookup is by id AND hospital.

import { applyCurrentRisk, ensureStandardTemplates, riskIsStale, riskTemplateFor } from '../careplans/templatesService.js';
import { Patient } from '../models/Patient.js';
import { HttpError } from './httpError.js';
import { idParams, parse } from './validate.js';

/** The patient with this id in this hospital (404 otherwise). */
export async function findPatientById(tenantId, id) {
  // Run any pending built-in rule upgrade (which recalculates patients) BEFORE loading the record, so it
  // can't change the record underneath this request and make its save fail.
  await ensureStandardTemplates(tenantId);
  // Looking up by id AND hospital: a patient from another hospital is simply "not found".
  const patient = await Patient.findOne({ _id: id, tenantId });
  if (!patient) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  return patient;
}

/** The patient in the URL (/patients/:id). */
export async function findPatient(req) {
  const { id } = parse(idParams, req.params);
  return findPatientById(req.tenantId, id);
}

/**
 * Brings the stored risk level up to date if it may be out of date (age changed, or the rules or their
 * approval changed), so the care plan is worked out from current facts. If someone saved the record at the
 * same moment, their (newer) version is used instead. Returns the patient to use.
 */
export async function withCurrentRisk(patient, now = new Date()) {
  if (patient.careType !== 'antenatal') return patient;
  const template = await riskTemplateFor(patient);
  if (!riskIsStale(patient, template, now)) return patient;
  await applyCurrentRisk(patient, template, now); // with the readings of this pregnancy read again
  try {
    await patient.save();
    return patient;
  } catch (e) {
    if (e?.name !== 'VersionError') throw e;
    return findPatientById(patient.tenantId, patient._id);
  }
}

/** The patient by id, with a current risk level (used by every care-plan read and change). */
export async function loadPatientById({ tenantId, now }, id) {
  return withCurrentRisk(await findPatientById(tenantId, id), now);
}

/** The patient in the URL, with a current risk level (GET /patients/:id, and every care-plan route). */
export async function loadPatientForPlan(req) {
  const { id } = parse(idParams, req.params);
  return loadPatientById({ tenantId: req.tenantId, now: req.now ?? new Date() }, id);
}
