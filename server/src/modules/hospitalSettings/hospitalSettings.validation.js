// The sections of Hospital settings and what each may contain. A new section = one entry here + its fields in
// hospital.model.js + its form on the website.
import { z } from 'zod';
import { LANGUAGE_KEYS } from '../../config/index.js';
import { optionalText } from '../../core/validate.js';

const optionalEmail = z.union([z.literal(''), z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'))]).default('');

export const SETTINGS_SECTIONS = {
  letterhead: z.object({
    name: optionalText(150),
    tagline: optionalText(150),
    address: optionalText(300),
    phone: optionalText(60),
    email: optionalEmail,
    registrationNumber: optionalText(80),
    footer: optionalText(300),
    consentLanguage: z.enum(LANGUAGE_KEYS, 'Choose a language'),
  }),
  messaging: z
    .object({
      remindersEnabled: z.boolean(),
      portalEnabled: z.boolean(),
      portalBooking: z.boolean(),
      whatsappDocuments: z.boolean(),
    })
    .refine((d) => !d.portalBooking || d.portalEnabled, {
      path: ['portalBooking'],
      message: 'Booking in the portal needs the patient portal switched on.',
    }),
  abdm: z.object({
    hfrId: z.string().trim().regex(/^[A-Za-z0-9_-]{0,60}$/, 'Letters, numbers, - or _ only').default(''),
    hipId: z.string().trim().regex(/^[A-Za-z0-9_-]{0,60}$/, 'Letters, numbers, - or _ only').default(''),
    counterCode: z.string().trim().regex(/^[A-Za-z0-9_-]{0,40}$/, 'Letters, numbers, - or _ only').default(''),
  }),
};

export const SECTION_KEYS = Object.keys(SETTINGS_SECTIONS);

export const sectionParams = z.object({ section: z.enum(SECTION_KEYS, 'Unknown settings section') });
