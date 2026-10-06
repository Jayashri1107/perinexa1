// Account forms. roles and hospitals: [{ value, label }].
export const ACCOUNT_TYPE_OPTIONS = [
  { value: 'staff', label: 'Hospital staff' },
  { value: 'superAdmin', label: 'Super admin (whole platform, no patient data)' },
];

const isStaff = (v) => v.accountType === 'staff';

// canCreateSuperAdmin: only the main super admin may create super admin accounts.
export const newUserFields = ({ roles, hospitals, canCreateSuperAdmin }) => [
  {
    name: 'accountType',
    label: 'Type of account',
    type: 'select',
    required: true,
    options: ACCOUNT_TYPE_OPTIONS.filter((o) => canCreateSuperAdmin || o.value !== 'superAdmin'),
  },
  { name: 'name', label: 'Full name', required: true, width: 'half' },
  { name: 'email', label: 'Email', type: 'email', required: true, width: 'half' },
  { name: 'hospitalId', label: 'Hospital', type: 'select', required: true, options: hospitals, showIf: isStaff },
  { name: 'roles', label: 'Roles in this hospital', type: 'checkboxes', required: true, options: roles, showIf: isStaff },
];

export const emptyUser = { accountType: 'staff', name: '', email: '', hospitalId: '', roles: [] };

// Edit an account: name, email, and the roles ("post") in each hospital the person works in.
export const editUserFields = ({ memberships = [], roles }) => [
  { name: 'name', label: 'Full name', required: true, width: 'half' },
  { name: 'email', label: 'Email (login)', type: 'email', required: true, width: 'half', help: 'Changing it signs them out; they log in with the new email.' },
  ...(memberships.length ? [{ section: 'Roles in each hospital' }] : []),
  ...memberships.map((m) => ({
    name: `roles.${m.id}`,
    label: `${m.hospital?.name ?? 'Hospital'}${m.isActive ? '' : ' (access removed)'}`,
    type: 'checkboxes',
    required: true,
    options: roles,
  })),
];

export const editUserValues = (u) => ({
  name: u.name,
  email: u.email,
  roles: Object.fromEntries((u.memberships ?? []).map((m) => [m.id, [...m.roles]])),
});
