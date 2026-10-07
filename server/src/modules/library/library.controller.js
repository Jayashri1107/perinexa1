import { parse } from '../../core/validate.js';
import * as service from './library.service.js';
import { createBody, entryBody, idParams, libraryListQuery, statusBody } from './library.validation.js';

const idOf = (req) => parse(idParams, req.params).id;

export async function summary(req, res) {
  res.json(await service.summary(req));
}

export async function list(req, res) {
  res.json(await service.list(req, parse(libraryListQuery, req.query)));
}

export async function get(req, res) {
  res.json(await service.get(req, idOf(req)));
}

export async function create(req, res) {
  res.status(201).json(await service.create(req, parse(createBody, req.body)));
}

export async function update(req, res) {
  res.json(await service.update(req, idOf(req), parse(entryBody, req.body)));
}

export async function approve(req, res) {
  res.json(await service.approve(req, idOf(req)));
}

export async function setStatus(req, res) {
  res.json(await service.setActive(req, idOf(req), parse(statusBody, req.body).isActive));
}

export async function duplicate(req, res) {
  res.status(201).json(await service.duplicate(req, idOf(req)));
}
