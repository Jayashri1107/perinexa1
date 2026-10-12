// What the website may send about visits and prescriptions (Feature 8). Every schema is strict: an unknown
// field (for example "fetalSex") is refused. Free text is checked for words about the baby's sex (PCPNDT Act)
// for every patient except newborns, whose sex is recorded after birth: build the schemas with
// visitSchemas({ pcpndt }). Checks that need the visit or the patient (dates, who may change what) are in
// routes/visits.js.

import { z } from 'zod';
import { safeText } from '../utils/pcpndt.js';
import { dateOnly, objectId, requiredDateOnly } from '../utils/validate.js';
import {
  FETAL_MOVEMENTS,
  OEDEMA_GRADES,
  PRESENTATIONS,
  RX_DURATION_UNITS,
  RX_FORMS,
  RX_FREQUENCIES,
  RX_ROUTES,
  RX_TIMINGS,
  URINE_GRADES,
} from './rxCodes.js';

const emptyToNull = (v) => (v === '' || v === undefined ? null : v);
const rev = z.number('The version you edited is missing – please reload the page').int().min(0);
/** A measurement: empty, or a number in a sensible range. */
const measure = (label, min, max) =>
  z
    .preprocess(
      emptyToNull,
      z.union([z.null(), z.coerce.number(`${label} must be a number`).min(min, `${label} looks too low – please check`).max(max, `${label} looks too high – please check`)]),
    )
    .default(null);
const choice = (values, message) => z.enum(values, message).default('');

export const COUNTED_UNITS = ['days', 'weeks', 'months'];
/** What a visit prints as: the prescription, or the visit summary (the visit's details without medicines). */
export const PRINT_COPIES = ['prescription', 'summary'];
/** On paper, or as a PDF file (made in the browser, to send to the patient or to print elsewhere) – also saved to
 * attach on WhatsApp, which the preview opens with the patient's number. */
export const PRINT_WAYS = ['paper', 'pdf', 'whatsapp'];

export function visitSchemas({ pcpndt = true } = {}) {
  const words = (label, max) => (pcpndt ? safeText(label, max) : z.string().trim().max(max, `${label} is too long`));
  const optionalWords = (label, max) => words(label, max).default('');

  const vitals = z
    .object({
      rev,
      weightKg: measure('Weight', 0.3, 300),
      bpSystolic: measure('Blood pressure (upper number)', 50, 260),
      bpDiastolic: measure('Blood pressure (lower number)', 30, 160),
      pulse: measure('Pulse', 30, 220),
      temperatureF: measure('Temperature', 90, 110),
      spo2: measure('SpO2', 50, 100),
      hb: measure('Haemoglobin', 2, 25),
      urineAlbumin: choice(URINE_GRADES, 'Choose the urine albumin'),
      urineSugar: choice(URINE_GRADES, 'Choose the urine sugar'),
    })
    .strict()
    .superRefine((v, ctx) => {
      if ((v.bpSystolic == null) !== (v.bpDiastolic == null)) {
        ctx.addIssue({ code: 'custom', path: [v.bpSystolic == null ? 'bpSystolic' : 'bpDiastolic'], message: 'Enter both numbers of the blood pressure' });
      } else if (v.bpSystolic != null && v.bpDiastolic >= v.bpSystolic) {
        ctx.addIssue({ code: 'custom', path: ['bpDiastolic'], message: 'The lower number must be below the upper number' });
      }
    });

  const details = z
    .object({
      rev,
      complaints: optionalWords('Complaints', 1000),
      fundalHeightCm: measure('Fundal height', 5, 50),
      fetalHeartRate: measure('Fetal heart rate', 60, 220),
      presentation: choice(PRESENTATIONS, 'Choose the presentation'),
      fetalMovements: choice(FETAL_MOVEMENTS, 'Choose the fetal movements'),
      oedema: choice(OEDEMA_GRADES, 'Choose the oedema'),
      examination: optionalWords('Examination', 2000),
      diagnosis: optionalWords('Diagnosis', 500),
      investigations: optionalWords('Tests advised', 1000),
      advice: optionalWords('Advice', 2000),
      // Only when sent: someone who may not see the private note never blanks it by saving the rest.
      privateNote: words('Private note', 2000).optional(),
      nextVisitOn: z.preprocess(emptyToNull, dateOnly('Next visit')).default(null),
      nextVisitNote: optionalWords('Next visit note', 200),
    })
    .strict();

  const rxItem = z
    .object({
      drug: words('Medicine', 120).min(1, 'Enter the medicine'),
      form: z.enum(RX_FORMS, 'Choose the form').default('tab'),
      strength: optionalWords('Strength', 40),
      dose: optionalWords('Dose', 40),
      frequency: z.enum(RX_FREQUENCIES, 'Choose how often'),
      frequencyText: optionalWords('How often', 60),
      timing: choice(RX_TIMINGS, 'Choose when to take it'),
      route: choice(RX_ROUTES, 'Choose the route'),
      durationValue: z
        .preprocess(emptyToNull, z.union([z.null(), z.coerce.number('Enter a number').int('Whole numbers only').min(1, 'At least 1').max(365, 'At most 365')]))
        .default(null),
      durationUnit: choice(RX_DURATION_UNITS, 'Choose how long'),
      instructions: optionalWords('Instructions', 200),
    })
    .strict()
    .superRefine((it, ctx) => {
      if (it.frequency === 'custom' && !it.frequencyText.trim()) ctx.addIssue({ code: 'custom', path: ['frequencyText'], message: 'Write how often' });
      const counted = COUNTED_UNITS.includes(it.durationUnit);
      if (counted && it.durationValue == null) ctx.addIssue({ code: 'custom', path: ['durationValue'], message: 'Enter how many' });
      if (!counted && it.durationValue != null) ctx.addIssue({ code: 'custom', path: ['durationUnit'], message: 'Choose days, weeks or months' });
    });

  return {
    /** One medicine (also used by the ready-made prescription sets). */
    item: rxItem,
    /** Free text of this kind (checked for words about the baby's sex when pcpndt is set). */
    words,
    /** POST /visits – a new visit (today unless a date is given). */
    create: z.object({ clientRequestId: z.uuid('Please reload the page and try again'), visitOn: requiredDateOnly('Visit date').optional() }).strict(),
    /** PATCH /visits/:visitId – vitals and/or details, and care-plan items ticked at this visit. */
    patch: z
      .object({
        vitals: vitals.optional(),
        details: details.optional(),
        doneItems: z.array(z.object({ id: objectId, rev }).strict()).max(40).default([]),
      })
      .strict()
      .refine((b) => b.vitals || b.details || b.doneItems.length, 'Nothing to save'),
    /** PUT /visits/:visitId/prescription – the whole prescription. */
    prescription: z
      .object({
        rev,
        items: z.array(rxItem).max(40, 'A prescription can have at most 40 medicines'),
        notes: optionalWords('Notes', 1000),
        // Why the doctor went ahead despite an Avoid or Allergy warning (one per warning)
        warningReasons: z
          .array(
            z
              .object({
                key: z.string().trim().min(1).max(200),
                level: z.enum(['avoid', 'allergy']),
                title: z.string().trim().min(1).max(300),
                medicines: z.array(z.string().trim().max(120)).max(10).default([]),
                reason: words('Reason', 300).refine((t) => t.trim().length >= 3, 'Please write why you are going ahead.'),
              })
              .strict(),
          )
          .max(40)
          .default([]),
      })
      .strict(),
    /** POST /visits/:visitId/cancel – entered in error. */
    cancel: z.object({ reason: words('Reason', 300).refine((t) => t.trim().length >= 5, 'Please say why (at least 5 characters).') }).strict(),
    /** POST /visits/:visitId/sign – the version of each part the signer saw. */
    sign: z.object({ revs: z.object({ vitals: rev, details: rev, prescription: rev }).strict() }).strict(),
    /** POST /visits/:visitId/additions – a correction or addition to a signed visit. */
    addition: z.object({ text: words('Correction or addition', 2000).refine((t) => t.trim().length >= 3, 'Please write the correction or addition.') }).strict(),
    /** POST /visits/:visitId/printed – what was printed (the prescription, or the visit summary without medicines) and how. */
    printed: z
      .object({
        copy: z.enum(PRINT_COPIES, 'Choose the prescription or the visit summary').default('prescription'),
        as: z.enum(PRINT_WAYS, 'Choose paper or PDF').default('paper'),
      })
      .strict(),
  };
}

/** The visit id in /visits/:visitId. */
export const visitParams = z.object({ visitId: objectId });
