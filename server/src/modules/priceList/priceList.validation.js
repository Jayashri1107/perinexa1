import { z } from 'zod';
import { PRICE_GROUP_KEYS } from '../../config/index.js';
import { listQuery } from '../../core/pagination.js';
import { name, objectId } from '../../core/validate.js';

export const priceParams = z.object({ id: objectId });

export const priceListQuery = listQuery({
  sortFields: ['name', 'group', 'price', 'code'],
  extra: {
    group: z.enum(PRICE_GROUP_KEYS).optional(),
    status: z.enum(['active', 'inactive']).optional(),
  },
});

const editable = {
  name: name('Name', 120),
  group: z.enum(PRICE_GROUP_KEYS, 'Choose a group'),
  price: z.coerce.number().min(0, 'The price cannot be negative').max(10000000),
};

export const createPriceBody = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, 'Code: 2–20 letters, numbers, - or _'),
  ...editable,
});

export const updatePriceBody = z.object(editable);
