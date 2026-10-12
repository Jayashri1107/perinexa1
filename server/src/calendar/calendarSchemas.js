// What the website may ask the calendar for: GET /api/calendar?view=&date=&types=&scope=
// Strict: an unknown or repeated parameter is refused (400).

import { z } from 'zod';
import { requiredDateOnly } from '../utils/validate.js';
import { EVENT_TYPES, VIEWS } from './calendarRules.js';

export { EVENT_TYPES };

// "booked,plan" → ['booked', 'plan'] (each type once, at least one).
const typesList = z
  .string()
  .trim()
  .max(40)
  .transform((s) => s.split(',').map((t) => t.trim()).filter(Boolean))
  .pipe(
    z
      .array(z.enum(EVENT_TYPES))
      .min(1, 'Choose at least one type.')
      .refine((a) => new Set(a).size === a.length, 'Each type only once.'),
  );

export const calendarQuerySchema = z.strictObject({
  view: z.enum(VIEWS).default('week'),
  date: requiredDateOnly('Date').optional(), // left out: the hospital's today
  types: typesList.optional(), // left out: every type this person may see
  scope: z.enum(['mine', 'all']).optional(), // left out: the role's default
});
