import { parse } from '../../core/validate.js';
import * as service from './calendar.service.js';
import { calendarQuery } from './calendar.validation.js';

export async function events(req, res) {
  res.json(await service.events(req, parse(calendarQuery, req.query)));
}
