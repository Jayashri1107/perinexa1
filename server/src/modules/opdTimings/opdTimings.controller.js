import { parse } from '../../core/validate.js';
import * as service from './opdTimings.service.js';
import { doctorListQuery, doctorParams, scheduleBody } from './opdTimings.validation.js';

export async function list(req, res) {
  res.json(await service.listDoctors(req.hospitalId, parse(doctorListQuery, req.query)));
}

export async function get(req, res) {
  const { doctorId } = parse(doctorParams, req.params);
  res.json({ schedule: await service.getSchedule(req.hospitalId, doctorId) });
}

export async function save(req, res) {
  const { doctorId } = parse(doctorParams, req.params);
  res.json({ schedule: await service.saveSchedule(req, req.hospitalId, doctorId, parse(scheduleBody, req.body)) });
}
