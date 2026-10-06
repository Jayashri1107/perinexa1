import { z } from 'zod';
import { VISIT_TYPE_KEYS, config } from '../../config/index.js';
import { listQuery } from '../../core/pagination.js';
import { objectId } from '../../core/validate.js';

const { slotMinutes, maxSessionsPerDay, maxLeavePeriods } = config.opd;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, e.g. 09:30');
const minutesOf = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date')
  .transform((d) => new Date(`${d}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'Choose a valid date');

const session = z.object({ from: time, to: time }).refine((s) => minutesOf(s.from) < minutesOf(s.to), {
  path: ['to'],
  message: 'The session must end after it starts',
});

const day = z
  .object({
    day: z.number().int().min(0).max(6),
    sessions: z.array(session).max(maxSessionsPerDay, `At most ${maxSessionsPerDay} sessions a day`),
  })
  .refine(
    (d) => {
      const sorted = [...d.sessions].sort((a, b) => minutesOf(a.from) - minutesOf(b.from));
      return sorted.every((s, i) => i === 0 || minutesOf(sorted[i - 1].to) <= minutesOf(s.from));
    },
    { path: ['sessions'], message: 'Sessions on the same day must not overlap' },
  );

const length = z
  .number()
  .int()
  .min(slotMinutes, `At least ${slotMinutes} minutes`)
  .max(240, 'At most 240 minutes')
  .refine((n) => n % slotMinutes === 0, `Use steps of ${slotMinutes} minutes`);

export const doctorParams = z.object({ doctorId: objectId });

export const doctorListQuery = listQuery({ sortFields: ['createdAt'], defaultSort: 'createdAt' });

export const scheduleBody = z.object({
  week: z
    .array(day)
    .max(7)
    .refine((w) => new Set(w.map((d) => d.day)).size === w.length, 'Each day once only'),
  lengths: z.object(Object.fromEntries(VISIT_TYPE_KEYS.map((k) => [k, length]))),
  leave: z
    .array(
      z
        .object({ from: isoDate, to: isoDate, note: z.string().trim().max(100).default('') })
        .refine((l) => l.from <= l.to, { path: ['to'], message: 'Leave must end on or after its first day' }),
    )
    .max(maxLeavePeriods, `At most ${maxLeavePeriods} leave periods`),
});
