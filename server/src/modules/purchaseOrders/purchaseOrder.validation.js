import { z } from 'zod';
import { listQuery } from '../../core/pagination.js';
import { objectId } from '../../core/validate.js';
import { ORDER_STATUSES } from './purchaseOrder.model.js';

export const orderParams = z.object({ id: objectId });

export const orderListQuery = listQuery({
  sortFields: ['createdAt'],
  defaultSort: '-createdAt',
  extra: {
    status: z.enum(['', 'open', ...ORDER_STATUSES]).default(''),
    supplierId: z.union([objectId, z.literal('')]).default(''),
  },
});

export const orderBody = z.object({
  supplierId: objectId,
  note: z.string().trim().max(500).default(''),
  lines: z
    .array(z.object({ medicineId: objectId, qty: z.coerce.number().int().min(1, 'At least 1').max(1000000) }))
    .min(1, 'Add at least one medicine')
    .max(200),
});

export const reasonBody = z.object({ reason: z.string().trim().min(3, 'Say why (at least 3 characters)').max(300) });
