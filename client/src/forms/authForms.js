import { LockKeyhole, Mail } from 'lucide-react';

export const loginFields = [
  { name: 'email', label: 'Email address', type: 'email', required: true, autoComplete: 'username', placeholder: 'Enter your email address', icon: Mail },
  { name: 'password', label: 'Password', type: 'password', required: true, autoComplete: 'current-password', placeholder: 'Enter your password', icon: LockKeyhole },
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
    help: rules.ruleText, // the server's rule, e.g. "At least 8 characters, with a capital letter, a small letter, a number and a special character."
  },
  { name: 'confirmPassword', label: 'Repeat new password', type: 'password', required: true, autoComplete: 'new-password' },
];

export const emptyChangePassword = { currentPassword: '', newPassword: '', confirmPassword: '' };
