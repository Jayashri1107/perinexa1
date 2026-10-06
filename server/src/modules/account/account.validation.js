import { z } from 'zod';
import { DENSITY_KEYS, TEXT_SIZE_KEYS } from '../../config/index.js';
import { optionalText } from '../../core/validate.js';

export const professionalBody = z.object({
  qualification: optionalText(150),
  registrationNumber: optionalText(60),
  council: optionalText(120),
});

export const appearanceBody = z.object({
  textSize: z.enum(TEXT_SIZE_KEYS, 'Choose a text size'),
  density: z.enum(DENSITY_KEYS, 'Choose the spacing'),
});
