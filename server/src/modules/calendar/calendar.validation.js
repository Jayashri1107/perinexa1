import { z } from 'zod';
import { isoDate } from '../appointments/appointment.validation.js';
import { EVENT_TYPES } from './calendar.service.js';

export const calendarQuery = z.object({
  from: isoDate('Start date'),
  to: isoDate('End date'),
  scope: z.enum(['mine', 'all']).default('all'),
  // "booked,edd" → ['booked', 'edd']
  types: z
    .string()
    .default('')
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(EVENT_TYPES))),
});
