import { z } from 'zod';
import { MASTER_TYPE_KEYS } from '../../config/index.js';
import { listQuery } from '../../core/pagination.js';
import { name, objectId, optionalText } from '../../core/validate.js';

const type = z.enum(MASTER_TYPE_KEYS, 'Unknown master data list');

export const typeParams = z.object({ type });
export const itemParams = z.object({ type, id: objectId });

export const masterListQuery = listQuery({
  sortFields: ['sortOrder', 'name', 'code', 'createdAt'],
  extra: { status: z.enum(['active', 'inactive']).optional() },
});

const editable = {
  name: name('Name', 120),
  description: optionalText(500),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
};

export const createMasterBody = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,20}$/, 'Code: 2–20 letters, numbers, - or _'),
  ...editable,
});

export const updateMasterBody = z.object(editable);
