import { z } from 'zod';

// A UPI ID looks like name@bank; empty switches UPI links off.
export const billingSettingsBody = z.object({
  upiId: z.string().trim().regex(/^$|^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$/, 'A UPI ID looks like hospital@okbank').default(''),
  payeeName: z.string().trim().max(80).default(''),
});
