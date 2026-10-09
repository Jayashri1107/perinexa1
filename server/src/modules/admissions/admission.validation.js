// What the browser may send for inpatients, with the fields of each document (Perinexa's inpatient/docSchemas.js and
// client pages/inpatient/docFields.js).
import { z } from 'zod';
import { objectId } from '../../core/validate.js';
import { isoDate } from '../appointments/appointment.validation.js';
import { rxItem } from '../visits/visit.validation.js';
import { DOC_KINDS } from './admission.model.js';

const text = (max = 2000) => z.string().trim().max(max, 'This is too long').default('');
const when = z.coerce.date({ error: 'Choose the date and time' }).refine((d) => d <= new Date(Date.now() + 5 * 60000), 'This time is in the future');
const optNum = (min, max) => z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().min(min).max(max).nullable());
const choice = (values) => z.enum(['', ...values]).default('');

const vitals = z
  .object({ bpSystolic: optNum(50, 260), bpDiastolic: optNum(30, 160), pulse: optNum(30, 220), temperatureF: optNum(90, 110), spo2: optNum(50, 100), respRate: optNum(4, 80), painScore: optNum(0, 10), glucoseMgDl: optNum(20, 800) })
  .default({ bpSystolic: null, bpDiastolic: null, pulse: null, temperatureF: null, spo2: null, respRate: null, painScore: null, glucoseMgDl: null });

// A baby in the delivery note (written after the birth; its sex only here). Fields that do not fit the outcome are
// dropped: the kind of stillbirth only for a stillbirth; breastfeeding and NICU only for a baby born alive.
const baby = z
  .object({
    sex: choice(['female', 'male', 'indeterminate']),
    weightGrams: optNum(200, 7000),
    apgar1: optNum(0, 10),
    apgar5: optNum(0, 10),
    outcome: z.enum(['live', 'stillbirth'], { error: 'Choose live birth or stillbirth' }),
    stillbirthType: choice(['fresh', 'macerated']),
    breastfedWithinHour: choice(['yes', 'no', 'not_applicable']),
    nicu: choice(['yes', 'no']),
    notes: text(500),
  })
  .transform((b) => (b.outcome === 'stillbirth' ? { ...b, breastfedWithinHour: '', nicu: '' } : { ...b, stillbirthType: '' }));

const required = (what, max) => z.string({ error: `Write ${what}` }).trim().min(2, `Write ${what}`).max(max, 'This is too long');
export const ADMISSION_TYPES = ['emergency', 'planned', 'referral', 'labour', 'transfer'];
// A medicine on the discharge summary: every column filled in (name, strength or dose, how often, route, how long).
export const dischargeMedicine = rxItem
  .extend({
    dose: z.string({ error: 'Give the dose' }).trim().min(1, 'Give the dose, e.g. 500 mg or 1 tab').max(40),
    route: z.enum(['oral', 'vaginal', 'rectal', 'im', 'iv', 'sc', 'sublingual', 'local'], { error: 'Choose the route' }),
    durationValue: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number({ error: 'Give how long' }).int().min(1, 'Give how long').max(365)),
    durationUnit: z.enum(['days', 'weeks', 'months', 'till_delivery', 'continue'], { error: 'Choose days, weeks or months' }),
  });

export const DOC_CONTENT = {
  admission: z.object({ reason: z.string().trim().min(2, 'Give the reason for admission').max(500), history: text(), vitals, examination: text(), provisionalDiagnosis: text(500), plan: text() }),
  round: z.object({ at: when, complaints: text(), vitals, examination: text(), assessment: text(1000), plan: text() }),
  delivery: z.object({
    deliveredAt: when,
    mode: z.enum(['normal', 'vacuum', 'forceps', 'lscs', 'other'], { error: 'Choose the mode of delivery' }),
    indication: text(500),
    gestationWeeks: optNum(20, 45),
    labourOnset: choice(['spontaneous', 'induced', 'not_in_labour']),
    perineum: choice(['intact', 'episiotomy', 'tear_1', 'tear_2', 'tear_3', 'tear_4']),
    placenta: text(500),
    bloodLossMl: optNum(0, 10000),
    pph: choice(['yes', 'no']),
    babies: z.array(baby).min(1, 'Add the baby').max(6),
    motherCondition: text(1000),
    conductedBy: text(200),
    notes: text(),
  }),
  operation: z.object({
    performedAt: when,
    procedure: z.string().trim().min(2, 'Name the operation').max(300),
    indication: text(500),
    surgeon: text(150),
    assistant: text(150),
    anaesthetist: text(150),
    anaesthesia: choice(['spinal', 'epidural', 'general', 'local', 'other']),
    findings: text(),
    steps: text(4000),
    bloodLossMl: optNum(0, 10000),
    complications: text(1000),
    specimens: text(500),
    postOpOrders: text(),
  }),
  // The discharge summary (owner, 8 Oct 2026): every field is required when it is marked ready for review or
  // finalized; a draft may be incomplete. Write "None" or "Not applicable" where nothing applies.
  discharge: z.object({
    dischargedAt: when,
    admissionType: z.enum(ADMISSION_TYPES, { error: 'Choose the type of admission' }),
    department: required('the department', 100),
    chiefComplaint: required('the chief complaint', 1000),
    admissionDiagnosis: required('the diagnosis at admission', 1000),
    finalDiagnosis: required('the final diagnosis', 1000),
    procedures: required('the procedures or surgery (or None)', 1000),
    course: required('the course in hospital', 4000),
    investigations: required('the investigation summary', 4000),
    importantFindings: required('the important findings (or None)', 2000),
    conditionAtDischarge: required('the condition at discharge', 1000),
    medicines: z.array(dischargeMedicine).min(1, 'Add at least one medicine (or the medicine “None”)').max(40),
    diet: required('the diet advice', 1000),
    activity: required('the activity restrictions (or None)', 1000),
    woundCare: required('the wound care (or Not applicable)', 1000),
    warningSigns: required('the warning signs – when to come back', 1000),
    otherInstructions: required('other instructions (or None)', 2000),
    followUpOn: isoDate('Follow-up date'),
    followUpDoctorId: objectId,
    followUpDepartment: required('the follow-up department', 100),
    followUpInstructions: required('the follow-up instructions', 500),
    followUpDoctorName: z.string().max(100).optional(), // filled in by the server from followUpDoctorId
  }),
};

export const patientParams = z.object({ patientId: objectId });
export const admissionParams = z.object({ admissionId: objectId });
export const docParams = z.object({ admissionId: objectId, docId: objectId });
export const entryParams = z.object({ admissionId: objectId, entryId: objectId });

const requestId = z.string().trim().min(8).max(64);

export const admitBody = z.object({
  patientId: objectId,
  admittedAt: when,
  wardId: objectId,
  bed: z.string('Choose a free bed').trim().min(1, 'Choose a free bed').max(30),
  reason: text(300),
  doctorId: z.union([objectId, z.literal(''), z.null()]).optional().transform((v) => v || null), // reception chooses her doctor
  clientRequestId: requestId,
});

export const bedBody = z.object({ wardId: objectId, bed: z.string('Choose a free bed').trim().min(1, 'Choose a free bed').max(30) });

export const newDocBody = z.object({ kind: z.enum(DOC_KINDS), clientRequestId: requestId });
export const saveDocBody = z.object({ rev: z.number().int().min(0), content: z.unknown() });
export const reasonBody = z.object({ reason: z.string().trim().min(3, 'Say why (at least 3 characters)').max(300) });
export const additionBody = z.object({ text: z.string().trim().min(2).max(2000) });

export const nursingBody = z
  .object({
    kind: z.enum(['vitals', 'medicine', 'note']), // the others through wardCare (they need an order)
    at: when,
    vitals: vitals.optional(),
    medicine: z.object({ drug: z.string().trim().min(2, 'Name the medicine').max(120), dose: text(60), route: text(30) }).optional(),
    note: text(1000),
    clientRequestId: requestId,
  })
  .refine((e) => e.kind !== 'vitals' || Object.values(e.vitals ?? {}).some((v) => v != null), { path: ['vitals'], message: 'Enter at least one vital sign' })
  .refine((e) => e.kind !== 'medicine' || e.medicine, { path: ['medicine.drug'], message: 'Name the medicine' })
  .refine((e) => e.kind !== 'note' || e.note.length >= 2, { path: ['note'], message: 'Write the note' });

export const wardIssueBody = z.object({
  admissionId: objectId,
  doctorName: z.string().trim().max(120).default(''),
  lines: z.array(z.object({ medicineId: objectId, qty: z.coerce.number().int().min(1).max(10000) })).min(1, 'Add at least one medicine').max(100),
});
