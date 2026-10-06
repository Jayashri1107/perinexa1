// Small reusable aggregate stages, so every module shapes its output the same way.

// _id → id (the same as the toJSON setting does for single documents).
export const withId = () => [{ $set: { id: '$_id' } }, { $unset: '_id' }];

// Join one document from another collection, keeping only the listed fields.
export function lookupOne({ from, localField, as, fields }) {
  return [
    {
      $lookup: {
        from,
        localField,
        foreignField: '_id',
        as,
        pipeline: [{ $project: Object.fromEntries(fields.map((f) => [f, 1])) }, ...withId()],
      },
    },
    { $set: { [as]: { $first: `$${as}` } } },
  ];
}

// Join many documents by an array of ids, keeping only the listed fields.
export const lookupMany = ({ from, localField, as, fields }) => [
  {
    $lookup: {
      from,
      localField,
      foreignField: '_id',
      as,
      pipeline: [{ $project: Object.fromEntries(fields.map((f) => [f, 1])) }, ...withId()],
    },
  },
];

// { status: 'active' | 'inactive' } → a match on isActive.
export const statusMatch = (status) => (status ? { isActive: status === 'active' } : {});

// Turn [{ _id: key, count }] into { key: count }.
export const countsByKey = (rows) => Object.fromEntries(rows.map((r) => [String(r._id), r.count]));
