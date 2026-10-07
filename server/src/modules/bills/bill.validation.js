import { z } from 'zod';
import { PAYMENT_MODE_KEYS, PRICE_GROUP_KEYS, config } from '../../config/index.js';
import { listQuery } from '../../core/pagination.js';
import { objectId, optional, toObjectId } from '../../core/validate.js';

const NEEDS_REFERENCE = new Set(config.billing.paymentModes.filter((m) => m.needsReference).map((m) => m.key));
const money = z.coerce.number().positive('Enter an amount above 0').max(10000000);

export const billParams = z.object({ id: objectId });
export const lineParams = z.object({ id: objectId, lineId: objectId });

export const billListQuery = listQuery({
  sortFields: ['createdAt', 'total', 'balance'],
  defaultSort: '-createdAt',
  extra: {
    status: z.enum(['open', 'paid', 'cancelled']).optional(),
    patientId: optional(objectId.transform(toObjectId)),
    from: optional(z.coerce.date()),
    to: optional(z.coerce.date()),
  },
});

// A line from the price list (priceItemId), or written in (name, group, unitPrice).
const line = z
  .object({
    priceItemId: optional(objectId),
    name: z.string().trim().max(150).default(''),
    group: optional(z.enum(PRICE_GROUP_KEYS)),
    unitPrice: optional(z.coerce.number().min(0).max(10000000)),
    qty: z.coerce.number().int().min(1, 'At least 1').max(1000).default(1),
  })
  .refine((l) => l.priceItemId || (l.name.length >= 2 && l.group && l.unitPrice !== undefined), {
    message: 'Choose a price list item, or give a name, group and price',
  });

// A line changed on an open bill: its quantity and rate.
export const lineUpdateBody = z.object({
  qty: z.coerce.number().int().min(1, 'At least 1').max(1000),
  unitPrice: z.coerce.number().min(0, 'The rate cannot be below 0').max(10000000),
});

export const createBillBody = z.object({ patientId: objectId, lines: z.array(line).min(1, 'Add at least one line').max(100) });
export const addLinesBody = z.object({ lines: z.array(line).min(1, 'Add at least one line').max(100) });

export const discountBody = z
  .object({
    mode: z.enum(['amount', 'percent']),
    value: z.coerce.number().min(0).max(10000000),
    reason: z.string().trim().max(200).default(''),
  })
  .refine((d) => d.mode !== 'percent' || d.value <= 100, { path: ['value'], message: 'At most 100%' })
  .refine((d) => d.value === 0 || d.reason.length >= 3, { path: ['reason'], message: 'Give the reason for the discount' });

export const cancelBody = z.object({ reason: z.string().trim().min(3, 'Give the reason').max(200) });

const withReference = (schema) =>
  schema.refine((p) => !NEEDS_REFERENCE.has(p.mode) || p.reference.length > 0, {
    path: ['reference'],
    message: 'Enter the reference (transaction, card slip or claim number)',
  });

export const paymentBody = withReference(
  z.object({ mode: z.enum(PAYMENT_MODE_KEYS, 'Choose how it was paid'), reference: z.string().trim().max(100).default(''), amount: money }),
);

export const refundBody = withReference(
  z.object({
    mode: z.enum(PAYMENT_MODE_KEYS, 'Choose how it was refunded'),
    reference: z.string().trim().max(100).default(''),
    amount: money,
    reason: z.string().trim().min(3, 'Give the reason').max(200),
  }),
);

export const patientSearchQuery = z.object({ search: z.string().trim().max(60).default('') });
