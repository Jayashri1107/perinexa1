import { z } from 'zod';
import { objectId } from '../../core/validate.js';
import { isoDate } from '../appointments/appointment.validation.js';
import { FETAL_MOVEMENTS, OEDEMA_GRADES, PRESENTATIONS, RX_DURATION_UNITS, RX_FORMS, RX_FREQUENCIES, RX_ROUTES, RX_TIMINGS, URINE_GRADES } from './rxCodes.js';

const num = (min, max, label) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number({ error: `${label}: a number` }).min(min, `${label}: at least ${min}`).max(max, `${label}: at most ${max}`).nullable());
const text = (max) => z.string().trim().max(max, 'This is too long').default('');

export const patientParams = z.object({ patientId: objectId });
export const visitParams = z.object({ patientId: objectId, visitId: objectId });

export const newVisitBody = z.object({ clientRequestId: z.string().trim().min(8).max(64) });

const rev = z.number().int().min(0);

export const vitalsBody = z.object({
  rev,
  weightKg: num(0.3, 300, 'Weight'),
  heightCm: num(20, 250, 'Height'),
  bpSystolic: num(50, 260, 'BP upper'),
  bpDiastolic: num(30, 160, 'BP lower'),
  pulse: num(30, 220, 'Pulse'),
  temperatureF: num(90, 110, 'Temperature'),
  spo2: num(50, 100, 'SpO₂'),
  hb: num(2, 25, 'Hb'),
  urineAlbumin: z.enum(URINE_GRADES).default(''),
  urineSugar: z.enum(URINE_GRADES).default(''),
});

export const detailsBody = z.object({
  rev,
  complaints: text(1000),
  fundalHeightCm: num(5, 50, 'Fundal height'),
  fetalHeartRate: num(60, 220, 'Fetal heart rate'),
  presentation: z.enum(PRESENTATIONS).default(''),
  fetalMovements: z.enum(FETAL_MOVEMENTS).default(''),
  oedema: z.enum(OEDEMA_GRADES).default(''),
  examination: text(2000),
  diagnosis: text(500),
  investigations: text(1000),
  advice: text(2000),
  privateNote: text(2000),
  nextVisitOn: z.union([isoDate('Next visit'), z.literal(''), z.null()]).default(null),
  nextVisitNote: text(200),
});

export const rxItem = z.object({
  drug: z.string().trim().min(2, 'Name the medicine').max(120),
  form: z.enum(RX_FORMS).default('tab'),
  strength: text(40),
  dose: text(40),
  frequency: z.enum(RX_FREQUENCIES, { error: 'Choose how often' }),
  frequencyText: text(60),
  timing: z.enum(RX_TIMINGS).default(''),
  route: z.enum(RX_ROUTES).default(''),
  durationValue: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().int().min(1).max(365).nullable()),
  durationUnit: z.enum(RX_DURATION_UNITS).default(''),
  instructions: text(200),
});

export const prescriptionBody = z.object({
  rev,
  items: z.array(rxItem).max(40, 'At most 40 medicines'),
  notes: text(1000),
  // reasons for going ahead despite an Avoid or Allergy warning: { warning key: reason }
  reasons: z.record(z.string(), z.string().trim().max(300)).default({}),
});

export const cancelBody = z.object({ reason: z.string().trim().min(3, 'Say why (at least 3 characters)').max(300) });
export const additionBody = z.object({ text: z.string().trim().min(2, 'Write the correction or addition').max(2000) });
