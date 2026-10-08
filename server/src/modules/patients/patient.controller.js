import { parse } from '../../core/validate.js';
import * as service from './patient.service.js';
import { lookupPincode } from './pincode.js';
import {
  clinicalBody,
  contactBody,
  duplicateQuery,
  emergencyBody,
  patientListQuery,
  patientParams,
  registerBody,
  statusBody,
} from './patient.validation.js';

export async function list(req, res) {
  res.json(await service.listPatients(req, parse(patientListQuery, req.query)));
}

export async function doctors(req, res) {
  res.json({ items: await service.doctorOptions(req.hospitalId) });
}

export async function duplicates(req, res) {
  res.json({ items: await service.findDuplicates(req.hospitalId, parse(duplicateQuery, req.query)) });
}

export async function register(req, res) {
  res.status(201).json({ patient: await service.register(req, parse(registerBody, req.body)) });
}

export async function get(req, res) {
  const { id } = parse(patientParams, req.params);
  res.json(await service.getPatient(req, id));
}

export async function updateContact(req, res) {
  const { id } = parse(patientParams, req.params);
  res.json(await service.updateContact(req, id, parse(contactBody, req.body)));
}

export async function updateClinical(req, res) {
  const { id } = parse(patientParams, req.params);
  res.json(await service.updateClinical(req, id, parse(clinicalBody, req.body)));
}

export async function setStatus(req, res) {
  const { id } = parse(patientParams, req.params);
  res.json(await service.setStatus(req, id, parse(statusBody, req.body).status));
}

export async function emergencyAccess(req, res) {
  const { id } = parse(patientParams, req.params);
  res.json(await service.grantEmergencyAccess(req, id, parse(emergencyBody, req.body).reason));
}

// City, state and areas of a PIN code (only the PIN code is sent to the India Post service).
export async function pincode(req, res) {
  res.json(await lookupPincode(String(req.params.pin ?? '')));
}
