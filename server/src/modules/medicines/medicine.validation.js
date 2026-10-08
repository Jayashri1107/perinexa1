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

// A new medicine comes with its opening stock (owner, 8 Oct 2026): batch, expiry, quantity, purchase price and MRP –
// so it can be sold, and priced on prescriptions, at once.
const money = (label) => z.coerce.number({ error: `Enter the ${label}` }).min(0, `The ${label} cannot be below 0`).max(1000000);
export const newMedicineBody = medicineBody.extend({
  stock: z
    .object({
      batch: z.string().trim().min(1, 'Enter the batch number').max(40),
      expiry: z.coerce.date({ error: 'Choose the expiry date' }).refine((d) => d > new Date(), 'The expiry date must be in the future'),
      qty: z.coerce.number({ error: 'Enter the quantity' }).int('Whole units only').min(1, 'At least 1').max(1000000),
      purchasePrice: money('purchase price (per unit)'),
      mrp: money('MRP (per unit)').refine((n) => n > 0, 'Enter the MRP (per unit)'),
    })
    .refine((s) => s.mrp >= s.purchasePrice, { path: ['mrp'], message: 'The MRP is below the purchase price' }),
});

export const optionsQuery =z.object({ search: z.string().trim().max(60).default('') });
