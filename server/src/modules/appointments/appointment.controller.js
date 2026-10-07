import { z } from 'zod';
import { parse } from '../../core/validate.js';
import { scheduleBody } from '../opdTimings/opdTimings.validation.js';
import * as service from './appointment.service.js';
import { bookBody, cancelBody, dateQuery, dayQuery, doctorParams, idParams, linkBody, moveBody, patientParams, tokenBody } from './appointment.validation.js';

const idOf = (req) => parse(idParams, req.params).id;

export async function doctors(req, res) {
  res.json(await service.doctors(req));
}

export async function getTimings(req, res) {
  res.json(await service.getTimings(req, parse(doctorParams, req.params).doctorId));
}

export async function saveTimings(req, res) {
  const { doctorId } = parse(doctorParams, req.params);
  res.json(await service.saveTimings(req, doctorId, parse(scheduleBody, req.body)));
}

export async function day(req, res) {
  res.json(await service.day(req, parse(dayQuery, req.query)));
}

export async function needsTime(req, res) {
  res.json(await service.needsTime(req));
}

export async function patients(req, res) {
  const { search } = parse(z.object({ search: z.string().trim().max(100).default('') }), req.query);
  res.json({ items: await service.findPatients(req, search) });
}

export async function forPatient(req, res) {
  res.json(await service.forPatient(req, parse(patientParams, req.params).patientId));
}

export async function reminders(req, res) {
  res.json(await service.reminders(req, parse(dateQuery, req.query).date));
}

export async function book(req, res) {
  res.status(201).json({ appointment: await service.book(req, parse(bookBody, req.body)) });
}

export async function giveToken(req, res) {
  res.status(201).json({ appointment: await service.giveToken(req, parse(tokenBody, req.body)) });
}

export async function move(req, res) {
  res.json({ appointment: await service.move(req, idOf(req), parse(moveBody, req.body)) });
}

export async function cancel(req, res) {
  res.json({ appointment: await service.cancel(req, idOf(req), parse(cancelBody, req.body)) });
}

export async function link(req, res) {
  res.json({ appointment: await service.link(req, idOf(req), parse(linkBody, req.body).patientId) });
}

export async function arrive(req, res) {
  res.json({ appointment: await service.arrive(req, idOf(req)) });
}

export async function undoArrival(req, res) {
  res.json({ appointment: await service.undoArrival(req, idOf(req)) });
}

export async function markSeen(req, res) {
  res.json({ appointment: await service.markSeen(req, idOf(req)) });
}

export async function reminderSent(req, res) {
  res.json({ appointment: await service.markReminderSent(req, idOf(req)) });
}
