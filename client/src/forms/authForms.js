export const loginFields = [
  { name: 'email', label: 'Email', type: 'email', required: true, autoComplete: 'username' },
  { name: 'password', label: 'Password', type: 'password', required: true, autoComplete: 'current-password' },
];

export const emptyLogin = { email: '', password: '' };

export const changePasswordFields = (rules) => [
  { name: 'currentPassword', label: 'Current or temporary password', type: 'password', required: true, autoComplete: 'current-password' },
  {
    name: 'newPassword',
    label: 'New password',
    type: 'password',
    required: true,
    autoComplete: 'new-password',
    help: `At least ${rules.minLength} characters, with at least one letter and one number.`,
  },
  { name: 'confirmPassword', label: 'Repeat new password', type: 'password', required: true, autoComplete: 'new-password' },
];

export const emptyChangePassword = { currentPassword: '', newPassword: '', confirmPassword: '' };
