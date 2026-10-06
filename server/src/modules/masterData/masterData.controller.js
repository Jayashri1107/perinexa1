import { parse, statusBody } from '../../core/validate.js';
import * as service from './masterData.service.js';
import { createMasterBody, itemParams, masterListQuery, typeParams, updateMasterBody } from './masterData.validation.js';

export async function list(req, res) {
  const { type } = parse(typeParams, req.params);
  res.json(await service.listMasterData(type, parse(masterListQuery, req.query)));
}

export async function options(req, res) {
  const { type } = parse(typeParams, req.params);
  res.json({ items: await service.masterOptions(type) });
}

export async function create(req, res) {
  const { type } = parse(typeParams, req.params);
  res.status(201).json({ item: await service.createMasterData(req, type, parse(createMasterBody, req.body)) });
}

export async function update(req, res) {
  const { type, id } = parse(itemParams, req.params);
  res.json({ item: await service.updateMasterData(req, type, id, parse(updateMasterBody, req.body)) });
}

export async function setStatus(req, res) {
  const { type, id } = parse(itemParams, req.params);
  const { isActive } = parse(statusBody, req.body);
  res.json({ item: await service.setMasterDataStatus(req, type, id, isActive) });
}
