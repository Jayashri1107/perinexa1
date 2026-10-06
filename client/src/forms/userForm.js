// Account forms. roles and hospitals: [{ value, label }].
export const ACCOUNT_TYPE_OPTIONS = [
  { value: 'staff', label: 'Hospital staff' },
  { value: 'superAdmin', label: 'Super admin (whole platform, no patient data)' },
];

const isStaff = (v) => v.accountType === 'staff';

export const newUserFields = ({ roles, hospitals }) => [
  { name: 'accountType', label: 'Type of account', type: 'select', required: true, options: ACCOUNT_TYPE_OPTIONS },
  { name: 'name', label: 'Full name', required: true, width: 'half' },
  { name: 'email', label: 'Email', type: 'email', required: true, width: 'half' },
  { name: 'hospitalId', label: 'Hospital', type: 'select', required: true, options: hospitals, showIf: isStaff },
  { name: 'roles', label: 'Roles in this hospital', type: 'checkboxes', required: true, options: roles, showIf: isStaff },
];

export const emptyUser = { accountType: 'staff', name: '', email: '', hospitalId: '', roles: [] };

export const editUserFields = [{ name: 'name', label: 'Full name', required: true }];
