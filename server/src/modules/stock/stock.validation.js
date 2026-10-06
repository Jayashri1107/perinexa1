import { z } from 'zod';
import { ADJUST_REASON_KEYS } from '../../config/index.js';
import { listQuery } from '../../core/pagination.js';
import { objectId } from '../../core/validate.js';

export const medicineParams = z.object({ medicineId: objectId });
export const batchParams = z.object({ batchId: objectId });

export const stockListQuery = listQuery({
  sortFields: ['name'],
  extra: { lowStock: z.enum(['true', 'false']).optional() },
});

// Write-off: units out (expired, damaged, lost). Count: the counted number replaces what the system shows.
export const adjustBody = z
  .object({
    kind: z.enum(['writeoff', 'count']),
    qty: z.coerce.number().int().min(0).max(1000000),
    reason: z.enum(ADJUST_REASON_KEYS, 'Choose the reason'),
    note: z.string().trim().max(200).default(''),
  })
  .refine((a) => a.kind !== 'writeoff' || a.qty > 0, { path: ['qty'], message: 'Write off at least 1' });
