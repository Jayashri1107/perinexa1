import { z } from 'zod';
import { SUPPLIER_RETURN_REASON_KEYS } from '../../config/index.js';
import { listQuery } from '../../core/pagination.js';
import { objectId } from '../../core/validate.js';

export const returnParams = z.object({ id: objectId });
export const supplierParams = z.object({ supplierId: objectId });

export const returnListQuery = listQuery({ sortFields: ['createdAt'], defaultSort: '-createdAt' });

export const returnBody = z.object({
  supplierId: objectId,
  reason: z.enum(SUPPLIER_RETURN_REASON_KEYS, { error: 'Choose a reason' }),
  note: z.string().trim().max(300).default(''),
  witness: z.string().trim().max(100).default(''),
  lines: z
    .array(z.object({ batchId: objectId, qty: z.coerce.number().int().min(1, 'At least 1').max(1000000) }))
    .min(1, 'Choose at least one batch')
    .max(100),
});

export const cancelBody = z.object({
  reason: z.string().trim().min(3, 'Say why (at least 3 characters)').max(300),
  witness: z.string().trim().max(100).default(''),
});
