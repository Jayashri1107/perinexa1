import { z } from 'zod';
import { PAYMENT_MODE_KEYS } from '../../config/index.js';
import { listQuery } from '../../core/pagination.js';
import { objectId, optional, toObjectId } from '../../core/validate.js';

export const saleParams = z.object({ id: objectId });

export const saleListQuery = listQuery({
  sortFields: ['createdAt', 'total'],
  defaultSort: '-createdAt',
  extra: {
    status: z.enum(['completed', 'part_returned', 'returned']).optional(),
    from: optional(z.coerce.date()),
    to: optional(z.coerce.date()),
  },
});

// A medicine and how many; batchId only to choose a batch other than the earliest-expiring one.
const line = z.object({
  medicineId: objectId,
  qty: z.coerce.number().int().min(1, 'At least 1').max(10000),
  batchId: optional(objectId),
});

export const saleBody = z
  .object({
    patientId: optional(objectId),
    // sold from a prescription a doctor sent to the pharmacy: it is then marked given
    visitId: optional(objectId),
    customerName: z.string().trim().max(120).default(''),
    doctorName: z.string().trim().max(120).default(''),
    lines: z.array(line).min(1, 'Add at least one medicine').max(100),
    discount: z
      .object({ amount: z.coerce.number().min(0).max(1000000).default(0), reason: z.string().trim().max(200).default('') })
      .default({ amount: 0, reason: '' })
      .refine((d) => d.amount === 0 || d.reason.length >= 3, { path: ['reason'], message: 'Give the reason for the discount' }),
    payTo: z.enum(['counter', 'bill']),
    mode: optional(z.enum(PAYMENT_MODE_KEYS)),
    reference: z.string().trim().max(100).default(''),
  })
  .refine((s) => s.payTo === 'bill' || s.mode, { path: ['mode'], message: 'Choose how it was paid' })
  .refine((s) => s.payTo === 'counter' || s.patientId, { path: ['payTo'], message: 'Only a registered patient’s sale can go on a hospital bill' });

export const returnBody = z.object({
  lines: z.array(z.object({ lineId: objectId, qty: z.coerce.number().int().min(1) })).min(1, 'Choose what is returned'),
  reason: z.string().trim().min(3, 'Give the reason').max(200),
  refundMode: optional(z.enum(PAYMENT_MODE_KEYS)),
});
