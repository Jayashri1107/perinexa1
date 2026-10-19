// The hospital's referral settings (docs/REFERRALS_PLAN.md, "Settings"): the centres a woman may be seen at, the
// referral desk's number, the consultants' direct lines (promise 6 of the guide: a consultant the referring doctor can
// call), the working hours and holidays the 2-hour reply clock counts in, and when an urgent referral is seen the next
// morning instead of the same day. Kept by the hospital admin (routes/settings.js, GET/PUT
// /api/tenant/settings/referrals); read by everyone in the hospital. PURE (no database): the routes check what needs
// the database (a consultant is an active doctor here; a centre in use is not removed).
//
// Real names and numbers are typed in by the hospital admin – never put here. The two default centres are the ones the
// owner named on 15 Oct 2026 (decision 1); the admin can rename them, add more (Waluj later) or mark one not in use.

import { z } from 'zod';
import { objectId } from '../utils/validate.js';

export const MAX_CENTRES = 10;
export const MAX_CONSULTANT_LINES = 30;
export const MAX_HOLIDAYS = 100;

/** What the hospital starts with (the guide's clocks: Monday–Saturday 9 am–8 pm; urgent after 8 pm → 8 am next day). */
export const REFERRAL_SETTINGS_DEFAULTS = Object.freeze({
  centres: Object.freeze([Object.freeze({ key: 'sutgirni', name: 'Sutgirni Chowk', active: true }), Object.freeze({ key: 'adalat', name: 'Adalat Road', active: true })]),
  deskNumber: '',
  consultantLines: Object.freeze([]),
  workingHours: Object.freeze({ days: Object.freeze([1, 2, 3, 4, 5, 6]), from: '09:00', to: '20:00' }), // 0 = Sunday
  holidays: Object.freeze([]),
  urgentCutoff: '20:00',
  urgentNextMorning: '08:00',
});

/** The settings' top-level fields, in order (the audit entry names the ones that changed – never their values). */
export const REFERRAL_SETTINGS_FIELDS = Object.keys(REFERRAL_SETTINGS_DEFAULTS);

// A time of day as 'HH:MM' (24 hours, hospital time)
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const copy = (v) => JSON.parse(JSON.stringify(v));
const asTime = (v, fallback) => (typeof v === 'string' && TIME.test(v) ? v : fallback);

/**
 * The hospital's referral settings, with the defaults for what was never saved. tenant: the hospital (a document or a
 * plain object). An empty list of centres or of working days counts as never saved – the settings route always keeps
 * at least one of each, so the clocks always have working time to count in and every referral has a centre.
 */
export function referralSettingsFor(tenant) {
  const raw = (typeof tenant?.toObject === 'function' ? tenant.toObject() : tenant)?.referrals ?? {};
  const d = REFERRAL_SETTINGS_DEFAULTS;
  const days = Array.isArray(raw.workingHours?.days) ? raw.workingHours.days.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : [];
  return {
    centres: Array.isArray(raw.centres) && raw.centres.length ? raw.centres.map((c) => ({ key: c.key, name: c.name ?? '', active: c.active !== false })) : copy(d.centres),
    deskNumber: raw.deskNumber ?? '',
    consultantLines: (raw.consultantLines ?? []).filter((l) => l?.userId).map((l) => ({ userId: String(l.userId), phone: l.phone ?? '', note: l.note ?? '' })),
    workingHours: {
      days: days.length ? [...new Set(days)].sort((a, b) => a - b) : copy(d.workingHours.days),
      from: asTime(raw.workingHours?.from, d.workingHours.from),
      to: asTime(raw.workingHours?.to, d.workingHours.to),
    },
    holidays: (raw.holidays ?? []).filter((h) => h?.on).map((h) => ({ on: h.on, note: h.note ?? '' })),
    urgentCutoff: asTime(raw.urgentCutoff, d.urgentCutoff),
    urgentNextMorning: asTime(raw.urgentNextMorning, d.urgentNextMorning),
  };
}

// ---------- Checking what the hospital admin saves (PUT /api/tenant/settings/referrals) ----------

const time = (label) => z.string(`${label}: please enter a time like 09:00.`).regex(TIME, `${label}: please enter a time like 09:00.`);
// One line of text (no tab, line break or other character that cannot be seen)
const line = (label, max) => z.string().trim().max(max, `${label} is too long (at most ${max} characters).`).regex(/^\P{Cc}*$/u, `${label} has a character that cannot be saved.`);
const phone = (label) => z.string().trim().max(30, `${label} is too long (at most 30 characters).`).regex(/^[0-9+()\-\s]*$/, `${label} can only contain numbers, spaces, +, ( ) and -`);

const centre = z
  .object({
    key: z.string().trim().regex(/^[a-z0-9_]{2,30}$/, 'A centre key is 2 to 30 small letters, digits or _ (for example "waluj").'),
    name: line('Centre name', 60).min(1, "Enter the centre's name."),
    active: z.boolean('Choose whether the centre is in use.').default(true),
  })
  .strict();

const consultantLine = z
  .object({
    userId: objectId,
    phone: phone('Direct line').min(1, 'Enter the direct line.'),
    note: line('Note', 100).default(''),
  })
  .strict();

const DAY_MESSAGE = 'A working day is 0 (Sunday) to 6 (Saturday).';

const holiday = z
  .object({
    on: z.iso.date('Holiday: please enter a valid date.'),
    note: line('Note', 100).default(''),
  })
  .strict();

/** Adds an issue at each repeat of the same value (path: list, index, field). Values not yet valid are skipped. */
function noRepeats(list, field, path, message, ctx) {
  const seen = new Set();
  list.forEach((item, i) => {
    const value = item?.[field];
    if (typeof value !== 'string' || !value) return;
    if (seen.has(value)) ctx.addIssue({ code: 'custom', path: [path, i, field], message });
    seen.add(value);
  });
}

// Cross-field checks run even when other fields have errors, so every problem is shown at once (values may not be
// valid yet here, so each check is careful about types).
const ALWAYS = { when: () => true };

/**
 * What the hospital admin sends. Every field may be left out: it then stays as it is (routes/settings.js merges the
 * rest with the saved settings). The checks here need no database.
 */
export const referralSettingsSchema = z
  .object({
    centres: z.array(centre).min(1, 'Keep at least one centre.').max(MAX_CENTRES, `At most ${MAX_CENTRES} centres.`).optional(),
    deskNumber: phone('Referral desk number').optional(),
    consultantLines: z.array(consultantLine).max(MAX_CONSULTANT_LINES, `At most ${MAX_CONSULTANT_LINES} direct lines.`).optional(),
    workingHours: z
      .object({
        days: z.array(z.number(DAY_MESSAGE).int(DAY_MESSAGE).min(0, DAY_MESSAGE).max(6, DAY_MESSAGE)).min(1, 'Choose at least one working day.').max(7, 'Each day only once.'),
        from: time('Working hours from'),
        to: time('Working hours to'),
      })
      .strict()
      .optional(),
    holidays: z.array(holiday).max(MAX_HOLIDAYS, `At most ${MAX_HOLIDAYS} holidays.`).optional(),
    urgentCutoff: time('Urgent cut-off').optional(),
    urgentNextMorning: time('Urgent next morning').optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (!s || typeof s !== 'object') return;
    if (Array.isArray(s.centres)) {
      noRepeats(s.centres, 'key', 'centres', 'Each centre needs its own key.', ctx);
      if (s.centres.length && !s.centres.some((c) => c?.active !== false)) ctx.addIssue({ code: 'custom', path: ['centres'], message: 'Keep at least one centre in use.' });
    }
    if (Array.isArray(s.consultantLines)) noRepeats(s.consultantLines, 'userId', 'consultantLines', 'This consultant already has a direct line.', ctx);
    if (Array.isArray(s.holidays)) noRepeats(s.holidays, 'on', 'holidays', 'This day is already a holiday.', ctx);
    const wh = s.workingHours;
    if (Array.isArray(wh?.days) && new Set(wh.days).size !== wh.days.length) ctx.addIssue({ code: 'custom', path: ['workingHours', 'days'], message: 'Each day only once.' });
    // 'HH:MM' with two digits each: compared as text, an earlier time is smaller
    if (typeof wh?.from === 'string' && typeof wh?.to === 'string' && TIME.test(wh.from) && TIME.test(wh.to) && wh.from >= wh.to) {
      ctx.addIssue({ code: 'custom', path: ['workingHours', 'to'], message: 'The working day must end after it starts.' });
    }
  }, ALWAYS)
  // Stored in a fixed order: working days Sunday→Saturday, holidays by date
  .transform((s) => ({
    ...s,
    ...(s.workingHours ? { workingHours: { ...s.workingHours, days: [...s.workingHours.days].sort((a, b) => a - b) } } : {}),
    ...(s.holidays ? { holidays: [...s.holidays].sort((a, b) => a.on.localeCompare(b.on)) } : {}),
  }));
