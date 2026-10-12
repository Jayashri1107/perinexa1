// What the website may send to change a care plan. Every schema is strict: an unknown field (for example
// "fetalSex") is refused, and all free text is checked for words about the baby's sex (PCPNDT Act).
// Checks that need the plan itself (dates against the EDD, the item's kind …) are in plansService.js.

import { z } from 'zod';
import { NOT_NEEDED_REASONS, USER_CLOSE_REASONS } from '../models/CarePlan.js';
import { ITEM_KINDS } from '../models/CarePlanTemplate.js';
import { safeText } from '../utils/pcpndt.js';
import { objectId, requiredDateOnly } from '../utils/validate.js';

export const REASON_MESSAGE = 'Please say why (at least 5 characters).';
const rev = z.number('The item version is missing – please reload the page').int().min(0);
const reason = (label = 'Reason') => safeText(label, 300).default('');
const hash = z.string().regex(/^[a-f0-9]{64}$/, 'Please reload the page and review the changes again');
// A reason that must be given in some cases: at least 5 characters when present.
const needsReason = (value) => value.trim().length >= 5;

const item = (action, fields = {}) => z.object({ action: z.literal(action), rev, ...fields }).strict();

// When an item a doctor adds (or edits) is due: a window in weeks, or dates.
const customTiming = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('weeks'),
      fromWeek: z.number('Enter a week').int('Weeks must be whole numbers').min(0).max(900),
      toWeek: z.number('Enter a week').int('Weeks must be whole numbers').min(0).max(900),
    })
    .strict()
    .refine((t) => t.toWeek >= t.fromWeek, { path: ['toWeek'], message: '"To" week must not be before "from" week' }),
  z.object({ type: z.literal('date'), dueFrom: requiredDateOnly('Due from'), dueBy: z.union([requiredDateOnly('Due by'), z.null()]).default(null) }).strict(),
]);

/** PATCH /items/:itemId – one action on one item (§7.2). */
export const itemActionSchema = z.discriminatedUnion('action', [
  item('done', {
    on: requiredDateOnly('Date'),
    elsewhere: z.boolean().default(false),
    result: safeText('Result', 500).default(''),
    note: safeText('Note', 1000).default(''),
  }),
  item('reopen', { reason: reason() }),
  item('not_needed', { reasonCode: z.enum(NOT_NEEDED_REASONS, 'Please choose a reason'), reason: reason() }).superRefine((b, ctx) => {
    if (['not_indicated', 'other'].includes(b.reasonCode) && !needsReason(b.reason)) ctx.addIssue({ code: 'custom', path: ['reason'], message: REASON_MESSAGE });
  }),
  item('move', { dueFrom: requiredDateOnly('Due from'), dueBy: z.union([requiredDateOnly('Due by'), z.null()]).default(null), reason: reason() }),
  item('reset_date'),
  item('include', { reason: reason().refine(needsReason, REASON_MESSAGE) }), // a missing reason gets the same plain message
  item('remove_include'),
  item('keep'),
  item('note', { text: safeText('Note', 1000) }),
  // An item a doctor added to this plan, corrected: the whole new content as the dialog shows it (an empty note
  // removes the note). Only items added for this patient, and not once done (plansService).
  item('edit', {
    name: safeText('Name', 200).min(1, 'Please give the item a name'),
    patientText: safeText('Text for the patient', 300).default(''),
    note: safeText('Note', 1000).default(''),
    timing: customTiming,
  }),
]);

/** POST /items – an item a doctor adds to this patient's plan (§7.3). */
export const customItemSchema = z
  .object({
    clientRequestId: z.uuid('Please reload the page and try again'),
    kind: z.enum(ITEM_KINDS, 'Choose what kind of item this is'),
    name: safeText('Name', 200).min(1, 'Please give the item a name'),
    patientText: safeText('Text for the patient', 300).default(''),
    note: safeText('Note', 1000).default(''),
    reason: reason(),
    timing: customTiming,
  })
  .strict();

/** PATCH / – the booking date. previousBookedOn: the date the person saw (a change meanwhile → 409). */
export const bookingDateSchema = z.object({ bookedOn: requiredDateOnly('Booking date'), previousBookedOn: requiredDateOnly('Previous booking date') }).strict();

/** PUT /template – switch to, or update to, a protocol after reviewing the preview. */
export const templateChangeSchema = z.object({ templateId: objectId, fromItemsHash: hash, toItemsHash: hash }).strict();

/** POST /edd-decision – after the EDD moved by more than 8 weeks. */
export const eddDecisionSchema = z
  .object({ decision: z.enum(['same_pregnancy', 'new_pregnancy'], 'Please choose same or new pregnancy'), toEdd: requiredDateOnly('New EDD') })
  .strict();

/** POST /close */
export const closeSchema = z
  .object({ reason: z.enum(USER_CLOSE_REASONS, 'Please choose a reason'), note: safeText('Note', 500).default('') })
  .strict()
  .superRefine((b, ctx) => {
    if (b.reason === 'other' && !needsReason(b.note)) ctx.addIssue({ code: 'custom', path: ['note'], message: REASON_MESSAGE });
  });

/** POST /reopen */
export const reopenSchema = z.object({ planId: objectId }).strict();

/** GET / – ?planId= opens one of this patient's earlier plans (read-only). */
export const viewQuerySchema = z.object({ planId: objectId.optional() }).strict();

/** GET /template-preview?templateId= */
export const previewQuerySchema = z.object({ templateId: objectId }).strict();

/** The item id in /items/:itemId. */
export const itemParamsSchema = z.object({ itemId: objectId });

/**
 * POST /printed – a patient copy or a staff copy was printed (Feature 9). Only the kind of copy is sent:
 * what was chosen and any advice typed for the patient stay in the browser (printed, never stored).
 * planId: an earlier plan opened with ?planId= (the current plan when missing).
 * language: the patient copy in English only ('en', the default), or with Marathi ('mr') or Hindi ('hi') next to the
 * English. The staff copy is always in English.
 */
export const PRINT_LANGUAGES = ['en', 'mr', 'hi'];
export const printedSchema = z
  .object({
    copy: z.enum(['patient', 'staff'], 'Please choose the copy to print'),
    planId: objectId.optional(),
    language: z.enum(PRINT_LANGUAGES, 'Choose English, Marathi or Hindi').optional(),
  })
  .strict()
  .refine((b) => b.copy === 'patient' || !b.language || b.language === 'en', { message: 'The staff copy is printed in English only.', path: ['language'] });
