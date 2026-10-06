import { z } from 'zod';
import { config } from '../../config/index.js';
import { listQuery } from '../../core/pagination.js';
import { objectId, optional, toObjectId } from '../../core/validate.js';

export const purchaseParams = z.object({ id: objectId });

export const purchaseListQuery = listQuery({
  sortFields: ['invoiceDate', 'createdAt', 'total'],
  defaultSort: '-invoiceDate',
  extra: { supplierId: optional(objectId.transform(toObjectId)) },
});

const line = z
  .object({
    medicineId: objectId,
    batch: z.string().trim().min(1, 'Enter the batch').max(40),
    expiry: z.coerce.date().refine((d) => d > new Date(), 'The expiry must be in the future'),
    qty: z.coerce.number().int().min(1, 'At least 1').max(1000000),
    freeQty: z.coerce.number().int().min(0).max(1000000).default(0),
    purchasePrice: z.coerce.number().min(0).max(1000000),
    mrp: z.coerce.number().positive('Enter the MRP').max(1000000),
    gstRate: z.coerce.number().refine((n) => config.pharmacy.gstRates.includes(n), 'Choose a GST rate'),
  })
  .refine((l) => l.purchasePrice <= l.mrp, { path: ['purchasePrice'], message: 'The cost cannot be above the MRP' });

export const purchaseBody = z.object({
  supplierId: objectId,
  invoiceNumber: z.string().trim().min(1, 'Enter the invoice number').max(60),
  invoiceDate: z.coerce.date().refine((d) => d <= new Date(), 'The invoice date cannot be in the future'),
  lines: z.array(line).min(1, 'Add at least one medicine').max(200),
});
