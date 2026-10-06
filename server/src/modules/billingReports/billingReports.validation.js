import { z } from 'zod';
import { config } from '../../config/index.js';
import { listQuery } from '../../core/pagination.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date');

export const unpaidQuery = listQuery({ sortFields: ['createdAt'] });
export const dailyQuery = z.object({ date });
export const monthlyQuery = z.object({ months: z.coerce.number().int().min(1).max(36).default(config.analytics.months) });
export const exportQuery = z.object({ from: date, to: date }).refine((q) => q.from <= q.to, { path: ['to'], message: 'The end must be on or after the start' });
