const dateTime = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dateOnly = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export const formatDateTime = (value) => (value ? dateTime.format(new Date(value)) : '—');
export const formatDate = (value) => (value ? dateOnly.format(new Date(value)) : '—');

// A person's status on screen: active, inactive, or active but still on the temporary password.
export const userStatus = (user) => (!user.isActive ? 'inactive' : user.mustChangePassword ? 'pending' : 'active');

export const activeStatus = (record) => (record.isActive ? 'active' : 'inactive');

// [{ key, label }] → [{ value, label }] for selects and checkboxes.
export const toOptions = (items, valueKey = 'key', labelKey = 'label') =>
  items.map((i) => ({ value: i[valueKey], label: i[labelKey] }));
