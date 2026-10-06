import { z } from 'zod';
import { config } from '../../config/index.js';
import { passwordSchema } from '../../core/password.js';
import { objectId } from '../../core/validate.js';

export const switchHospitalBody = z.object({ hospitalId: objectId });

const { maxLength } = config.auth.password;

export const loginBody = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Email is required').max(254),
  password: z.string().min(1, 'Password is required').max(maxLength),
});

export const changePasswordBody = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required').max(maxLength),
    newPassword: passwordSchema,
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    path: ['newPassword'],
    message: 'New password must be different from the current one',
  });
