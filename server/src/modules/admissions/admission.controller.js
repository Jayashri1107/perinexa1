import { parse } from '../../core/validate.js';
import * as service from './admission.service.js';
import { additionBody, admissionParams, admitBody, bedBody, docParams, entryParams, newDocBody, nursingBody, patientParams, reasonBody, saveDocBody, wardIssueBody } from './admission.validation.js';

const stayId = (req) => parse(admissionParams, req.params).admissionId;
const doc = (req) => parse(docParams, req.params);

export async function frontDesk(req, res) {
  res.json(await service.frontDeskInpatients(req));
}
export async function inpatients(req, res) {
  res.json(await service.inpatients(req));
}
export async function ofPatient(req, res) {
  res.json(await service.staysOfPatient(req, parse(patientParams, req.params).patientId));
}
export async function admit(req, res) {
  res.status(201).json(await service.admit(req, parse(admitBody, req.body)));
}
export async function get(req, res) {
  res.json(await service.stayOf(req, stayId(req)));
}
export async function bed(req, res) {
  res.json(await service.moveBed(req, stayId(req), parse(bedBody, req.body)));
}
export async function newDocument(req, res) {
  res.status(201).json(await service.newDocument(req, stayId(req), parse(newDocBody, req.body)));
}
export async function saveDocument(req, res) {
  const { admissionId, docId } = doc(req);
  res.json(await service.saveDocument(req, admissionId, docId, parse(saveDocBody, req.body)));
}
export async function signDocument(req, res) {
  const { admissionId, docId } = doc(req);
  res.json(await service.signDocument(req, admissionId, docId));
}
export async function cancelDocument(req, res) {
  const { admissionId, docId } = doc(req);
  res.json(await service.cancelDocument(req, admissionId, docId, parse(reasonBody, req.body).reason));
}
export async function addToDocument(req, res) {
  const { admissionId, docId } = doc(req);
  res.json(await service.addToDocument(req, admissionId, docId, parse(additionBody, req.body).text));
}
export async function addNursing(req, res) {
  res.status(201).json(await service.addNursing(req, stayId(req), parse(nursingBody, req.body)));
}
export async function cancelNursing(req, res) {
  const { admissionId, entryId } = parse(entryParams, req.params);
  res.json(await service.cancelNursing(req, admissionId, entryId, parse(reasonBody, req.body).reason));
}
export async function admitted(req, res) {
  res.json({ items: await service.admittedForPharmacy(req) });
}
export async function issue(req, res) {
  res.status(201).json({ sale: await service.issueToWard(req, parse(wardIssueBody, req.body)) });
}
export async function readyDocument(req, res) {
  const { admissionId, docId } = doc(req);
  res.json(await service.markReady(req, admissionId, docId));
}
