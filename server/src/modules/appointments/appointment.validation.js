import { z } from 'zod';
import { CANCEL_REASON_KEYS, VISIT_TYPE_KEYS } from '../../config/index.js';
import { objectId, optional } from '../../core/validate.js';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, e.g. 10:30');
export const isoDate = (label = 'Date') => z.string({ error: `Choose a ${label.toLowerCase()}` }).regex(/^\d{4}-\d{2}-\d{2}$/, `Choose a ${label.toLowerCase()}`);
const phone = z.string().trim().regex(/^[0-9+\- ]{6,20}$/, 'Enter a phone number');

export const idParams = z.object({ id: objectId });
export const doctorParams = z.object({ doctorId: objectId });
export const patientParams = z.object({ patientId: objectId });

export const dayQuery = z.object({ doctorId: objectId, date: isoDate() });
export const dateQuery = z.object({ date: isoDate() });

// A booking: a registered patient, or a quick booking with a name and phone. start: null = "needs a time".
export const bookBody = z
  .object({
    doctorId: objectId,
    date: isoDate(),
    start: z.union([time, z.null()]).default(null),
    visitType: z.enum(VISIT_TYPE_KEYS),
    patientId: optional(objectId),
    guest: optional(z.object({ name: z.string().trim().min(2, 'Enter her name').max(120), phone })),
    confirm: z.boolean().default(false),
  })
  .refine((b) => b.patientId || b.guest, { path: ['patientId'], message: 'Choose a patient, or give a name and phone' });

export const moveBody = z.object({
  doctorId: optional(objectId),
  date: isoDate(),
  start: time,
  visitType: optional(z.enum(VISIT_TYPE_KEYS)),
  confirm: z.boolean().default(false),
});

export const cancelBody = z.object({
  reason: z.enum(CANCEL_REASON_KEYS, { error: 'Choose a reason' }),
  note: z.string().trim().max(200).default(''),
});

export const tokenBody = z.object({ doctorId: objectId, patientId: objectId });

export const linkBody = z.object({ patientId: objectId });
