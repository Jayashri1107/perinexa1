import { z } from 'zod';

// Checks incoming data against a schema. Throws a ZodError (turned into a 400 response) if it doesn't fit.
export const parse = (schema, data) => schema.parse(data ?? {});

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const idParams = z.object({ id: objectId });

// A date without a time ("2026-10-12"), stored as midnight UTC so it means the same day everywhere.
export const requiredDateOnly = (label) =>
  z.iso.date(`${label}: please enter a valid date`).transform((d) => new Date(`${d}T00:00:00Z`));
// The same, or null for "not given".
export const dateOnly = (label) => z.union([requiredDateOnly(label), z.null()]);

// Why a file with patient names is downloaded (owner's decision of 17 Nov 2026, health check M7): written to the audit
// log with the download, so every bulk copy of names has a stated purpose.
export const exportReason = z
  .string('Say why you need this file')
  .trim()
  .min(5, 'Say why you need this file (at least 5 characters)')
  .max(200, 'The reason is too long (at most 200 characters)');

export const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Sorting for lists. `allowed` are field names; the browser sends e.g. "name" (A→Z) or "-createdAt" (newest first).
export const sortParam = (allowed, fallback) =>
  z.enum([...allowed, ...allowed.map((f) => `-${f}`)]).default(fallback);

// Turns "-createdAt" into { createdAt: -1, _id: -1 } (the _id makes the order stable across pages).
export function toMongoSort(sort) {
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  return { [field]: desc ? -1 : 1, _id: desc ? -1 : 1 };
}

export const pageParams = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};

export const paged = (q, total) => ({
  page: q.page,
  limit: q.limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / q.limit)),
});
