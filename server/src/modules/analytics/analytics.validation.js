import { z } from 'zod';

export const summaryQuery = z.object({ mine: z.enum(['true', 'false']).default('false') });
