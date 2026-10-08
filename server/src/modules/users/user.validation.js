import { z } from 'zod';
import { ROLE_KEYS } from '../../config/index.js';
import { listQuery } from '../../core/pagination.js';
import { email, name, objectId, optional, toObjectId } from '../../core/validate.js';

export const USER_STATUSES = ['active', 'inactive', 'pending'];
export const ACCOUNT_TYPES = ['superAdmin', 'staff'];

export const userListQuery = listQuery({
  sortFields: ['name', 'email', 'createdAt', 'lastLoginAt'],
  extra: {
    status: z.enum(USER_STATUSES).optional(),
    // super admins, hospital staff, or one staff position (a role key: people with that role in a hospital – in the
    // chosen hospital, when one is chosen)
    kind: z.enum([...ACCOUNT_TYPES, ...ROLE_KEYS]).optional(),
    hospitalId: objectId.transform(toObjectId).optional(),
  },
});

// A super admin account, or a hospital staff account (then a hospital and at least one role are needed).
export const createUserBody = z
  .object({
    name: name(),
    email,
    accountType: z.enum(ACCOUNT_TYPES, 'Choose the type of account'),
    hospitalId: optional(objectId),
    roles: z.array(z.enum(ROLE_KEYS)).default([]),
  })
  .superRefine((d, ctx) => {
    if (d.accountType !== 'staff') return;
    if (!d.hospitalId) ctx.addIssue({ code: 'custom', path: ['hospitalId'], message: 'Choose a hospital' });
    if (!d.roles.length) ctx.addIssue({ code: 'custom', path: ['roles'], message: 'Choose at least one role' });
  });

export const updateUserBody = z.object({ name: name(), email });
