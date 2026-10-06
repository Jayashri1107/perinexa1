// One way to page through any list: the same query parameters (page, limit, search, sort) and the same
// response shape ({ items, pagination }) for every module. Lists run as one aggregate:
// match → sort → $facet { the page (then any joins), the total }.
// Joins ($lookup) go after $skip/$limit, so they run for the rows on the page only, not for the whole collection.
import { z } from 'zod';
import { config } from '../config/index.js';

const { defaultLimit, limitOptions, maxLimit } = config.pagination;

// The query schema of a list. sortFields: the fields the list may be sorted by ("-name" = descending);
// defaultSort: the order when none is asked for. extra: the list's own filters.
export function listQuery({ sortFields, defaultSort = sortFields[0], extra = {} }) {
  const sortValues = sortFields.flatMap((f) => [f, `-${f}`]);
  return z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(maxLimit)
      .refine((n) => limitOptions.includes(n), `Choose one of ${limitOptions.join(', ')} rows per page`)
      .default(defaultLimit),
    search: z.string().trim().max(100).default(''),
    sort: z.enum(sortValues).default(defaultSort),
    ...extra,
  });
}

// "-createdAt" → { createdAt: -1, _id: -1 }. _id makes the order stable when values are equal.
export function toSort(sort) {
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  return { [field]: desc ? -1 : 1, _id: desc ? -1 : 1 };
}

export async function paginate(Model, { match = {}, sort, page, limit, pageStages = [], preStages = [] }) {
  const [result] = await Model.aggregate([
    { $match: match },
    ...preStages,
    { $sort: sort },
    {
      $facet: {
        items: [{ $skip: (page - 1) * limit }, { $limit: limit }, ...pageStages],
        total: [{ $count: 'count' }],
      },
    },
  ]);
  const total = result?.total[0]?.count ?? 0;
  return {
    items: result?.items ?? [],
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  };
}
