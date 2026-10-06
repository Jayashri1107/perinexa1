import { idParams, parse, statusBody } from '../../core/validate.js';
import * as service from './hospital.service.js';
import { createHospitalBody, hospitalListQuery, updateHospitalBody } from './hospital.validation.js';

export async function list(req, res) {
  res.json(await service.listHospitals(parse(hospitalListQuery, req.query)));
}

export async function options(_req, res) {
  res.json({ items: await service.hospitalOptions() });
}

export async function get(req, res) {
  const { id } = parse(idParams, req.params);
  res.json({ hospital: await service.getHospital(id) });
}

export async function create(req, res) {
  res.status(201).json(await service.createHospital(req, parse(createHospitalBody, req.body)));
}

export async function update(req, res) {
  const { id } = parse(idParams, req.params);
  res.json({ hospital: await service.updateHospital(req, id, parse(updateHospitalBody, req.body)) });
}

export async function setStatus(req, res) {
  const { id } = parse(idParams, req.params);
  const { isActive } = parse(statusBody, req.body);
  res.json({ hospital: await service.setHospitalStatus(req, id, isActive) });
}
