import { parse, statusBody } from '../../core/validate.js';
import * as service from './medicine.service.js';
import { medicineBody, medicineListQuery, medicineParams, newMedicineBody, optionsQuery } from './medicine.validation.js';

export async function list(req, res) {
  res.json(await service.listMedicines(req.hospitalId, parse(medicineListQuery, req.query)));
}

export async function options(req, res) {
  res.json({ items: await service.medicineOptions(req.hospitalId, parse(optionsQuery, req.query).search) });
}

export async function create(req, res) {
  res.status(201).json({ item: await service.createMedicine(req, parse(newMedicineBody, req.body)) });
}

export async function update(req, res) {
  const { id } = parse(medicineParams, req.params);
  res.json({ item: await service.updateMedicine(req, id, parse(medicineBody, req.body)) });
}

export async function setStatus(req, res) {
  const { id } = parse(medicineParams, req.params);
  res.json({ item: await service.setMedicineStatus(req, id, parse(statusBody, req.body).isActive) });
}
