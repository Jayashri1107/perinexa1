import { z } from 'zod';
import { CARE_TYPE_KEYS } from '../../config/index.js';
import { parse } from '../../core/validate.js';
import * as service from './visit.service.js';
import { additionBody, cancelBody, detailsBody, newVisitBody, patientParams, prescriptionBody, visitParams, vitalsBody } from './visit.validation.js';

const ids = (req) => parse(visitParams, req.params);

export async function list(req, res) {
  res.json(await service.listVisits(req, parse(patientParams, req.params).patientId));
}

export async function start(req, res) {
  res.status(201).json(await service.startVisit(req, parse(patientParams, req.params).patientId, parse(newVisitBody, req.body)));
}

export async function get(req, res) {
  const { patientId, visitId } = ids(req);
  res.json(await service.getVisit(req, patientId, visitId));
}

export async function vitals(req, res) {
  const { patientId, visitId } = ids(req);
  res.json(await service.saveVitals(req, patientId, visitId, parse(vitalsBody, req.body)));
}

export async function details(req, res) {
  const { patientId, visitId } = ids(req);
  res.json(await service.saveDetails(req, patientId, visitId, parse(detailsBody, req.body)));
}

export async function prescription(req, res) {
  const { patientId, visitId } = ids(req);
  res.json(await service.savePrescription(req, patientId, visitId, parse(prescriptionBody, req.body)));
}

export async function sign(req, res) {
  const { patientId, visitId } = ids(req);
  res.json(await service.signVisit(req, patientId, visitId));
}

export async function cancel(req, res) {
  const { patientId, visitId } = ids(req);
  res.json(await service.cancelVisit(req, patientId, visitId, parse(cancelBody, req.body).reason));
}

export async function addition(req, res) {
  const { patientId, visitId } = ids(req);
  res.json(await service.addAddition(req, patientId, visitId, parse(additionBody, req.body).text));
}

export async function sets(req, res) {
  const { careType } = parse(z.object({ careType: z.enum(['', ...CARE_TYPE_KEYS]).default('') }), req.query);
  res.json({ items: await service.prescriptionSets(req, careType) });
}

export async function forPharmacy(req, res) {
  res.json({ items: await service.prescriptionsForPharmacy(req, parse(patientParams, req.params).patientId) });
}
