import { z } from 'zod';
import { config } from '../../config/index.js';
import { listQuery } from '../../core/pagination.js';
import { objectId } from '../../core/validate.js';
import { LAB_TESTS, OTHER_TEST } from './labTests.js';

const { maxTestsPerOrder } = config.lab;
const testKey = z.enum([...LAB_TESTS.map((t) => t.key)]);

export const VIEWS = ['collect', 'received', 'processing', 'report', 'review', 'done', 'cancelled'];

export const orderListQuery = listQuery({
  sortFields: ['createdAt'],
  defaultSort: '-createdAt',
  extra: { view: z.enum(['', ...VIEWS]).default(''), mine: z.enum(['', 'true']).default('') },
});

export const idParams = z.object({ id: objectId });
export const patientParams = z.object({ patientId: objectId });

export const orderBody = z
  .object({
    patientId: objectId,
    tests: z.array(testKey).max(maxTestsPerOrder).default([]),
    // tests not in the list, typed by the doctor (the lab writes their result as text)
    otherTests: z.array(z.string().trim().min(2, 'Name the test').max(150)).max(10).default([]),
    packages: z.array(z.string().trim().max(60)).max(10).default([]),
    urgent: z.boolean().default(false),
    noteToLab: z.string().trim().max(500).default(''),
  })
  .refine((b) => b.tests.length + b.otherTests.length > 0, { path: ['tests'], message: 'Choose at least one test' })
  .refine((b) => b.tests.length + b.otherTests.length <= maxTestsPerOrder, { path: ['tests'], message: `At most ${maxTestsPerOrder} tests in one order` });

export const resultsBody = z.object({
  tests: z
    .array(
      z.object({
        key: z.union([testKey, z.literal(OTHER_TEST)]),
        name: z.string().trim().max(150).default(''),
        values: z.record(z.string(), z.string().trim().max(200)).default({}),
        text: z.string().trim().max(2000).default(''),
      }),
    )
    .max(maxTestsPerOrder + 10),
  labNote: z.string().trim().max(1000).default(''),
  // needed when results already reported are changed
  reason: z.string().trim().max(300).default(''),
});

export const cancelBody = z.object({ reason: z.string().trim().min(3, 'Say why (at least 3 characters)').max(300) });
export const queryBody = z.object({ text: z.string().trim().min(5, 'Write the question (at least 5 characters)').max(500) });
