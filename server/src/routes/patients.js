import { Router } from 'express';
import { billRegistered } from '../billing/hooks.js';
import { z } from 'zod';
import { nextNumber } from '../models/Counter.js';
import { Membership, hasRole } from '../models/Membership.js';
import { PatientNote } from '../models/PatientNote.js';
import { addDays, hospitalDayStart, hospitalToday, sameDay, toHospitalDate } from '../careplans/dates.js';
import {
  ANTI_D,
  ECTOPIC_SITES,
  HISTOLOGY,
  LOSS_FINDINGS,
  LOSS_TYPE_KEYS,
  anotherLoss,
  MANAGEMENT,
  MANAGEMENT_FOR,
  MAX_WEEKS,
  MOLE_KINDS,
  NOT_PREGNANT_NOW,
  OUTCOME_LABELS,
  RETIRED_LOSS_MESSAGE,
  RETIRED_LOSS_TYPES,
  RETIRED_OUTCOME_MESSAGE,
  RETIRED_OUTCOMES,
  STORED_LOSS_TYPE_KEYS,
} from '../patients/abortionRules.js';
import { PCPNDT_MESSAGE, mentionsFetalSex, safeText } from '../utils/pcpndt.js';
import { OVERRIDE_LEVELS } from '../careplans/risk.js';
import { carePlanSummaryFor, currentPlanItems, planCtx, syncPlanSafely } from '../careplans/plansService.js';
import { redFlagsForPatient, redFlagsForPatients } from '../redflags/redFlagService.js';
import { applyCurrentRisk, ensureStandardTemplates, refreshDueRisks, riskTemplateFor } from '../careplans/templatesService.js';
import { BLOOD_GROUPS, BREASTFEEDING, CARE_TYPES, CONDITIONS, FEEDING_AT_DISCHARGE, NEWBORN_SEX, NICU_ADMITTED, ID_PROOF_TYPES, PAST_COMPLICATIONS, PAYER_TYPES, Patient, currentAge } from '../models/Patient.js';
import { PREGNANCY_FINDINGS, currentFindings, eddInUse, setFinding, setFindings, suggestedFindings } from '../patients/pregnancyFindings.js';
import { endLossFindings, setLossFindings } from '../patients/lossFindings.js';
import { NOT_DUPLICATE, ONLY_DUPLICATES, isDuplicate, refuseNewOnDuplicate } from '../patients/duplicateRules.js';
import { earlierRecordsFor, possibleMatches } from '../patients/duplicateService.js';
import { isClosed } from '../patients/deathRules.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { backfillLastVisits } from '../utils/lastVisit.js';
import { visitSummary } from '../visits/visitView.js';
import { Admission } from '../models/Admission.js';
import { admissionView } from '../inpatient/inpatientView.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { DELIVERY_MODES } from '../inpatient/docSchemas.js';
import { dateOnly, escapeRegex, requiredDateOnly, objectId, pageParams, paged, parse, sortParam, toMongoSort } from '../utils/validate.js';
import { findPatient, loadPatientForPlan } from '../utils/patientLookup.js';
import { carePlanRouter } from './carePlans.js';
import { patientConsentsRouter } from './patientConsents.js';
import { patientAiRouter } from './ai.js';
import { remindersRouter } from './reminders.js';
import { visitsRouter } from './visits.js';
import { admissionsRouter } from './admissions.js';
import { patientLabRouter } from './lab.js';
import { patientImagingRouter } from './imaging.js';
import { workDoneRouter } from './workDone.js';
import { patientReminderConsentRouter } from './reminderOutbox.js';
import { patientPortalAccessRouter } from './portal.js';
import { patientDuplicateRouter } from './patientDuplicates.js';
import { patientDeathRouter } from './patientDeath.js';
import { recordCopyRouter } from './recordCopy.js';
import { capitalizeName } from '../utils/personName.js';
import {
  CLINICAL_EDIT,
  IDENTITY_EDIT,
  NEWBORN_EDIT,
  PATIENT_ROLES,
  creationAccess,
  patientAccess,
  projectPatient,
} from '../utils/patientAccess.js';

// Patients always belong to the hospital selected in the session (req.tenantId).
// A tenantId sent by the browser is ignored: the schemas below simply don't accept it.

const DAY = 24 * 60 * 60 * 1000;
const text = (label, max) => z.string().trim().max(max, `${label} is too long`);

const count = (label, max = 30) =>
  z.union([z.null(), z.coerce.number().int(`${label} must be a whole number`).min(0, `${label} can't be negative`).max(max, `${label} is too high`)]);
const optionalNumber = (label, min, max) =>
  z.union([z.null(), z.coerce.number(`${label} must be a number`).min(min, `${label} is too low`).max(max, `${label} is too high`)]);
const emptyToNull = (v) => (v === '' || v === undefined ? null : v);

const identity = {
  // No characters that cannot be seen (a tab, a line break, a NUL …): a name is one line of letters, and the
  // "already registered" search builds a database pattern from it.
  fullName: text('Full name', 150).min(1, 'Full name is required').regex(/^\P{Cc}*$/u, 'Full name has a character that cannot be saved. Please type the name again.').transform(capitalizeName),
  phone: text('Phone', 30).regex(/^[0-9+()\-\s]*$/, 'Phone can only contain numbers, spaces, +, ( ) and -').default(''),
  address: text('Address', 300).default(''),
  emergencyContact: z
    .object({
      name: text('Emergency contact name', 100).regex(/^[^\p{Cc}]*$/u, 'Emergency contact name has a character that cannot be saved.').transform(capitalizeName).default(''),
      relation: text('Relation', 50).default(''),
      phone: text('Emergency contact phone', 30).regex(/^[0-9+()\-\s]*$/, 'Phone can only contain numbers, spaces, +, ( ) and -').default(''),
    })
    .default({ name: '', relation: '', phone: '' }),
  // The address's PIN code, city and state; who referred her; who pays (owner, 14 Oct 2026). All optional.
  pinCode: z.string().trim().regex(/^(\d{6})?$/, 'A PIN code has 6 digits').default(''),
  city: text('City', 60).regex(/^[^\p{Cc}]*$/u, 'City has a character that cannot be saved.').default(''),
  state: text('State', 60).regex(/^[^\p{Cc}]*$/u, 'State has a character that cannot be saved.').default(''),
  referredBy: text('Referred by', 100).regex(/^[^\p{Cc}]*$/u, 'Referred by has a character that cannot be saved.').default(''),
  payer: z
    .object({
      type: z.enum([...PAYER_TYPES, ''], 'Please choose who pays').default(''),
      name: text('Insurer, scheme or employer', 100).regex(/^[^\p{Cc}]*$/u, 'This name has a character that cannot be saved.').default(''),
      number: z.string().trim().regex(/^[0-9A-Za-z/\-\s]{0,40}$/, 'Type the card or policy number with letters, digits, / and - only').default(''),
    })
    .default({ type: '', name: '', number: '' })
    .refine((v) => v.type || (!v.name && !v.number), { message: 'Choose who pays', path: ['type'] }),
  // Only the last 4 characters of the ID's number: a whole Aadhaar (or other ID) number is never stored.
  idProof: z
    .object({
      kind: z.enum([...ID_PROOF_TYPES, ''], 'Please choose the type of ID proof').default(''),
      last4: z.string().trim().regex(/^[0-9A-Za-z]{0,4}$/, 'Type only the last 4 letters or digits of the ID number').default(''),
    })
    .default({ kind: '', last4: '' })
    .refine((v) => v.kind || !v.last4, { message: 'Choose the type of ID proof', path: ['kind'] }),
};

// Cross-field checks run even when other fields have errors, so every problem is shown at once.
// (Values may not be validated yet here, so each check is careful about types.)
const ALWAYS = { when: () => true };
const isDate = (v) => v instanceof Date && !Number.isNaN(v.getTime());
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// The pregnancy dates. Their checks against today (not in the future, not more than 45 weeks ago) are in
// pregnancyDateIssues: on an edit they apply only to a date that changed, so an older record (e.g. a pregnancy
// that ended and became postnatal or abortion care) can still be saved.
// findings: the findings ticked for this pregnancy, as the whole list (only what differs from the record is
// written – see patients/pregnancyFindings.js). Left out = not changed. findingsSeen: the list the form showed
// when it was opened – then only what the person changed on the form is applied, so a finding a colleague
// ticked meanwhile is not unticked by an older form.
const findingList = z.array(z.enum(PREGNANCY_FINDINGS, 'Choose a finding from the list')).max(PREGNANCY_FINDINGS.length);
const pregnancySchema = z.object({
  lmp: z.preprocess(emptyToNull, dateOnly('LMP')).default(null),
  scanEdd: z.preprocess(emptyToNull, dateOnly('Scan EDD')).default(null),
  findings: findingList.optional(),
  findingsSeen: findingList.optional(),
});
const FINDINGS_ANTENATAL_ONLY = 'Findings in this pregnancy can only be recorded for antenatal care.';

/** Problems with the pregnancy dates entered (zod-style issues, paths inside "pregnancy"). `stored`: the dates on
 * the record before this edit – a date equal to the stored one is not checked again. */
function pregnancyDateIssues(p, stored, now = new Date()) {
  const issues = [];
  if (!p) return issues;
  // Compared with the hospital's date, so an LMP of "today" is accepted just after midnight in India.
  const today = hospitalToday(now).getTime();
  const changed = (k) => isDate(p[k]) && !(stored?.[k] && sameDay(stored[k], p[k]));
  if (changed('lmp') && p.lmp.getTime() > today) issues.push({ code: 'custom', path: ['pregnancy', 'lmp'], message: 'LMP cannot be in the future' });
  else if (changed('lmp') && today - p.lmp.getTime() > 45 * 7 * DAY) {
    issues.push({ code: 'custom', path: ['pregnancy', 'lmp'], message: 'LMP is more than 45 weeks ago – please check the date' });
  }
  if (changed('scanEdd') && Math.abs(p.scanEdd.getTime() - today) > 45 * 7 * DAY) {
    issues.push({ code: 'custom', path: ['pregnancy', 'scanEdd'], message: 'Scan EDD looks wrong – please check the date' });
  }
  return issues;
}

// Pregnancy loss (the Abortion type of care): only loss that was not induced. Free text goes through the
// fetal-sex check (it is a pregnancy record). Fields that don't fit the type of loss are dropped.
// A type of loss or outcome no longer chosen (threatened miscarriage, "pregnancy continuing" – before 3 Oct 2026) is
// read here so that abortionIssues can refuse it with a clear message (never changed silently).
const pick = (keys, message) => z.preprocess(emptyToNull, z.union([z.enum(keys, message), z.null()])).default(null);

// Findings of the pregnancy loss, as a form sends them: { os: 'open', crlMm: '7.5', … }. A finding that is not sent
// is not touched; '' or null clears it. Never free text: a choice of the finding's list, or a number of millimetres
// (digits only, one decimal – "1e2", "0x10" or true are refused, so a value never changes its meaning silently).
const typedMm = (v) => {
  if (v === undefined || v === null || typeof v !== 'string') return v;
  const t = v.trim();
  if (t === '') return null;
  return /^\d{1,3}(?:[.,]\d)?$/.test(t) ? Number(t.replace(',', '.')) : t;
};
const lossFindingValue = (f) =>
  f.type === 'number'
    ? z.preprocess(
        typedMm,
        z
          .number(`${f.label} must be a number of ${f.unit}, for example 7 or 7.5`)
          .min(f.min, `${f.label} is too low`)
          .max(f.max, `${f.label} is too high`)
          .transform((n) => Math.round(n * 10) / 10)
          .nullable(),
      )
    : z.preprocess((v) => (v === '' ? null : v), z.union([z.enum(Object.keys(f.choices)), z.null()], `Choose an answer for "${f.label}" from the list`));
const lossFindingsSchema = z.object(Object.fromEntries(LOSS_FINDINGS.map((f) => [f.key, lossFindingValue(f).optional()]))).strict();
const NO_FINDINGS_NOW = 'Findings are recorded for a pregnancy loss that is being cared for now – not for a recurrent-loss work-up, and not before the type of loss is entered.';

const abortionSchema = z
  .object({
    lossType: z.preprocess(emptyToNull, z.union([z.enum(STORED_LOSS_TYPE_KEYS, 'Choose the type of loss'), z.null()])).default(null),
    lmp: z.preprocess(emptyToNull, dateOnly('LMP')).default(null),
    presentedOn: z.preprocess(emptyToNull, dateOnly('Date seen')).default(null),
    weeks: z.preprocess(emptyToNull, z.union([z.null(), z.coerce.number().int('Weeks must be a whole number').min(0, "Weeks can't be negative").max(MAX_WEEKS, 'Weeks at presentation must be below 28')])).default(null),
    days: z.preprocess(emptyToNull, z.union([z.null(), z.coerce.number().int('Days must be a whole number').min(0, "Days can't be negative").max(6, 'Days must be 0 to 6')])).default(null),
    ectopicSite: pick(Object.keys(ECTOPIC_SITES), 'Choose the site'),
    moleKind: pick(Object.keys(MOLE_KINDS), 'Choose the kind of mole'),
    management: z
      .object({
        method: pick(Object.keys(MANAGEMENT), 'Choose the management'),
        on: z.preprocess(emptyToNull, dateOnly('Date of management')).default(null),
        outcome: pick(Object.keys(OUTCOME_LABELS), 'Choose the outcome'),
      })
      .default({ method: null, on: null, outcome: null }),
    histology: z
      .object({ status: pick(Object.keys(HISTOLOGY), 'Choose the histology status'), result: safeText('Histology result', 300).default('') })
      .default({ status: null, result: '' }),
    antiD: z
      .object({ status: pick(Object.keys(ANTI_D), 'Choose an anti-D answer'), on: z.preprocess(emptyToNull, dateOnly('Anti-D date')).default(null) })
      .default({ status: null, on: null }),
    note: safeText('Note', 500).default(''),
    // The findings as the form shows them now (only what differs from the record is written, with who and when –
    // patients/lossFindings.js). Left out = not changed. findingsSeen: the values the form showed when it was
    // opened – then only what the person changed on the form is applied.
    findings: lossFindingsSchema.optional(),
    findingsSeen: lossFindingsSchema.optional(),
  })
  .transform(tidyAbortion);

/** Cross-field problems in a pregnancy-loss section (paths start with "abortion"). An empty date seen counts as
 * today: on registration that is what it becomes; on PATCH the route runs it after the stored date seen is filled in,
 * so the checks are never made against today for an older record. (Run on the tidied section: the tidy step only
 * clears fields these checks skip for that type of loss.) */
function abortionIssues(a, now = new Date()) {
  const out = [];
  const add = (path, message) => out.push({ code: 'custom', path: ['abortion', ...path], message });
  const today = hospitalToday(now).getTime();
  if (!a.lossType) add(['lossType'], 'Choose the type of loss');
  else if (RETIRED_LOSS_TYPES.some((t) => t.key === a.lossType)) add(['lossType'], RETIRED_LOSS_MESSAGE);
  const seen = isDate(a.presentedOn) ? a.presentedOn.getTime() : today;
  if (isDate(a.presentedOn) && seen > today) add(['presentedOn'], 'The date seen cannot be in the future');
  const pregnantFields = !NOT_PREGNANT_NOW.includes(a.lossType);
  if (pregnantFields && isDate(a.lmp)) {
    if (a.lmp.getTime() > seen) add(['lmp'], 'LMP cannot be after the date seen');
    else if (seen - a.lmp.getTime() >= (MAX_WEEKS + 1) * 7 * DAY) add(['lmp'], 'From 28 weeks this is a still birth – record it as a delivery');
  }
  const m = a.management ?? {};
  // (only for a type of loss still chosen: an old threatened miscarriage gets the message above instead)
  if (m.method && MANAGEMENT_FOR[a.lossType] && !MANAGEMENT_FOR[a.lossType].includes(m.method)) {
    add(['management', 'method'], 'This management does not fit the type of loss');
  }
  if (m.outcome && m.outcome in RETIRED_OUTCOMES) add(['management', 'outcome'], RETIRED_OUTCOME_MESSAGE);
  if (pregnantFields && isDate(m.on)) {
    if (m.on.getTime() > today) add(['management', 'on'], 'The date of management cannot be in the future');
    else if (isDate(a.lmp) && m.on.getTime() < a.lmp.getTime()) add(['management', 'on'], 'The date of management cannot be before the LMP');
  }
  if (pregnantFields && isDate(a.antiD?.on) && a.antiD.on.getTime() > today) add(['antiD', 'on'], 'The anti-D date cannot be in the future');
  return out;
}

// Drops what doesn't fit the type of loss: the site only for ectopic, the kind of mole and histology only for
// molar, and for recurrent loss (not pregnant now) the LMP, weeks, anti-D and the date of management.
function tidyAbortion(a) {
  const out = structuredClone(a);
  if (out.lossType !== 'ectopic') out.ectopicSite = null;
  if (out.lossType !== 'molar') {
    out.moleKind = null;
    out.histology = { status: null, result: '' };
  }
  if (out.lmp) {
    out.weeks = null; // worked out from the LMP (Patient model)
    out.days = null;
  } else if (out.weeks == null) out.days = null;
  if (NOT_PREGNANT_NOW.includes(out.lossType)) {
    Object.assign(out, { lmp: null, weeks: null, days: null, antiD: { status: null, on: null } });
    out.management = { ...out.management, on: null };
  }
  return out;
}

// The baby's sex must never be written in a pregnancy record (PCPNDT). The record's own free text is checked for
// antenatal and abortion care only: infertility and gynaecology notes may say "male factor".
const FETAL_SEX_TEXT = [['notes'], ['medical', 'allergies'], ['medical', 'otherConditions']];
const isPregnancyCare = (careType) => careType === 'antenatal' || careType === 'abortion';
function fetalSexIssues(careType, data, stored) {
  if (!isPregnancyCare(careType)) return [];
  const at = (o, path) => path.reduce((v, k) => v?.[k], o);
  return FETAL_SEX_TEXT.filter((path) => {
    const v = at(data, path);
    return typeof v === 'string' && v !== (at(stored, path) ?? '') && mentionsFetalSex(v);
  }).map((path) => ({ code: 'custom', path, message: PCPNDT_MESSAGE }));
}

const obstetricSchema = z
  .object({
    gravida: z.preprocess(emptyToNull, count('Gravida')).default(null),
    para: z.preprocess(emptyToNull, count('Para')).default(null),
    living: z.preprocess(emptyToNull, count('Living children')).default(null),
    abortions: z.preprocess(emptyToNull, count('Abortions')).default(null),
    previousCaesareans: z.preprocess(emptyToNull, count('Previous caesareans', 10)).default(null),
    pastComplications: z.array(z.enum(PAST_COMPLICATIONS)).max(PAST_COMPLICATIONS.length).default([]),
    complicationsReviewed: z.boolean().default(false),
  })
  .superRefine((o, ctx) => {
    const n = (v) => (isNum(v) ? v : 0);
    if (isNum(o.gravida) && n(o.para) + n(o.abortions) > o.gravida) {
      ctx.addIssue({ code: 'custom', path: ['gravida'], message: 'Gravida must be at least Para + Abortions' });
    }
    if (isNum(o.previousCaesareans) && isNum(o.para) && o.previousCaesareans > o.para) {
      ctx.addIssue({ code: 'custom', path: ['previousCaesareans'], message: 'Previous caesareans cannot be more than Para' });
    }
  }, ALWAYS);

const medicalSchema = z.object({
  bloodGroup: z.enum([...BLOOD_GROUPS, ''], 'Please choose a blood group').default(''),
  heightCm: z.preprocess(emptyToNull, optionalNumber('Height', 30, 250)).default(null),
  weightKg: z.preprocess(emptyToNull, optionalNumber('Weight', 0.3, 300)).default(null),
  allergies: text('Allergies', 500).default(''),
  conditions: z.array(z.enum(CONDITIONS)).max(CONDITIONS.length).default([]),
  conditionsReviewed: z.boolean().default(false),
  otherConditions: text('Other conditions', 500).default(''),
});

const newbornSchema = z.object({
  birthAt: z.preprocess(
    emptyToNull,
    z.union([z.iso.datetime('Please enter the date and time of birth').transform((d) => new Date(d)), z.null()]),
  ),
  birthWeightGrams: z.preprocess(emptyToNull, optionalNumber('Birth weight', 200, 7000)).default(null),
  sex: z.enum([...NEWBORN_SEX, ''], 'Please choose an option').default(''),
  mother: z.preprocess(emptyToNull, z.union([objectId, z.null()])).default(null),
  fatherName: z.string().trim().max(150, "The father's name is too long").regex(/^\P{Cc}*$/u, "The father's name has a character that cannot be saved.").transform(capitalizeName).default(''),
});

// A baby's care after birth (a baby's record only; a clinical detail): admitted to the NICU or SNCU – yes, no or ''
// for not recorded – with the day admitted to the unit and the day discharged from it, and breastfeeding at discharge
// (exclusive, partial, none or '' for not recorded). Every field is optional.
const newbornCareSchema = z
  .object({
    nicu: z
      .object({
        admitted: z.preprocess((v) => v ?? '', z.enum(NICU_ADMITTED, 'Choose yes, no or not recorded')),
        from: z.preprocess(emptyToNull, dateOnly('Admitted to the unit on')).default(null),
        to: z.preprocess(emptyToNull, dateOnly('Discharged from the unit on')).default(null),
      })
      .strict()
      .optional(),
    feedingAtDischarge: z.preprocess((v) => v ?? '', z.enum(FEEDING_AT_DISCHARGE, 'Choose exclusive, partial, none or not recorded')).optional(),
  })
  .strict();
const NEWBORN_CARE_ONLY = "NICU or SNCU admission and feeding at discharge are recorded only on a baby's record.";

const ABORTION_ONLY = 'Pregnancy loss details are only for the Abortion type of care';

// Registration. The website registers in two steps: the patient's details first (this route), then the
// clinical details (the edit route, which requires the pregnancy dates the same way). So the dates are only
// required here when a doctor or RMO sends the pregnancy section with the registration; reception never
// sends it (a doctor or RMO completes it later).
const makeCreateSchema = ({ requireDates }) => z
  .object({
    careType: z.enum(CARE_TYPES, 'Please choose the type of care'),
    ...identity,
    ageYears: z.preprocess(emptyToNull, z.union([z.null(), z.coerce.number().int('Age must be a whole number').min(0).max(120, 'Please check the age')])).default(null),
    assignedDoctor: z.preprocess(emptyToNull, z.union([objectId, z.null()])).default(null),
    pregnancy: pregnancySchema.default({}),
    obstetric: obstetricSchema.default({}),
    medical: medicalSchema.default({}),
    newborn: newbornSchema.optional(),
    abortion: abortionSchema.optional(),
    notes: text('Notes', 2000).default(''),
    // "Register as a new patient anyway": sent only after the possible matches were shown (see POST below).
    registerAnyway: z.boolean('registerAnyway must be true or false').default(false),
  })
  .superRefine((d, ctx) => {
    if (d.abortion !== undefined && d.careType !== 'abortion') {
      ctx.addIssue({ code: 'custom', path: ['abortion', 'lossType'], message: ABORTION_ONLY });
    }
    for (const issue of pregnancyDateIssues(d.pregnancy, null)) ctx.addIssue(issue);
    if (d.careType !== 'antenatal' && d.pregnancy?.findings?.length) ctx.addIssue({ code: 'custom', path: ['pregnancy', 'findings'], message: FINDINGS_ANTENATAL_ONLY });
    // On registration an empty date seen means today, so the pregnancy-loss checks can run here.
    if (d.abortion && typeof d.abortion === 'object') for (const issue of abortionIssues(d.abortion)) ctx.addIssue(issue);
    for (const issue of fetalSexIssues(d.careType, d, null)) ctx.addIssue(issue);
    if (d.careType === 'newborn') {
      const birthAt = d.newborn?.birthAt;
      if (!birthAt) ctx.addIssue({ code: 'custom', path: ['newborn', 'birthAt'], message: 'Date and time of birth is required' });
      else if (isDate(birthAt) && birthAt.getTime() > Date.now() + 5 * 60 * 1000) {
        ctx.addIssue({ code: 'custom', path: ['newborn', 'birthAt'], message: 'Date of birth cannot be in the future' });
      }
    } else if (d.ageYears === null || d.ageYears === undefined) {
      ctx.addIssue({ code: 'custom', path: ['ageYears'], message: 'Age is required' });
    } else if (isNum(d.ageYears) && d.ageYears < 10) {
      ctx.addIssue({ code: 'custom', path: ['ageYears'], message: 'Please check the age' });
    }
    if (requireDates && d.careType === 'antenatal' && !d.pregnancy?.lmp && !d.pregnancy?.scanEdd) {
      ctx.addIssue({ code: 'custom', path: ['pregnancy', 'lmp'], message: 'For a pregnancy, enter the LMP or the scan EDD' });
    }
    if (d.careType === 'antenatal') for (const issue of pregnancyCountIssues(d)) ctx.addIssue(issue);
  }, ALWAYS);
const createSchemas = { withDates: makeCreateSchema({ requireDates: true }), basic: makeCreateSchema({ requireDates: false }) };

// For a CURRENT pregnancy, gravida counts this pregnancy too, so it must be at least para + abortions + 1.
// A first pregnancy (gravida 1) has no previous pregnancies, so no previous-pregnancy problems can be recorded.
function pregnancyCountIssues(p) {
  const o = p.obstetric ?? {};
  const n = (v) => (isNum(v) ? v : 0);
  if (!isNum(o.gravida)) return [];
  if (o.gravida < n(o.para) + n(o.abortions) + 1) {
    return [{ code: 'custom', path: ['obstetric', 'gravida'], message: 'For a current pregnancy, Gravida must be at least Para + Abortions + 1 (it includes this pregnancy)' }];
  }
  if (o.gravida === 1 && (o.pastComplications?.length ?? 0) > 0) {
    return [{ code: 'custom', path: ['obstetric', 'pastComplications'], message: 'This is the first pregnancy, so there are no previous pregnancies to record problems for' }];
  }
  return [];
}

// Editing: every section is optional; only what is sent is changed.
const updateSchema = z.object({
  careType: z.enum(CARE_TYPES).optional(),
  fullName: identity.fullName.optional(),
  phone: identity.phone.optional(),
  address: identity.address.optional(),
  emergencyContact: identity.emergencyContact.optional(),
  idProof: identity.idProof.optional(),
  pinCode: identity.pinCode.optional(),
  city: identity.city.optional(),
  state: identity.state.optional(),
  referredBy: identity.referredBy.optional(),
  payer: identity.payer.optional(),
  ageYears: z.preprocess(emptyToNull, z.union([z.null(), z.coerce.number().int().min(10, 'Please check the age').max(120, 'Please check the age')])).optional(),
  pregnancy: pregnancySchema.optional(),
  obstetric: obstetricSchema.optional(),
  medical: medicalSchema.optional(),
  newborn: newbornSchema.optional(),
  // Sent as a whole: it replaces the stored section (only an empty date seen keeps the stored one).
  abortion: abortionSchema.optional(),
  notes: text('Notes', 2000).optional(),
  // A delivery outside this hospital (postnatal patients): the day and the mode. A confirmed delivery note wins.
  delivery: z.object({ on: requiredDateOnly('Date of delivery'), mode: z.enum(DELIVERY_MODES, 'Choose the mode of delivery') }).optional(),
  // After delivery (postnatal patients): whether she is breastfeeding – yes, no, or '' for not recorded.
  postnatal: z.object({ breastfeeding: z.preprocess((v) => v ?? '', z.enum(BREASTFEEDING, 'Choose yes, no or not recorded')) }).strict().optional(),
  // A baby's care after birth (babies' records): NICU or SNCU admission with its dates, breastfeeding at discharge.
  newbornCare: newbornCareSchema.optional(),
});

const listSchema = z.object({
  search: z.string().trim().max(100).default(''),
  careType: z.enum(CARE_TYPES).optional(),
  // mine_or_unassigned: patients of the logged-in doctor plus unassigned ones (whose risk any doctor may override)
  doctor: z.union([z.enum(['me', 'mine_or_unassigned', 'unassigned', 'all']), objectId]).optional(),
  // risk level filter; "review" = doctor's override may be out of date
  risk: z.enum(['high', 'moderate', 'low', 'incomplete', 'review']).optional(),
  // Records marked as a duplicate of another are left out. Doctors and RMOs may list them too ("include") or
  // only them ("only").
  duplicates: z.enum(['include', 'only']).optional(),
  // Registered on or after / on or before these days (owner, 13 Oct 2026: More filters → Registered)
  registeredFrom: requiredDateOnly('Registered from').optional(),
  registeredTo: requiredDateOnly('Registered to').optional(),
  sort: sortParam(['mrn', 'fullName', 'createdAt', 'pregnancy.effectiveEdd', 'lastVisitOn'], '-createdAt'),
  ...pageParams,
});

// The assigned doctor must be an active member of this hospital with the doctor role.
async function assertDoctorInHospital(tenantId, userId) {
  if (!userId) return;
  const m = await Membership.findOne({ tenantId, userId, isActive: true, roles: 'doctor' });
  const u = m && (await User.findOne({ _id: userId, isActive: true }));
  if (!u) {
    const message = 'Please choose a doctor who works at this hospital.';
    throw Object.assign(new HttpError(400, message, 'VALIDATION'), { fields: { assignedDoctor: message } });
  }
}

// linkedNow: the mother already on the baby's record (an edit that leaves her as she is, is not a new link).
async function assertMother(tenantId, motherId, linkedNow = null) {
  if (!motherId) return;
  const mother = await Patient.findOne({ _id: motherId, tenantId });
  if (!mother || mother.careType === 'newborn') {
    const message = "Please choose the mother from this hospital's patients.";
    throw Object.assign(new HttpError(400, message, 'VALIDATION'), { fields: { 'newborn.mother': message } });
  }
  // A baby is newly linked to the mother's main record, never to one marked as a duplicate. (A baby already linked
  // to a record that was marked later stays linked: nothing is moved, and the baby's details can still be saved.)
  if (isDuplicate(mother) && String(linkedNow ?? '') !== String(mother._id)) {
    const message = `This record of the mother is marked as a duplicate of ${mother.duplicateOf.mrn}. Choose ${mother.duplicateOf.mrn} as the mother.`;
    throw Object.assign(new HttpError(400, message, 'VALIDATION'), { fields: { 'newborn.mother': message } });
  }
}

// Adds doctor and mother names for display.
async function withNames(patients) {
  const doctorIds = [...new Set(patients.map((p) => p.assignedDoctor?.toString()).filter(Boolean))];
  const motherIds = [...new Set(patients.map((p) => p.newborn?.mother?.toString()).filter(Boolean))];
  const [doctors, mothers] = await Promise.all([
    User.find({ _id: { $in: doctorIds } }, { name: 1 }).lean(),
    motherIds.length ? Patient.find({ tenantId: patients[0].tenantId, _id: { $in: motherIds } }, { fullName: 1, mrn: 1, 'death.on': 1 }).lean() : [],
  ]);
  const dn = new Map(doctors.map((d) => [d._id.toString(), d.name]));
  // (closed: the mother's record is closed – only that, never why)
  const mn = new Map(mothers.map((m) => [m._id.toString(), { id: m._id.toString(), fullName: m.fullName, mrn: m.mrn, ...(isClosed(m) ? { closed: true } : {}) }]));
  return patients.map((p) => ({
    ...p.toJSON(),
    assignedDoctorName: p.assignedDoctor ? (dn.get(p.assignedDoctor.toString()) ?? null) : null,
    motherInfo: p.newborn?.mother ? (mn.get(p.newborn.mother.toString()) ?? null) : null,
  }));
}

// Lists which fields changed (names only – values are personal data and stay out of the audit log).
function changedFields(before, after, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(after)) {
    const b = before?.[k];
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) out.push(...changedFields(b, v, `${prefix}${k}.`));
    else if (JSON.stringify(b ?? null) !== JSON.stringify(v ?? null)) out.push(`${prefix}${k}`);
  }
  return out;
}

export const patientsRouter = Router();

// Only staff with a patient-facing role may use these routes (not admin-only or unknown roles).
patientsRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...PATIENT_ROLES)) {
    throw new HttpError(403, "Your role in this hospital doesn't include access to patient records.", 'FORBIDDEN');
  }
  next();
});

// The patient's care plan (/api/patients/:id/care-plan), consent forms (/consents) and visits (/visits),
// behind the same role gate.
patientsRouter.use('/:id/care-plan', carePlanRouter);
patientsRouter.use('/:id/consents', patientConsentsRouter);
patientsRouter.use('/:id/visits', visitsRouter);
patientsRouter.use('/:id/admissions', admissionsRouter);
patientsRouter.use('/:id/lab-orders', patientLabRouter);
patientsRouter.use('/:id/imaging', patientImagingRouter); // USG and radiology (Lab version 2)
patientsRouter.use('/:id/work-done', workDoneRouter);
patientsRouter.use('/:id/reminder-consent', patientReminderConsentRouter);
patientsRouter.use('/:id/portal-access', patientPortalAccessRouter);
patientsRouter.use('/:id/reminder', remindersRouter);
patientsRouter.use('/:id/ai', patientAiRouter);
patientsRouter.use('/:id/duplicate-of', patientDuplicateRouter);
patientsRouter.use('/:id/death', patientDeathRouter);
// A complete copy of the record, for her doctor or an RMO (routes/recordCopy.js)
patientsRouter.use('/:id/record-copy', recordCopyRouter);

const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');

// Recalculates the patient's automatic risk level (in memory), from her record and the readings of this
// pregnancy (visits, reviewed lab results). Nothing goes into the audit log: hospital admins can read it, and
// even whether an entry appears would reveal that the level changed. The action that triggered the recalculation
// is audited on its own, and the level stays on the record behind clinical access.
async function updateRisk(req, patient) {
  const template = await riskTemplateFor(patient);
  return applyCurrentRisk(patient, template, req.now ?? new Date());
}

// Who ticks or unticks a finding of this pregnancy, and when (kept on the record with the finding).
const findingBy = (req, extra = {}) => ({ by: req.user._id, byName: req.user.name, at: req.now ?? new Date(), ...extra });

// Patients whose risk level this person may see (mirrors patientAccess: risk is a clinical detail).
// null = none. RMOs: all; doctors: all except other doctors' sensitive records; nurses: non-sensitive.
function riskVisibleFilter(req) {
  const roles = req.membership?.roles ?? [];
  if (roles.includes('rmo')) return {};
  if (roles.includes('doctor')) return { $or: [{ sensitive: { $ne: true } }, { assignedDoctor: req.user._id }, { assignedDoctor: null }] };
  if (roles.includes('nurse')) return { sensitive: { $ne: true } };
  return null;
}

// Sorting by due date: only an antenatal record's due date counts. Patients of other types (a pregnancy that
// ended may still have dates stored) come last.
async function byDueDate(filter, q, fieldsShown) {
  const dir = q.sort.startsWith('-') ? -1 : 1;
  const ids = await Patient.aggregate([
    { $match: Patient.find(filter).cast() }, // ids as stored (an aggregation doesn't convert them itself)
    { $addFields: { _later: { $ne: ['$careType', 'antenatal'] } } },
    { $sort: { _later: 1, 'pregnancy.effectiveEdd': dir, _id: dir } },
    { $skip: (q.page - 1) * q.limit },
    { $limit: q.limit },
    { $project: { _id: 1 } },
  ]);
  const rows = await Patient.find({ tenantId: filter.tenantId, _id: { $in: ids.map((r) => r._id) } }).select(fieldsShown);
  const byId = new Map(rows.map((p) => [String(p._id), p]));
  return ids.map((r) => byId.get(String(r._id))).filter(Boolean);
}

// A pharmacist with no other patient role finds patients through the pharmacy's daily register only (owner, 26 Oct
// 2026: routes/pharmacyRegister.js) – never the hospital's whole list or its search.
const onlyPharmacist = (roles = []) => roles.includes('pharmacist') && !roles.some((r) => r !== 'pharmacist' && PATIENT_ROLES.includes(r));

patientsRouter.get('/', async (req, res) => {
  if (onlyPharmacist(req.membership?.roles)) throw forbidden('The pharmacy finds patients from its daily register.');
  const q = parse(listSchema, req.query);
  const filter = { tenantId: req.tenantId };
  if (q.careType) filter.careType = q.careType;
  if (q.registeredFrom || q.registeredTo) {
    filter.createdAt = {
      ...(q.registeredFrom ? { $gte: hospitalDayStart(q.registeredFrom) } : {}),
      ...(q.registeredTo ? { $lt: hospitalDayStart(addDays(q.registeredTo, 1)) } : {}),
    };
  }
  if (q.doctor === 'me') filter.assignedDoctor = req.user._id;
  else if (q.doctor === 'mine_or_unassigned') filter.assignedDoctor = { $in: [req.user._id, null] };
  else if (q.doctor === 'unassigned') filter.assignedDoctor = null;
  else if (q.doctor && q.doctor !== 'all') filter.assignedDoctor = q.doctor;
  const and = [];
  if (q.risk) {
    // Filtering by risk would reveal medical information, so only those who may see risk can use it,
    // and only over the records whose risk they may see.
    const visible = riskVisibleFilter(req);
    if (!visible) throw forbidden("Your role doesn't include patients' risk levels.");
    if (q.risk === 'review') filter['risk.overrideNeedsReview'] = true;
    else filter['risk.level'] = q.risk;
    and.push({ careType: 'antenatal' }); // added to (not replacing) any care-type filter chosen
    if (Object.keys(visible).length) and.push(visible);
  }
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    and.push({ $or: [{ fullName: rx }, { mrn: rx }, { phone: rx }] });
  }
  // Records marked as a duplicate are left out of the list and of every search – except a search for exactly
  // that record's patient number (it is printed on her old card: the record opens and points to the main one).
  if (q.duplicates) {
    if (!hasRole(req.membership, 'doctor', 'rmo')) throw forbidden('Only doctors and RMOs can list the records marked as duplicates.');
    if (q.duplicates === 'only') and.push(ONLY_DUPLICATES);
  } else {
    and.push(q.search ? { $or: [NOT_DUPLICATE, { mrn: new RegExp(`^${escapeRegex(q.search)}$`, 'i') }] } : NOT_DUPLICATE);
  }
  if (and.length) filter.$and = and;
  // Keep stored risk levels current (ages change, rules change) before listing or counting by them.
  await refreshDueRisks(req.tenantId);
  if (q.sort.includes('lastVisitOn')) await backfillLastVisits(req.tenantId);
  // Of the pregnancy-loss section only the type of loss ("Abortion · missed"); projectPatient still hides it from
  // those who may not see medical details.
  // duplicateOf: the main record's number of a record marked as a duplicate ("Duplicate of P-…" in the list).
  // death: a closed record stays in the list and in every search, marked "Record closed" (everyone sees `closed`;
  // the date only those who may see the medical details – projectPatient).
  const fieldsShown = 'mrn careType fullName ageYears ageRecordedOn phone assignedDoctor sensitive pregnancy abortion.lossType newborn risk createdAt tenantId duplicateOf death';
  const [patients, total] = await Promise.all([
    q.sort.endsWith('pregnancy.effectiveEdd')
      ? byDueDate(filter, q, fieldsShown)
      : Patient.find(filter).sort(toMongoSort(q.sort)).skip((q.page - 1) * q.limit).limit(q.limit).select(fieldsShown),
    Patient.countDocuments(filter),
  ]);
  const named = patients.length ? await withNames(patients) : [];
  const rows = named.map((json, i) => projectPatient(json, patientAccess(req, patients[i])));
  // For those who may see a patient's visits: the last visit's date, and how many red flags the record has now – from
  // the latest visit, the lab results of this pregnancy or episode and, in hospital, the nursing chart (the list's columns)
  const clinical = patients.filter((p, i) => rows[i].access.canViewVisits);
  if (clinical.length) {
    const [last, flags] = await Promise.all([
      Visit.aggregate([
        { $match: { tenantId: req.tenantId, status: 'active', patientId: { $in: clinical.map((p) => p._id) } } },
        { $sort: { patientId: 1, visitOn: -1, createdAt: -1 } },
        { $group: { _id: '$patientId', visitOn: { $first: '$visitOn' } } },
      ]),
      // (a closed record has no current red flags – nothing is to be done about its values any more – except while
      // she is still in hospital: a death recorded on the wrong record must never hide a living patient's flags)
      closedInHospital(req, clinical).then((inHospital) => redFlagsForPatients(planCtx(req), clinical.filter((p) => !isClosed(p) || inHospital.has(String(p._id))))),
    ]);
    const lastOf = new Map(last.map((l) => [String(l._id), l.visitOn]));
    rows.forEach((row, i) => {
      if (!row.access.canViewVisits) return;
      const id = String(patients[i]._id);
      row.lastVisitOn = lastOf.get(id) ?? null;
      const f = flags.byPatient.get(id);
      row.redFlags = f ? { count: f.flags.length, urgent: f.flags.filter((x) => x.level === 'urgent').length } : null;
    });
  }
  res.json({ patients: rows, ...paged(q, total) });
});

/**
 * Registers a patient (the checks, the patient number, the audit log, a pregnancy's risk and care plan) – for the
 * New patient form, and for reception approving a patient's online sign-up (routes/patientAccounts.js). Returns
 * { patient } or, when records may be hers and registerAnyway was not sent, { matches } (nothing saved).
 */
export async function registerPatient(req, body) {
  const can = creationAccess(req);
  if (!can.allowed) throw forbidden('Only reception, the referral desk, the lab, doctors and RMOs can register patients.');
  await ensureStandardTemplates(req.tenantId); // any pending rule upgrade runs now, not in the middle of saving
  const sentPregnancy = can.clinical && body?.pregnancy !== undefined;
  const data = parse(sentPregnancy ? createSchemas.withDates : createSchemas.basic, body);
  if (!can.clinical) {
    // Reception registers identity (and newborn birth details); medical details come from clinicians.
    for (const section of ['pregnancy', 'obstetric', 'medical', 'abortion']) delete data[section];
    data.notes = '';
  }
  if (!can.fullIdentity) {
    // The referral desk saves only what it may see of her afterwards (utils/patientAccess.js): no address, and no
    // baby – a baby's birth details and mother are registered by reception, doctors and RMOs.
    if (data.careType === 'newborn') throw forbidden('Babies are registered by reception, doctors and RMOs.');
    data.address = '';
  }
  // Pregnancy loss: seen today unless another day was entered. Its findings are written with who recorded them.
  if (data.abortion) {
    data.abortion.presentedOn ??= hospitalToday(req.now);
    const { findings: lossValues, findingsSeen: _seen, ...section } = data.abortion;
    data.abortion = { ...section, findings: [] };
    if (data.careType === 'abortion' && lossValues) setLossFindings(data.abortion, lossValues, findingBy(req));
  }
  // Findings of this pregnancy are written with who recorded them, after the record exists (not as a plain list).
  const findingKeys = data.pregnancy?.findings ?? [];
  if (data.pregnancy) {
    delete data.pregnancy.findings;
    delete data.pregnancy.findingsSeen; // a new record: nothing was shown before
  }
  await assertDoctorInHospital(req.tenantId, data.assignedDoctor);
  if (data.careType === 'newborn') await assertMother(req.tenantId, data.newborn?.mother);

  // "She may already be registered": records of this hospital with the same phone number or the same name
  // (patients/duplicateService.js – a baby only against babies, everyone else never against a baby). Nothing is
  // saved until the person registering has seen them and says "Register as a new patient anyway"; nothing is
  // ever joined by itself. The answer shows only what this person may already see of those records.
  const registerAnyway = data.registerAnyway;
  delete data.registerAnyway;
  const found = await possibleMatches(req, data);
  if (found.total && !registerAnyway) {
    return {
      matches: {
        message: `${data.careType === 'newborn' ? 'This baby' : 'She'} may already be registered. Check the ${found.total === 1 ? 'record' : 'records'} shown before you register a new patient.`,
        code: 'POSSIBLE_MATCHES',
        matches: found.matches,
        total: found.total,
      },
    };
  }

  const seq = await nextNumber(req.tenantId, 'patient');
  const patient = await Patient.create({
    ...data,
    newborn: data.careType === 'newborn' ? data.newborn : undefined,
    abortion: data.careType === 'abortion' ? (data.abortion ?? null) : null,
    ageYears: data.careType === 'newborn' ? null : data.ageYears,
    ageRecordedOn: data.careType === 'newborn' ? null : new Date(),
    sensitive: data.careType === 'infertility',
    mrn: `P-${String(seq).padStart(6, '0')}`,
    tenantId: req.tenantId,
    createdBy: req.user._id,
  });
  // Only ids go into the audit log, never the patient's personal details.
  await audit(req, 'PATIENT_CREATED', { details: { patientId: patient._id.toString(), mrn: patient.mrn, careType: patient.careType } });
  await billRegistered(req, patient); // the registration fee, when the hospital charges one
  // Registered although matching records were shown: which records (ids only – never a name or a phone number)
  if (found.total) {
    await audit(req, 'PATIENT_REGISTERED_ANYWAY', { details: { patientId: patient._id.toString(), mrn: patient.mrn, matches: found.total, matchIds: found.ids.slice(0, 20) } });
  }
  if (patient.careType === 'antenatal') {
    if (findingKeys.length) setFindings(patient, findingKeys, findingBy(req));
    await updateRisk(req, patient);
    await patient.save();
    // An antenatal patient registered with dates gets a care plan straight away (never fails the registration).
    await syncPlanSafely(planCtx(req), patient._id);
  }
  return { patient };
}


patientsRouter.post('/', async (req, res) => {
  const out = await registerPatient(req, req.body);
  if (out.matches) return res.status(409).json({ error: out.matches });
  const [named] = await withNames([out.patient]);
  return res.status(201).json({ patient: projectPatient(named, patientAccess(req, out.patient)) });
});

// The baby keepsake card was printed (doctor ideas #10): ids only. A baby's own record, born; staff who see her birth.
patientsRouter.post('/:id/keepsake-printed', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  if (patient.careType !== 'newborn' || !patient.newborn?.birthAt || !patientAccess(req, patient).view.has('newborn')) throw forbidden("You can't print this card.");
  await audit(req, 'KEEPSAKE_CARD_PRINTED', { details: { patientId: String(patient._id), mrn: patient.mrn } });
  res.json({ ok: true });
});

// The pregnancy timeline (doctor ideas #7, 16 Oct 2026): this pregnancy's visit days and the care plan's scans, tests
// and check-ups with their due dates and status – for the ribbon from LMP to EDD on her Overview. Only for those who
// see her pregnancy (the plan's items only for those who see the plan); covered by opening her record (PATIENT_VIEWED).
patientsRouter.get('/:id/timeline', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  if (patient.careType !== 'antenatal' || !patientAccess(req, patient).view.has('pregnancy')) throw forbidden("You can't see this pregnancy.");
  const edd = eddInUse(patient);
  if (!edd) return res.json({ edd: null, visits: [], items: [] });
  const start = addDays(edd, -280);
  const [visits, items] = await Promise.all([
    Visit.find({ tenantId: req.tenantId, patientId: patient._id, status: 'active', visitOn: { $gte: start } }, { visitOn: 1 }).sort({ visitOn: 1 }).limit(100).lean(),
    currentPlanItems(planCtx(req), patient),
  ]);
  res.json({
    edd,
    visits: visits.map((v) => v.visitOn),
    items: items.filter((it) => ['scan', 'investigation', 'visit', 'vaccination'].includes(it.kind) && it.dueBy).map((it) => ({ kind: it.kind, name: it.name, status: it.status, dueBy: it.dueBy })),
  });
});

patientsRouter.get('/:id', async (req, res) => {
  // The risk level is re-checked first if it may be out of date (age changed, or the rules/approval changed).
  const patient = await loadPatientForPlan(req);
  const access = patientAccess(req, patient);
  await audit(req, 'PATIENT_VIEWED', { details: { patientId: patient._id.toString(), mrn: patient.mrn, access: access.level } });
  // The care plan's short summary for the Overview card: only for those who may see the plan (the plan is
  // built here on first view, and kept in step with the patient). Covered by the PATIENT_VIEWED entry.
  const carePlanSummary = await carePlanSummaryFor(planCtx(req), patient);
  // Red flags (latest visit, lab results of this pregnancy or episode, the nursing chart while in hospital): only
  // worked out for those who may see the medical details.
  // A closed record has none – nothing is to be done about its values any more – except while she is still in
  // hospital (the discharge card ends the stay): a death recorded on the wrong record must never hide a living
  // patient's flags.
  const flagsWanted = access.view.has('pregnancy') && (!isClosed(patient) || (await closedInHospital(req, [patient])).size > 0);
  const redFlags = flagsWanted ? await redFlagsForPatient(planCtx(req), patient) : undefined;
  const [out] = await withNames([patient]);
  const createdBy = await User.findById(patient.createdBy, { name: 1 }).lean();
  // "Earlier record: P-…": the records marked as duplicates of this one (shown: only those this person may open)
  // earlierRecordDetails: what an earlier record has that this one does not (an allergy, a blood group, a care plan
  // …) – only for those who may see the medical details of both records (projectPatient hides it from the others).
  const earlier = await earlierRecordsFor(req, patient);
  const earlierRecords = earlier.shown;
  // Newborns registered to this mother – also those linked to an earlier record of hers (nothing is moved: the
  // baby stays linked to that record, and is listed here so that it is not missed). A baby's own duplicate record
  // is not listed twice.
  const babies =
    patient.careType === 'newborn'
      ? []
      : await Patient.find({ tenantId: req.tenantId, 'newborn.mother': { $in: [patient._id, ...earlier.ids] }, ...NOT_DUPLICATE }, { fullName: 1, mrn: 1, 'newborn.birthAt': 1, 'death.on': 1 }).lean();
  const full = {
    ...out,
    createdByName: createdBy?.name ?? null,
    // (closed: the baby's record is closed – only that, never why)
    babies: babies.map((b) => ({ id: b._id.toString(), fullName: b.fullName, mrn: b.mrn, birthAt: b.newborn?.birthAt, ...(isClosed(b) ? { closed: true } : {}) })),
    ...(earlierRecords.length ? { earlierRecords } : {}),
    ...(earlier.details.length ? { earlierRecordDetails: earlier.details } : {}),
    ...(carePlanSummary === undefined ? {} : { carePlanSummary }),
    ...(redFlags === undefined ? {} : { redFlags }),
  };
  const projected = projectPatient(full, access);
  // Today's visit (the header's "Open today's visit"): only for those who may see visits. Covered by PATIENT_VIEWED.
  if (projected.access.canViewVisits) {
    const todays = await Visit.findOne({ tenantId: req.tenantId, patientId: patient._id, visitOn: hospitalToday(req.now), status: 'active' }, { _id: 1 })
      .sort({ createdAt: 1 })
      .lean();
    projected.todayVisitId = todays ? String(todays._id) : null;
    // The latest visit, in short, for the Overview's "Last visit" card (never the doctor's private note).
    const last = await Visit.findOne({ tenantId: req.tenantId, patientId: patient._id, status: 'active' })
      .sort({ visitOn: -1, createdAt: -1 });
    projected.lastVisit = last ? { ...visitSummary(last, { notes: false }), hb: last.vitals?.hb ?? null } : null;
    // In hospital now (Version 2): the current stay, for the header's "Admitted" badge
    const stay = await Admission.findOne({ tenantId: req.tenantId, patientId: patient._id, status: 'admitted' });
    projected.currentAdmission = stay ? admissionView(stay) : null;
  }
  res.json({ patient: projected });
});

/** The ids (strings) of the closed records among `patients` that still have a stay in hospital open. */
async function closedInHospital(req, patients) {
  const closed = patients.filter(isClosed).map((p) => p._id);
  if (!closed.length) return new Set();
  const stays = await Admission.find({ tenantId: req.tenantId, patientId: { $in: closed }, status: 'admitted' }, { patientId: 1 }).lean();
  return new Set(stays.map((s) => String(s.patientId)));
}

// Keeps only the fields that were actually sent, so editing one field never blanks out others
// (the schemas fill in defaults for fields that are missing).
function onlySent(data, raw) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (!raw || !(k in raw)) continue;
    const isSection = v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v);
    out[k] = isSection ? onlySent(v, raw[k]) : v;
  }
  return out;
}

// Birth details (including the baby's sex) belong only on a newborn's own record, never on a pregnancy's
// (PCPNDT). The website already keeps to this; the server now refuses a crafted request too:
// (a) a newborn section on a record of another type, (b) a change of type to or from newborn, and
// (c) a birth time in the future (checked at registration, and now on every edit as well).
const validation = (message, fields) => Object.assign(new HttpError(400, message, 'VALIDATION'), fields ? { fields } : {});
function assertNewbornRules(patient, data) {
  if (data.careType !== undefined && data.careType !== patient.careType && (data.careType === 'newborn' || patient.careType === 'newborn')) {
    const message = "A newborn's record can't be changed to another type of care, or the other way round. Register the baby or the mother as a new patient.";
    throw validation(message, { careType: message });
  }
  if (data.newborn !== undefined && patient.careType !== 'newborn') {
    throw validation("Newborn details can only be added to a newborn's record.");
  }
  const birthAt = data.newborn?.birthAt;
  if (isDate(birthAt) && birthAt.getTime() > Date.now() + 5 * 60 * 1000) {
    const message = 'Date of birth cannot be in the future';
    throw validation(message, { 'newborn.birthAt': message });
  }
}

// A delivery at another hospital, typed by a doctor or RMO: only for a postnatal patient, never over a delivery
// note confirmed here, and not in the future.
function setOutsideDelivery(req, patient, { on, mode }) {
  if (patient.careType !== 'postnatal') throw validation('A delivery date can be added only for a postnatal patient.', { 'delivery.on': 'Only for postnatal care' });
  if (patient.lastDelivery?.documentId) {
    throw validation('The delivery is recorded in a confirmed delivery note. Change it there with an addition.', { 'delivery.on': 'Recorded in the delivery note' });
  }
  if (on > hospitalToday(req.now ?? new Date())) throw validation('The date of delivery cannot be in the future.', { 'delivery.on': 'Cannot be in the future' });
  patient.lastDelivery = { at: on, mode, documentId: null };
}

// A baby's care after birth, typed by a doctor or RMO: what was sent is laid over what is stored. The dates of the
// stay in the unit are kept only with "admitted: yes"; they cannot be before the day of birth, in the future, or the
// wrong way round.
function setNewbornCare(req, patient, sent) {
  const stored = patient.newbornCare?.toObject?.() ?? patient.newbornCare ?? {};
  const nicu = { admitted: '', from: null, to: null, ...(stored.nicu ?? {}), ...(sent.nicu ?? {}) };
  if (nicu.admitted !== 'yes') Object.assign(nicu, { from: null, to: null });
  const fields = {};
  const today = hospitalToday(req.now ?? new Date());
  const birthDay = patient.newborn?.birthAt ? toHospitalDate(patient.newborn.birthAt) : null;
  if (nicu.from && nicu.from > today) fields['newbornCare.nicu.from'] = 'The date cannot be in the future.';
  else if (nicu.from && birthDay && nicu.from < birthDay) fields['newbornCare.nicu.from'] = 'The date cannot be before the day of birth.';
  if (nicu.to && !nicu.from) fields['newbornCare.nicu.from'] = 'Enter the day the baby was admitted to the unit.';
  else if (nicu.to && nicu.to > today) fields['newbornCare.nicu.to'] = 'The date cannot be in the future.';
  else if (nicu.to && nicu.from && nicu.to < nicu.from) fields['newbornCare.nicu.to'] = 'The discharge from the unit cannot be before the admission to it.';
  if (Object.keys(fields).length) throw validation('Please check the highlighted fields.', fields);
  patient.newbornCare = { nicu, feedingAtDischarge: sent.feedingAtDischarge ?? stored.feedingAtDischarge ?? '' };
}

patientsRouter.patch('/:id', async (req, res) => {
  const parsed = parse(updateSchema, req.body);
  const data = onlySent(parsed, req.body);
  if (data.abortion !== undefined) data.abortion = parsed.abortion; // a whole section, not field by field
  const patient = await findPatient(req);
  const access = patientAccess(req, patient);
  if (!access.editIdentity && !access.editClinical) {
    throw forbidden(
      access.emergencyNote
        ? "This is another doctor's patient: you can view the record and add an emergency note, but not change it."
        : "You can't change this patient's details.",
    );
  }
  const notAllowed = Object.keys(data).filter(
    (k) =>
      !((IDENTITY_EDIT.includes(k) && access.editIdentity) || (NEWBORN_EDIT.includes(k) && access.editNewborn) || (CLINICAL_EDIT.includes(k) && access.editClinical)),
  );
  if (notAllowed.length) throw forbidden(`You can't change these details: ${notAllowed.join(', ')}.`);
  const before = patient.toObject();
  assertNewbornRules(patient, data);
  const careTypeAfter = data.careType ?? patient.careType;
  if (data.abortion !== undefined && careTypeAfter !== 'abortion') throw validation(ABORTION_ONLY, { 'abortion.lossType': ABORTION_ONLY });
  // The findings of the pregnancy loss (the values the form shows, when sent): written below with who and when,
  // never copied into the record as they came. The entries already on the record stay when the section is replaced.
  const lossValues = data.abortion?.findings;
  const lossSeen = data.abortion?.findingsSeen ?? null;
  if (data.abortion) {
    delete data.abortion.findings;
    delete data.abortion.findingsSeen;
  }
  // The findings ticked for this pregnancy (the whole list, when sent): written below with who and when, never
  // copied into the record as a plain list.
  const findingKeys = data.pregnancy?.findings;
  const findingsSeen = data.pregnancy?.findingsSeen ?? null;
  if (data.pregnancy) {
    delete data.pregnancy.findings;
    delete data.pregnancy.findingsSeen;
  }
  if (findingKeys?.length && careTypeAfter !== 'antenatal') throw validation(FINDINGS_ANTENATAL_ONLY, { 'pregnancy.findings': FINDINGS_ANTENATAL_ONLY });
  if (data.postnatal !== undefined && careTypeAfter !== 'postnatal') {
    throw validation('Breastfeeding is recorded only for a postnatal patient.', { 'postnatal.breastfeeding': 'Only for postnatal care' });
  }
  if (data.newbornCare !== undefined && careTypeAfter !== 'newborn') {
    throw validation(NEWBORN_CARE_ONLY, { 'newbornCare.nicu.admitted': "Only on a baby's record", 'newbornCare.feedingAtDischarge': "Only on a baby's record" });
  }
  // Dates and free text are checked only where they changed (D19): an older record can still be saved. A record
  // that becomes antenatal has its pregnancy dates checked in full (stored ones too): a stale LMP, e.g. of a
  // pregnancy that ended, must not start a new antenatal plan.
  const becomesAntenatal = careTypeAfter === 'antenatal' && before.careType !== 'antenatal';
  const datesToCheck = becomesAntenatal ? { lmp: before.pregnancy?.lmp ?? null, scanEdd: before.pregnancy?.scanEdd ?? null, ...data.pregnancy } : data.pregnancy;
  const issues = [...pregnancyDateIssues(datesToCheck, becomesAntenatal ? null : before.pregnancy, req.now), ...fetalSexIssues(careTypeAfter, data, before)];
  if (data.abortion) {
    // An empty date seen keeps the stored one (or today), and the section's checks run again with it.
    data.abortion.presentedOn ??= before.abortion?.presentedOn ?? hospitalToday(req.now);
    issues.push(...abortionIssues(data.abortion, req.now));
  }
  if (issues.length) {
    const fields = Object.fromEntries(issues.map((i) => [i.path.join('.'), i.message]));
    // An old threatened miscarriage saved as it is: the reason itself, not only "check the fields"
    throw validation(fields['abortion.lossType'] === RETIRED_LOSS_MESSAGE ? RETIRED_LOSS_MESSAGE : 'Please check the highlighted fields.', fields);
  }

  if (data.newborn?.mother) await assertMother(req.tenantId, data.newborn.mother, patient.newborn?.mother);
  if (data.newborn?.mother && data.newborn.mother === patient._id.toString()) {
    throw new HttpError(400, 'A patient cannot be their own mother.', 'VALIDATION');
  }
  for (const key of ['careType', 'fullName', 'phone', 'address', 'pinCode', 'city', 'state', 'referredBy', 'payer', 'emergencyContact', 'idProof', 'notes']) if (data[key] !== undefined) patient[key] = data[key];
  // Only a genuinely different age resets the date it was recorded on – otherwise every save (the form always
  // sends the age) would stop the age from ever increasing, and age-based risk rules would never apply.
  const ageChanged = data.ageYears !== undefined && data.ageYears !== currentAge(patient);
  if (ageChanged) {
    patient.ageYears = data.ageYears;
    patient.ageRecordedOn = data.ageYears == null ? null : new Date();
  }
  if (data.ageYears !== undefined && !ageChanged) delete data.ageYears; // not a change (also for the audit)
  for (const section of ['pregnancy', 'obstetric', 'medical', 'newborn']) {
    if (data[section]) patient[section] = { ...(patient[section]?.toObject?.() ?? {}), ...data[section] };
  }
  // The section is replaced as a whole – except its findings, which keep who recorded each of them: only what the
  // form changed is written, and a finding that no longer fits the type of loss is ended (kept, never deleted).
  // Another loss on the same record (the date seen moved by more than 8 weeks – the care plan starts a new plan for
  // it): the findings of the earlier loss are ended first, so none of them counts for the new one; the form's own
  // values are then written as usual (the website sends them, and the values it compared them with, empty).
  let lossFindingsChanged = false;
  if (data.abortion) {
    const kept = (before.abortion?.findings ?? []).map((f) => ({ ...f }));
    patient.abortion = { ...data.abortion, findings: kept };
    const who = findingBy(req);
    if (anotherLoss(before.abortion?.presentedOn, patient.abortion.presentedOn)) lossFindingsChanged = endLossFindings(patient.abortion, who);
    lossFindingsChanged = setLossFindings(patient.abortion, lossValues ?? {}, who, { seen: lossSeen }) || lossFindingsChanged;
    if (lossFindingsChanged) patient.markModified('abortion.findings');
  }
  if (data.delivery) setOutsideDelivery(req, patient, data.delivery);
  if (data.newbornCare) setNewbornCare(req, patient, data.newbornCare);
  // A baby's record closed after a death: the birth cannot be after the day of death (the age at death is worked out
  // from it – models/Patient.js). The words never say why the record is closed: reception edits the birth details.
  if (data.newborn?.birthAt && isClosed(patient) && patient.newborn?.birthAt && toHospitalDate(patient.newborn.birthAt) > patient.death.on) {
    const message = "This date is after a date already recorded on this closed record. Check it with the baby's doctor.";
    throw validation(message, { 'newborn.birthAt': message });
  }
  // No longer postnatal care: the answer belonged to that time after delivery. It is asked again after the next
  // delivery (an old "no" must never silence the breastfeeding warnings). Whoever changes the type of care clears it
  // (reception may), so the audit entry names the field as changed, like any other.
  let clearedBreastfeeding = false;
  if (data.postnatal) patient.postnatal = { ...(patient.postnatal?.toObject?.() ?? {}), ...data.postnatal };
  else if (before.careType === 'postnatal' && careTypeAfter !== 'postnatal' && patient.postnatal?.breastfeeding) {
    patient.postnatal = { breastfeeding: '' };
    clearedBreastfeeding = true;
  }
  // Allergies must be asked whenever the medical background is saved: an empty answer can't be told apart from
  // "never asked" (the safety strip and the medicine checks rely on it). "None known" is an answer.
  if (data.medical && patient.careType !== 'newborn' && !(patient.medical?.allergies ?? '').trim()) {
    const message = 'Please answer the allergy question: write the allergies, or "None known".';
    throw Object.assign(new HttpError(400, message, 'VALIDATION'), { fields: { 'medical.allergies': message } });
  }
  if (data.pregnancy && patient.careType === 'antenatal' && !patient.pregnancy?.lmp && !patient.pregnancy?.scanEdd) {
    const message = 'For a pregnancy, enter the LMP or the scan EDD';
    throw Object.assign(new HttpError(400, message, 'VALIDATION'), { fields: { 'pregnancy.lmp': message } });
  }
  if (patient.careType === 'antenatal' && (data.obstetric || data.careType)) {
    const issues = pregnancyCountIssues({ obstetric: patient.toObject().obstetric });
    if (issues.length) {
      const fields = Object.fromEntries(issues.map((i) => [i.path.join('.'), i.message]));
      throw Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });
    }
  }
  // Findings of this pregnancy: only what differs from the record is written (a finding that stays ticked keeps
  // who first recorded it). The audit entry names the field, never which finding.
  const findingsChanged = findingKeys !== undefined && patient.careType === 'antenatal' && setFindings(patient, findingKeys, findingBy(req), { seen: findingsSeen });
  if (patient.careType === 'antenatal' || before.careType === 'antenatal') await updateRisk(req, patient);
  await patient.save();

  // The abortion section is compared as stored: the model works out weeks and days from the LMP, and a re-sent
  // unchanged section must not show them as changed in the audit log.
  // (the baby's care after birth too: dates that do not fit "admitted: no" are dropped, not stored)
  const stored = patient.toObject();
  // The findings of a pregnancy loss are named on their own (the field, never which finding or its value).
  const withoutFindings = (a) => {
    if (!a) return a;
    const { findings: _findings, ...rest } = a;
    return rest;
  };
  // A change anywhere in the baby's care after birth is named as that one section, never its parts: "NICU dates
  // changed" would tell the hospital admin, who reads the audit log, that the baby was in the NICU.
  const fields = [
    ...new Set(
      changedFields(
        { ...before, abortion: withoutFindings(before.abortion) },
        {
          ...data,
          ...(data.abortion ? { abortion: withoutFindings(stored.abortion) } : {}),
          ...(data.newbornCare ? { newbornCare: stored.newbornCare } : {}),
        },
      ).map((f) => (f.startsWith('newbornCare.') ? 'newbornCare' : f)),
    ),
  ];
  if (findingsChanged) fields.push('pregnancy.findings');
  if (lossFindingsChanged) fields.push('abortion.findings');
  if (clearedBreastfeeding) fields.push('postnatal.breastfeeding');
  if (fields.length) {
    await audit(req, 'PATIENT_UPDATED', { details: { patientId: patient._id.toString(), mrn: patient.mrn, fields } });
  }
  // The care plan follows the patient's details (dates, blood group, risk, type of care …): built, re-dated,
  // paused or resumed. Not audited on its own (the PATIENT_UPDATED entry is), and it never fails this save
  // (syncPlanSafely does nothing for a patient who isn't antenatal and has no plan).
  await syncPlanSafely(planCtx(req), patient._id);
  const [out] = await withNames([patient]);
  res.json({ patient: projectPatient(out, patientAccess(req, patient)) });
});

// One finding of this pregnancy ticked or unticked on its own: the visit page's "Add to her record" (with the
// visit it was confirmed at), or a single change without the edit form. Only those who may edit the clinical
// details (the treating or an unassigned doctor, an RMO); antenatal records only. The risk level is worked out
// again and the care plan follows. Audited as a change to the record: the field's name, never which finding.
// "Confirmed at a visit" (visitId) is kept only where the server's own offer stands at this moment: the finding
// the visit's vital signs suggest, on an antenatal visit of this pregnancy that is not marked entered in error
// (suggestedFindings – the same check that makes the offer on the visit page). A visit cancelled or changed
// meanwhile is refused, so the record never says "confirmed at a visit" on the strength of one that no longer
// counts.
const findingSchema = z
  .object({
    key: z.enum(PREGNANCY_FINDINGS, 'Choose a finding from the list'),
    present: z.boolean('Say whether the finding is present'),
    visitId: objectId.optional(),
  })
  .strict();
patientsRouter.post('/:id/pregnancy-findings', async (req, res) => {
  const body = parse(findingSchema, req.body);
  const patient = await findPatient(req);
  const access = patientAccess(req, patient);
  if (!access.editClinical) {
    throw forbidden(
      access.emergencyNote
        ? "This is another doctor's patient: you can view the record, but not change it."
        : "Only the patient's doctor or an RMO can record findings in this pregnancy.",
    );
  }
  if (patient.careType !== 'antenatal') throw validation(FINDINGS_ANTENATAL_ONLY, { key: FINDINGS_ANTENATAL_ONLY });
  let visit = null;
  // Already ticked: nothing changes, whatever the visit says now (the answer is the record as it is).
  const alreadySo = currentFindings(patient, req.now ?? new Date()).includes(body.key) === body.present;
  if (body.visitId && !alreadySo) {
    if (!body.present) throw validation('A finding is removed in Edit details, not from a visit.', { visitId: 'Not used when a finding is removed' });
    visit = await Visit.findOne({ _id: body.visitId, tenantId: req.tenantId, patientId: patient._id }, { status: 1, careType: 1, visitOn: 1, 'vitals.bpSystolic': 1, 'vitals.bpDiastolic': 1 });
    if (!visit) throw new HttpError(404, 'Visit not found.', 'NOT_FOUND');
    if (visit.status !== 'active') {
      throw new HttpError(409, 'This visit was marked as entered in error, so nothing was added to her record. Reload the page.', 'VISIT_CANCELLED');
    }
    if (!suggestedFindings(patient, visit, req.now ?? new Date()).some((s) => s.key === body.key)) {
      throw new HttpError(409, 'The vital signs of this visit no longer suggest this finding, so nothing was added. Reload the page; a finding can also be ticked in Edit details.', 'NOT_SUGGESTED');
    }
  }
  const changed = setFinding(patient, body.key, body.present, findingBy(req, { via: visit ? 'visit' : 'record', visitId: visit?._id ?? null }));
  if (changed) {
    await updateRisk(req, patient);
    await patient.save();
    await audit(req, 'PATIENT_UPDATED', { details: { patientId: patient._id.toString(), mrn: patient.mrn, fields: ['pregnancy.findings'] } });
    await syncPlanSafely(planCtx(req), patient._id); // items for this finding, and the high-risk items, follow
  }
  const [out] = await withNames([patient]);
  res.json({ patient: projectPatient(out, patientAccess(req, patient)), changed });
});

// The findings of a pregnancy loss saved on their own: from the visit page (with the visit they were found at), or
// from the record without the whole edit form. Only those who may edit the clinical details (the treating or an
// unassigned doctor, an RMO); only for the Abortion type of care, with a type of loss that is a pregnancy now.
// From a visit only where the visit page itself can still be changed: not on a record marked as a duplicate (it takes
// nothing new – a red flag there would reach no list; the main record is used), and not from a signed visit.
// findings: the values the card shows now; seen: the values it showed when it was opened (only what was changed is
// written). Audited as a change to the record: the field's name, never which finding or its value.
const lossFindingsBody = z.object({ findings: lossFindingsSchema, seen: lossFindingsSchema.optional(), visitId: objectId.optional() }).strict();
patientsRouter.put('/:id/loss-findings', async (req, res) => {
  const body = parse(lossFindingsBody, req.body);
  const patient = await findPatient(req);
  const access = patientAccess(req, patient);
  if (!access.editClinical) {
    throw forbidden(
      access.emergencyNote
        ? "This is another doctor's patient: you can view the record, but not change it."
        : "Only the patient's doctor or an RMO can record the findings of a pregnancy loss.",
    );
  }
  if (patient.careType !== 'abortion') throw validation(ABORTION_ONLY, { findings: ABORTION_ONLY });
  const lossType = patient.abortion?.lossType ?? null;
  if (RETIRED_LOSS_TYPES.some((t) => t.key === lossType)) throw validation(RETIRED_LOSS_MESSAGE, { findings: RETIRED_LOSS_MESSAGE });
  if (!LOSS_TYPE_KEYS.includes(lossType) || NOT_PREGNANT_NOW.includes(lossType)) throw validation(NO_FINDINGS_NOW, { findings: NO_FINDINGS_NOW });
  let visit = null;
  if (body.visitId) {
    visit = await Visit.findOne({ _id: body.visitId, tenantId: req.tenantId, patientId: patient._id }, { status: 1, careType: 1, signed: 1 });
    if (!visit) throw new HttpError(404, 'Visit not found.', 'NOT_FOUND');
    refuseNewOnDuplicate(patient, 'visit');
    if (visit.status !== 'active') {
      throw new HttpError(409, 'This visit was marked as entered in error, so nothing was added to her record. Reload the page.', 'VISIT_CANCELLED');
    }
    if (visit.signed) {
      throw new HttpError(409, 'This visit is signed, so nothing was added from it. Record the finding in Edit details – it is saved on her record.', 'VISIT_SIGNED');
    }
    if (visit.careType !== 'abortion') throw validation('Findings of a pregnancy loss are recorded from a visit of that care only.', { visitId: 'Not a pregnancy-loss visit' });
  }
  const changed = setLossFindings(patient.abortion, body.findings, findingBy(req, { via: visit ? 'visit' : 'record', visitId: visit?._id ?? null }), { seen: body.seen ?? null });
  if (changed) {
    patient.markModified('abortion.findings');
    await patient.save();
    await audit(req, 'PATIENT_UPDATED', { details: { patientId: patient._id.toString(), mrn: patient.mrn, fields: ['abortion.findings'] } });
    await syncPlanSafely(planCtx(req), patient._id); // the plan stays in step with the record it was worked out from
  }
  const [out] = await withNames([patient]);
  res.json({ patient: projectPatient(out, patientAccess(req, patient)), changed });
});

// Assign (or unassign) the responsible doctor.
patientsRouter.patch('/:id/doctor', async (req, res) => {
  const { doctorId } = parse(z.object({ doctorId: z.union([objectId, z.null()]) }), req.body);
  const patient = await findPatient(req);
  if (!patientAccess(req, patient).assign) throw forbidden("You can't change the doctor for another doctor's patient.");
  await assertDoctorInHospital(req.tenantId, doctorId);
  const from = patient.assignedDoctor?.toString() ?? null;
  if (from !== doctorId) {
    patient.assignedDoctor = doctorId;
    await patient.save();
    await audit(req, 'PATIENT_ASSIGNED', { details: { patientId: patient._id.toString(), mrn: patient.mrn, from, to: doctorId } });
  }
  const [out] = await withNames([patient]);
  res.json({ patient: projectPatient(out, patientAccess(req, patient)) });
});

// Mark or unmark a record as sensitive (treating doctor or RMO).
patientsRouter.patch('/:id/sensitive', async (req, res) => {
  const { sensitive } = parse(z.object({ sensitive: z.boolean('sensitive must be true or false') }), req.body);
  const patient = await findPatient(req);
  if (!patientAccess(req, patient).markSensitive) throw forbidden('Only the treating doctor or an RMO can change this.');
  if (patient.sensitive !== sensitive) {
    patient.sensitive = sensitive;
    await patient.save();
    await audit(req, 'PATIENT_SENSITIVITY_CHANGED', { details: { patientId: patient._id.toString(), mrn: patient.mrn, sensitive } });
  }
  const [out] = await withNames([patient]);
  res.json({ patient: projectPatient(out, patientAccess(req, patient)) });
});

// A doctor overrides the automatic risk level (with a reason), or removes their override.
const overrideSchema = z.object({
  level: z.enum(OVERRIDE_LEVELS, 'Choose high, moderate or low'),
  reason: z.string().trim().min(10, 'Please explain why (at least 10 characters)').max(500, 'Reason is too long'),
});

async function findForRiskOverride(req) {
  const patient = await findPatient(req);
  if (patient.careType !== 'antenatal') throw new HttpError(400, 'Risk levels are only used for antenatal patients.', 'VALIDATION');
  if (!patientAccess(req, patient).overrideRisk) throw forbidden("Only the patient's doctor can override the risk level.");
  return patient;
}

// Closes the current override in the history (kept on the record, behind clinical access).
function endCurrentOverride(patient, req, because) {
  const last = patient.riskOverrideHistory?.at(-1);
  if (last && !last.endedAt) {
    last.endedAt = new Date();
    last.endedByName = req.user.name;
    last.endedBecause = because;
  }
}

patientsRouter.put('/:id/risk-override', async (req, res) => {
  const data = parse(overrideSchema, req.body);
  const patient = await findForRiskOverride(req);
  await updateRisk(req, patient); // make sure the automatic result is current
  const computed = patient.risk.computedLevel;
  const at = new Date();
  if (patient.risk.override) endCurrentOverride(patient, req, 'replaced');
  patient.risk.override = {
    level: data.level,
    reason: data.reason,
    by: req.user._id,
    byName: req.user.name,
    at,
    computedLevelAtOverride: computed,
    reasonKeysAtOverride: patient.risk.reasons.map((x) => x.key),
  };
  patient.risk.level = data.level;
  patient.risk.overrideNeedsReview = false;
  patient.riskOverrideHistory.push({ level: data.level, reason: data.reason, byName: req.user.name, at, computedLevelAtOverride: computed });
  patient.markModified('risk');
  await patient.save();
  // Audit: who and which record only – the level and reason are medical details kept on the record.
  await audit(req, 'RISK_OVERRIDDEN', { details: { patientId: patient._id.toString(), mrn: patient.mrn } });
  await syncPlanSafely(planCtx(req), patient._id); // high-risk items follow the doctor's level
  const [out] = await withNames([patient]);
  res.json({ patient: projectPatient(out, patientAccess(req, patient)) });
});

patientsRouter.delete('/:id/risk-override', async (req, res) => {
  const patient = await findForRiskOverride(req);
  if (patient.risk?.override) {
    endCurrentOverride(patient, req, 'removed');
    patient.risk.override = null;
    patient.markModified('risk');
    await updateRisk(req, patient);
    await patient.save();
    await audit(req, 'RISK_OVERRIDE_REMOVED', { details: { patientId: patient._id.toString(), mrn: patient.mrn } });
    await syncPlanSafely(planCtx(req), patient._id);
  }
  const [out] = await withNames([patient]);
  res.json({ patient: projectPatient(out, patientAccess(req, patient)) });
});

// Notes on the patient's record (emergency notes for now).
patientsRouter.get('/:id/notes', async (req, res) => {
  const patient = await findPatient(req);
  if (!patientAccess(req, patient).viewNotes) throw forbidden("You can't view this patient's notes.");
  const notes = await PatientNote.find({ tenantId: req.tenantId, patientId: patient._id }).sort({ createdAt: -1 });
  res.json({ notes });
});

// A doctor who is not the patient's doctor can record emergency treatment, with a reason.
const emergencySchema = z.object({
  reason: z.string().trim().min(10, 'Please explain why (at least 10 characters)').max(500, 'Reason is too long'),
  text: z.string().trim().min(5, 'Please describe the emergency treatment').max(5000, 'Note is too long'),
});
patientsRouter.post('/:id/emergency-notes', async (req, res) => {
  const data = parse(emergencySchema, req.body);
  const patient = await findPatient(req);
  const access = patientAccess(req, patient);
  if (!access.emergencyNote) {
    throw forbidden(access.editClinical ? 'You have full access to this patient; use the normal record instead.' : 'Only doctors can add emergency notes.');
  }
  const note = await PatientNote.create({
    tenantId: req.tenantId,
    patientId: patient._id,
    kind: 'emergency',
    reason: data.reason,
    text: data.text,
    author: req.user._id,
    authorName: req.user.name,
  });
  await audit(req, 'EMERGENCY_NOTE_ADDED', {
    details: { patientId: patient._id.toString(), mrn: patient.mrn, noteId: note._id.toString(), reason: data.reason },
  });
  res.status(201).json({ note });
});

// Doctors in this hospital (for the "assigned doctor" dropdown). Any staff member may read it.
export const doctorsRouter = Router();
doctorsRouter.get('/', async (req, res) => {
  const memberships = await Membership.find({ tenantId: req.tenantId, isActive: true, roles: 'doctor' }, { userId: 1 }).lean();
  const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) }, isActive: true }, { name: 1, professional: 1 })
    .sort({ name: 1 })
    .lean();
  res.json({
    doctors: users.map((u) => ({ id: u._id.toString(), name: u.name, qualification: u.professional?.qualification ?? '' })),
    me: hasRole(req.membership, 'doctor') ? req.user._id.toString() : null,
  });
});
