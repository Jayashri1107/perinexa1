import { z } from 'zod';
import { listQuery } from '../../core/pagination.js';
import { email, name, objectId, optionalText, toObjectId } from '../../core/validate.js';

export const hospitalListQuery = listQuery({
  sortFields: ['name', 'code', 'createdAt'],
  extra: {
    status: z.enum(['active', 'inactive']).optional(),
    departmentId: objectId.transform(toObjectId).optional(),
  },
});

const optionalEmail = z.union([z.literal(''), email]).default('');

const editable = {
  name: name('Hospital name', 150),
  email: optionalEmail,
  phone: z.string().trim().regex(/^[0-9+\-\s]{0,20}$/, 'Enter a valid phone number').default(''),
  address: z
    .object({
      line: optionalText(200),
      city: optionalText(80),
      state: optionalText(80),
      pincode: z.string().trim().regex(/^[0-9]{0,6}$/, 'PIN code: up to 6 digits').default(''),
    })
    .default({}),
  departments: z.array(objectId).max(100).default([]),
};

// A new hospital can be created together with its first hospital admin.
export const createHospitalBody = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,12}$/, 'Code: 2–12 letters, numbers or -'),
  ...editable,
  // optional, but when given, both the name and the email are needed
  firstAdmin: z.object({ name: name('Admin name'), email }).optional(),
});

export const updateHospitalBody = z.object(editable);
