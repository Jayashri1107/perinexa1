import { z } from 'zod';
import { DENSITY_KEYS, TEXT_SIZE_KEYS } from '../../config/index.js';
import { name, optionalText } from '../../core/validate.js';

export const profileBody = z.object({
  name: name('Name'),
  phone: z.string().trim().regex(/^$|^[0-9+ -]{6,20}$/, 'Enter a phone number').default(''),
});

export const professionalBody = z.object({
  qualification: optionalText(150),
  registrationNumber: optionalText(60),
  council: optionalText(120),
});

export const appearanceBody = z.object({
  textSize: z.enum(TEXT_SIZE_KEYS, 'Choose a text size'),
  density: z.enum(DENSITY_KEYS, 'Choose the spacing'),
});

// A profile photo as a data URL (the website shrinks it first); what it really is, is checked from its bytes.
export const photoBody = z.object({
  image: z.string('Choose a photo').max(300_000, 'This photo is too large. Choose a smaller one.').regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'Choose a photo (JPEG, PNG or WebP).'),
});
