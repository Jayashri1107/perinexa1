import { z } from 'zod';
import { listQuery } from '../../core/pagination.js';
import { objectId, toObjectId } from '../../core/validate.js';
import { AUDIT_ACTION_KEYS, AUDIT_CATEGORIES } from './audit.actions.js';

export const auditListQuery = listQuery({
  sortFields: ['createdAt'],
  defaultSort: '-createdAt',
  extra: {
    action: z.enum(AUDIT_ACTION_KEYS).optional(),
    category: z.enum(AUDIT_CATEGORIES.map((c) => c.key)).optional(),
    hospitalId: objectId.transform(toObjectId).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  },
});
