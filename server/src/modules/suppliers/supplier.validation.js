import { z } from 'zod';
import { listQuery } from '../../core/pagination.js';
import { email, name, objectId, optionalText } from '../../core/validate.js';

export const supplierParams = z.object({ id: objectId });

export const supplierListQuery = listQuery({ sortFields: ['name', 'createdAt'], extra: { status: z.enum(['active', 'inactive']).optional() } });

export const supplierBody = z.object({
  name: name('Supplier name', 150),
  gstin: z.string().trim().toUpperCase().regex(/^$|^[0-9A-Z]{15}$/, 'GSTIN: 15 letters and numbers').default(''),
  drugLicence: optionalText(80),
  phone: z.string().trim().regex(/^[0-9+\-\s]{0,20}$/, 'Enter a valid phone number').default(''),
  email: z.union([z.literal(''), email]).default(''),
  address: optionalText(300),
});
