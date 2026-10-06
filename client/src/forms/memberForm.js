// Hospital staff forms. roles: [{ value, label }].
export const addMemberFields = ({ roles }) => [
  { name: 'email', label: 'Email', type: 'email', required: true, width: 'half', help: 'If they already have an account, they keep the same login.' },
  { name: 'name', label: 'Full name', width: 'half', help: 'Needed only for a new person.' },
  { name: 'roles', label: 'Roles', type: 'checkboxes', required: true, options: roles },
];

export const emptyMember = { email: '', name: '', roles: [] };

export const memberRolesFields = ({ roles }) => [{ name: 'roles', label: 'Roles', type: 'checkboxes', required: true, options: roles }];
