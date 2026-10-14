// Inpatient documents (Version 2): what each kind holds, what the website may send, and what must be filled in
// before it can be signed. Every schema is strict (an unknown field is refused). Free text is checked for words
// about the baby's sex (PCPNDT Act) – except in the delivery note, written after the birth (the babies' sex is
// recorded there, as on a newborn's own record).
//
// Delivery and newborn outcomes as fixed fields (5 Oct 2026), so that they can be counted: for each baby the kind of
// stillbirth (fresh or macerated), breastfeeding started within one hour, and admission to the NICU or SNCU; for
// the mother a "postpartum haemorrhage" answer, decided by the doctor. Every one is optional: '' means "not
// recorded", which is what every delivery note from before these fields has. A note signed before this date is
// never changed.

import { z } from 'zod';
import { safeText } from '../utils/pcpndt.js';
import { visitSchemas } from '../visits/visitSchemas.js';

/** The kinds, in the order of a stay. */
export const DOC_KINDS = ['admission', 'round', 'delivery', 'operation', 'discharge'];
/** Who signs: admission and round notes – the doctor or RMO who writes them; the others – a doctor (USE_CASE §3). */
export const SIGNED_BY = { admission: ['doctor', 'rmo'], round: ['doctor', 'rmo'], delivery: ['doctor'], operation: ['doctor'], discharge: ['doctor'] };
/** At most one of these per admission (not counting those entered in error). */
export const ONE_PER_ADMISSION = ['admission', 'discharge'];

export const DELIVERY_MODES = ['normal', 'vacuum', 'forceps', 'lscs', 'other'];
export const LABOUR_ONSETS = ['spontaneous', 'induced', 'not_in_labour'];
export const PERINEUM = ['intact', 'episiotomy', 'tear_1', 'tear_2', 'tear_3', 'tear_4'];
export const BABY_SEX = ['female', 'male', 'indeterminate'];
export const BABY_OUTCOMES = ['live', 'stillbirth'];
// A stillbirth: fresh (died during labour) or macerated (died before labour).
export const STILLBIRTH_TYPES = ['fresh', 'macerated'];
// Breastfeeding started within one hour of birth: yes, no, or not applicable (e.g. the baby went to the NICU at once).
export const BREASTFED_WITHIN_HOUR = ['yes', 'no', 'not_applicable'];
export const YES_NO = ['yes', 'no'];

// Postpartum haemorrhage – the SUGGESTION only (the doctor always decides; nothing is ever ticked by itself).
// DRAFT clinical content, to be checked by the owner. Source: WHO recommendations for the prevention and treatment
// of postpartum haemorrhage (2012) – a blood loss of 500 mL or more within 24 hours after birth; after a caesarean
// section 1000 mL or more, the older ACOG definition. A vaginal birth (normal, vacuum or forceps) is held to 500 mL, a
// caesarean to 1000 mL; for "other" (it may have been an operation) nothing is suggested. The website shows the same
// numbers and source beside the answer (client/src/pages/inpatient/deliveryOutcomes.js – a test keeps them the same).
export const PPH_ML_VAGINAL = 500;
export const PPH_ML_CAESAREAN = 1000;
export const PPH_SOURCE = 'WHO recommendations on postpartum haemorrhage (2012): 500 mL or more within 24 hours after birth; after a caesarean, 1000 mL or more (the older ACOG definition, Practice Bulletin 76, 2006)';
const VAGINAL_MODES = ['normal', 'vacuum', 'forceps'];
/** The blood loss from which postpartum haemorrhage is suggested for this mode of delivery (null: no mode chosen yet, or "other"). */
export const pphThresholdMl = (mode) => (mode === 'lscs' ? PPH_ML_CAESAREAN : VAGINAL_MODES.includes(mode) ? PPH_ML_VAGINAL : null);
/**
 * Does the blood loss recorded suggest postpartum haemorrhage for this mode of delivery? true, false, or null when
 * it cannot be said (no mode, or no blood loss recorded). A suggestion only: it never fills in the answer.
 */
export function pphSuggested(mode, bloodLossMl) {
  const threshold = pphThresholdMl(mode);
  if (threshold == null || bloodLossMl == null || bloodLossMl === '' || !Number.isFinite(Number(bloodLossMl))) return null;
  return Number(bloodLossMl) >= threshold;
}

// A baby's outcome fields that do not fit the outcome are dropped (never stored): the kind of stillbirth only for a
// stillbirth; breastfeeding within the hour and admission to the NICU or SNCU only for a baby born alive (or while
// the outcome is not chosen yet).
function tidyBaby(b) {
  const out = { ...b };
  if (out.outcome !== 'stillbirth') out.stillbirthType = '';
  if (out.outcome === 'stillbirth') Object.assign(out, { breastfedWithinHour: '', nicu: '' });
  return out;
}
export const ANAESTHESIA = ['spinal', 'epidural', 'general', 'local', 'other'];
// handover: a note for the next shift; escalation: the consultant (or the doctor on call) was told – whom, and why
// (owner, 13 Oct 2026). Both stay on the stay's chart with who and when, like every entry.
export const NURSING_KINDS = ['vitals', 'medicine', 'note', 'handover', 'escalation'];

const emptyToNull = (v) => (v === '' || v === undefined ? null : v);
const num = (label, min, max) =>
  z
    .preprocess(emptyToNull, z.union([z.null(), z.coerce.number(`${label} must be a number`).min(min, `${label} looks too low – please check`).max(max, `${label} looks too high – please check`)]))
    .default(null);
const when = (label) => z.preprocess(emptyToNull, z.union([z.null(), z.iso.datetime(`${label}: please enter a valid date and time`)])).default(null);
const day = (label) => z.preprocess(emptyToNull, z.union([z.null(), z.iso.date(`${label}: please enter a valid date`)])).default(null);
const pick = (values) => z.enum(['', ...values]).default('');

export const vitalsSchema = z
  .object({
    bpSystolic: num('Blood pressure (upper number)', 50, 260),
    bpDiastolic: num('Blood pressure (lower number)', 30, 160),
    pulse: num('Pulse', 30, 220),
    temperatureF: num('Temperature', 90, 110),
    spo2: num('SpO2', 50, 100),
  })
  .strict()
  .default({});

/** The content schema of one kind. pcpndt: check free text for words about the baby's sex. */
export function contentSchema(kind, { pcpndt = true } = {}) {
  const t = (label, max = 2000) => (pcpndt && kind !== 'delivery' ? safeText(label, max) : z.string().trim().max(max, `${label} is too long`)).default('');
  switch (kind) {
    case 'admission':
      return z
        .object({
          reason: t('Reason for admission', 500),
          history: t('History'),
          examination: t('Examination'),
          vitals: vitalsSchema,
          provisionalDiagnosis: t('Provisional diagnosis', 500),
          plan: t('Plan and orders'),
        })
        .strict();
    case 'round':
      return z
        .object({
          at: when('Date and time of the round'),
          complaints: t('Complaints'),
          vitals: vitalsSchema,
          examination: t('Examination'),
          assessment: t('Assessment', 1000),
          plan: t('Plan and orders'),
        })
        .strict();
    case 'delivery':
      return z
        .object({
          deliveredAt: when('Date and time of delivery'),
          mode: pick(DELIVERY_MODES),
          indication: t('Indication', 500),
          gestationWeeks: num('Weeks of pregnancy', 20, 45),
          labourOnset: pick(LABOUR_ONSETS),
          perineum: pick(PERINEUM),
          placenta: t('Placenta', 500),
          bloodLossMl: num('Blood loss', 0, 10000),
          // Postpartum haemorrhage: yes, no, or '' = not recorded. Decided by the doctor (pphSuggested only suggests).
          pph: pick(YES_NO),
          motherCondition: t("Mother's condition", 1000),
          babies: z
            .array(
              z
                .object({
                  sex: pick(BABY_SEX),
                  weightGrams: num('Birth weight', 200, 7000),
                  apgar1: num('Apgar at 1 minute', 0, 10),
                  apgar5: num('Apgar at 5 minutes', 0, 10),
                  outcome: pick(BABY_OUTCOMES),
                  stillbirthType: pick(STILLBIRTH_TYPES),
                  breastfedWithinHour: pick(BREASTFED_WITHIN_HOUR),
                  nicu: pick(YES_NO), // admitted to the NICU or SNCU
                  notes: t('Notes on the baby', 500),
                })
                .strict()
                .transform(tidyBaby),
            )
            .max(4, 'At most 4 babies')
            .default([]),
          conductedBy: t('Conducted by', 200),
          notes: t('Notes', 2000),
        })
        .strict();
    case 'operation':
      return z
        .object({
          performedAt: when('Date and time of the operation'),
          procedure: t('Operation', 300),
          indication: t('Indication', 500),
          surgeon: t('Surgeon', 150),
          assistant: t('Assistant', 150),
          anaesthetist: t('Anaesthetist', 150),
          anaesthesia: pick(ANAESTHESIA),
          findings: t('Findings'),
          steps: t('Procedure details', 4000),
          bloodLossMl: num('Blood loss', 0, 10000),
          complications: t('Complications', 1000),
          specimens: t('Specimens sent', 500),
          postOpOrders: t('Post-operative orders'),
        })
        .strict();
    case 'discharge':
      return z
        .object({
          dischargedAt: when('Date and time of discharge'),
          finalDiagnosis: t('Final diagnosis', 1000),
          course: t('Course in hospital', 4000),
          procedures: t('Procedures and operations', 1000),
          conditionAtDischarge: t('Condition at discharge', 1000),
          medicines: visitSchemas({ pcpndt }).prescription.shape.items.default([]),
          advice: t('Advice', 2000),
          followUpOn: day('Follow-up date'),
          followUpNote: t('Follow-up note', 200),
        })
        .strict();
    default:
      throw new Error(`Unknown document kind: ${kind}`);
  }
}

/** What must be filled in before signing: { 'content.<field>': message } (empty when it can be signed). */
export function missingToSign(kind, c = {}) {
  const out = {};
  const need = (field, message) => {
    const v = c[field];
    if (v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length)) out[`content.${field}`] = message;
  };
  if (kind === 'admission') need('reason', 'Write the reason for admission');
  if (kind === 'round') {
    need('at', 'Enter the date and time of the round');
    if (!c.assessment?.trim() && !c.plan?.trim()) out['content.assessment'] = 'Write the assessment or the plan';
  }
  if (kind === 'delivery') {
    need('deliveredAt', 'Enter the date and time of delivery');
    need('mode', 'Choose the mode of delivery');
    need('babies', 'Add the baby (or babies)');
    (c.babies ?? []).forEach((b, i) => {
      if (!b.outcome) out[`content.babies.${i}.outcome`] = 'Choose live birth or stillbirth';
    });
    if (['lscs', 'vacuum', 'forceps'].includes(c.mode)) need('indication', 'Write the indication');
  }
  if (kind === 'operation') {
    need('performedAt', 'Enter the date and time of the operation');
    need('procedure', 'Write the operation');
  }
  if (kind === 'discharge') {
    need('dischargedAt', 'Enter the date and time of discharge');
    need('finalDiagnosis', 'Write the final diagnosis');
  }
  return out;
}

/** The nursing chart: an entry of vital signs, a medicine given, or a note. */
export function nursingSchema({ pcpndt = true } = {}) {
  const t = (label, max) => (pcpndt ? safeText(label, max) : z.string().trim().max(max, `${label} is too long`)).default('');
  return z
    .object({
      clientRequestId: z.uuid('Please reload the page and try again'),
      kind: z.enum(NURSING_KINDS),
      at: when('Time'),
      vitals: vitalsSchema,
      medicine: z
        .object({ drug: t('Medicine', 120), dose: t('Dose', 60), route: t('Route', 40) })
        .strict()
        .default({}),
      note: t('Note', 1000),
      escalatedTo: t('Told whom', 100),
    })
    .strict()
    .superRefine((e, ctx) => {
      const v = e.vitals;
      if (e.kind === 'vitals' && [v.bpSystolic, v.bpDiastolic, v.pulse, v.temperatureF, v.spo2].every((x) => x == null)) {
        ctx.addIssue({ code: 'custom', path: ['vitals'], message: 'Enter at least one vital sign' });
      }
      if ((v.bpSystolic == null) !== (v.bpDiastolic == null)) ctx.addIssue({ code: 'custom', path: ['vitals', 'bpSystolic'], message: 'Enter both blood pressure numbers' });
      if (e.kind === 'medicine' && !e.medicine.drug) ctx.addIssue({ code: 'custom', path: ['medicine', 'drug'], message: 'Enter the medicine given' });
      if (e.kind === 'note' && !e.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Write the note' });
      if (e.kind === 'handover' && !e.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Write what the next shift needs to know' });
      if (e.kind === 'escalation' && !e.escalatedTo) ctx.addIssue({ code: 'custom', path: ['escalatedTo'], message: 'Write whom you told' });
      if (e.kind === 'escalation' && !e.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Write why, and what was decided' });
    });
}
