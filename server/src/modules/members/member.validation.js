import { z } from 'zod';
import { ROLE_KEYS } from '../../config/index.js';
import { listQuery } from '../../core/pagination.js';
import { email, name, objectId } from '../../core/validate.js';

const roles = z.array(z.enum(ROLE_KEYS)).min(1, 'Choose at least one role');

export const hospitalParams = z.object({ hospitalId: objectId });
export const memberParams = z.object({ hospitalId: objectId, memberId: objectId });

export const memberListQuery = listQuery({
  sortFields: ['createdAt'],
  defaultSort: '-createdAt',
  extra: {
    status: z.enum(['active', 'inactive']).optional(),
    role: z.enum(ROLE_KEYS).optional(),
  },
});

// The name is needed only for a person who has no account yet (an empty box counts as not given).
export const addMemberBody = z.object({
  name: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), name().optional()),
  email,
  roles,
});

export const rolesBody = z.object({ roles });
