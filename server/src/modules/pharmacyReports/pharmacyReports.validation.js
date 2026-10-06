import { z } from 'zod';
import { REGISTER_SCHEDULE_KEYS } from '../../config/index.js';
import { listQuery } from '../../core/pagination.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date');
const period = z.object({ from: date, to: date }).refine((q) => q.from <= q.to, { path: ['to'], message: 'The end must be on or after the start' });

export const periodQuery = period;
export const registerQuery = listQuery({
  sortFields: ['createdAt'],
  defaultSort: '-createdAt',
  extra: { schedule: z.enum(REGISTER_SCHEDULE_KEYS, 'Choose a register'), from: date, to: date },
});
