// Filters shared by several lists (the values match the servers' list queries).
export const STATUS_FILTER = {
  name: 'status',
  label: 'Status',
  options: [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
  ],
};

export const USER_STATUS_FILTER = {
  ...STATUS_FILTER,
  options: [...STATUS_FILTER.options, { value: 'pending', label: 'First login pending' }],
};
