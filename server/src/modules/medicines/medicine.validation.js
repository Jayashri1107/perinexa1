import { z } from 'zod';
import { MEDICINE_FORM_KEYS, SCHEDULE_KEYS, config } from '../../config/index.js';
import { listQuery } from '../../core/pagination.js';
import { name, objectId, optionalText } from '../../core/validate.js';

export const medicineParams = z.object({ id: objectId });

export const medicineListQuery = listQuery({
  sortFields: ['name', 'createdAt'],
  extra: {
    schedule: z.enum(SCHEDULE_KEYS).optional(),
    status: z.enum(['active', 'inactive']).optional(),
  },
});

export const medicineBody = z.object({
  name: name('Medicine name', 120),
  generic: optionalText(150),
  form: z.enum(MEDICINE_FORM_KEYS, 'Choose the form'),
  strength: optionalText(40),
  schedule: z.enum(SCHEDULE_KEYS, 'Choose the schedule'),
  gstRate: z.coerce.number().refine((n) => config.pharmacy.gstRates.includes(n), `GST: one of ${config.pharmacy.gstRates.join(', ')}%`),
  hsn: z.string().trim().regex(/^[0-9]{0,10}$/, 'HSN: digits only').default(''),
  reorderLevel: z.coerce.number().int().min(0).max(100000).default(0),
});

export const optionsQuery = z.object({ search: z.string().trim().max(60).default('') });
