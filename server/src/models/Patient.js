import mongoose from 'mongoose';
import { addDays, gaOn, hospitalToday, toHospitalDate, utcDay } from '../careplans/dates.js';
import { tenantScoped } from '../utils/tenantScope.js';
import { ANTI_D, ECTOPIC_SITES, HISTOLOGY, LOSS_FINDING_KEYS, MANAGEMENT, MAX_WEEKS, MOLE_KINDS, OUTCOME_LABELS, STORED_LOSS_TYPE_KEYS, gaFrom } from '../patients/abortionRules.js';
import { FINDING_VIA, MAX_FINDING_ENTRIES, PREGNANCY_FINDINGS, findingsView } from '../patients/pregnancyFindings.js';
import { DEATH_PLACES, DEATH_TIMINGS, ageInDays, deathHistoryView, deathView } from '../patients/deathRules.js';
import { LOSS_FINDING_VIA, MAX_LOSS_FINDING_ENTRIES, lossFindingsView } from '../patients/lossFindings.js';

// The ID proofs reception may note at registration (type + last 4 characters only).
export const ID_PROOF_TYPES = ['aadhaar', 'voter_id', 'pan', 'driving_licence', 'passport', 'ration_card', 'other'];

// Who pays (owner, 14 Oct 2026): herself, an insurance company or TPA, a government scheme (e.g. PM-JAY, JSY), or an
// employer.
export const PAYER_TYPES = ['self', 'insurance', 'govt_scheme', 'corporate'];

// What kind of OBGY care the patient is registered for. New types go at the END (analytics cell codes and
// list links follow this order; the website's menu has its own order).
export const CARE_TYPES = ['antenatal', 'postnatal', 'infertility', 'gynaecology', 'newborn', 'abortion'];
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
export const CONDITIONS = [
  'diabetes',
  'hypertension',
  'thyroid',
  'heart_disease',
  'asthma',
  'epilepsy',
  'anaemia',
  'tuberculosis',
  'hiv',
  'hepatitis_b',
  'syphilis',
  'renal_disease',
  'autoimmune',
  'thrombophilia',
  'mental_health',
  'liver_disease',
  'uterine_surgery', // previous surgery on the uterus other than caesarean (e.g. myomectomy)
];
// Problems in earlier pregnancies ("bad obstetric history"), used by the risk rules.
export const PAST_COMPLICATIONS = [
  'stillbirth_or_neonatal_death',
  'preterm_birth',
  'pre_eclampsia',
  'congenital_anomaly',
  'low_birth_weight_baby',
  'big_baby',
  'obstructed_labour',
  'pph',
  'rh_isoimmunisation',
];
// Only for babies AFTER birth. There is deliberately no fetal-sex field anywhere (PCPNDT Act).
export const NEWBORN_SEX = ['female', 'male', 'indeterminate'];
// Breastfeeding, on a postnatal record: yes, no, or '' = not recorded (the medicine checks then say "if she is breastfeeding").
export const BREASTFEEDING = ['yes', 'no', ''];
// A baby's record: admitted to the NICU or SNCU – yes, no, or '' = not recorded.
export const NICU_ADMITTED = ['yes', 'no', ''];
// A baby's record: breastfeeding at discharge – exclusive, partial, none, or '' = not recorded.
export const FEEDING_AT_DISCHARGE = ['exclusive', 'partial', 'none', ''];

const DAY = 24 * 60 * 60 * 1000;
export const PREGNANCY_DAYS = 280; // Naegele's rule: EDD = LMP + 280 days

const num = (min, max) => ({ type: Number, min, max, default: null });

// One finding made in this pregnancy (patients/pregnancyFindings.js): who recorded it and when; unticking ends it.
const findingSchema = new mongoose.Schema(
  {
    key: { type: String, enum: PREGNANCY_FINDINGS, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, required: true, maxlength: 150 },
    at: { type: Date, required: true },
    via: { type: String, enum: FINDING_VIA, default: 'record' }, // on the record, or confirmed on a visit page
    visitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Visit', default: null },
    endedAt: { type: Date, default: null }, // unticked: kept, with who and when
    endedByName: { type: String, default: null },
  },
  { _id: false },
);

// One finding of a pregnancy loss (patients/lossFindings.js): its value, who recorded it and when; a new value or
// clearing the field ends it. value: a choice of the finding's list, or a number of millimetres.
const lossFindingSchema = new mongoose.Schema(
  {
    key: { type: String, enum: LOSS_FINDING_KEYS, required: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, required: true, maxlength: 150 },
    at: { type: Date, required: true },
    via: { type: String, enum: LOSS_FINDING_VIA, default: 'record' }, // on the record (Edit details), or from a visit page
    visitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Visit', default: null },
    endedAt: { type: Date, default: null }, // replaced or cleared: kept, with who and when
    endedByName: { type: String, default: null },
  },
  { _id: false },
);

// The readings of this pregnancy that the risk rules use (careplans/readings.js works them out from the visits
// and the reviewed lab results; nobody types them here).
const readingsSchema = new mongoose.Schema(
  {
    lowestHb: {
      type: new mongoose.Schema({ value: { type: Number, required: true }, on: { type: Date, required: true }, source: { type: String, enum: ['visit', 'lab'], required: true } }, { _id: false }),
      default: null,
    },
    latestBp: {
      type: new mongoose.Schema({ systolic: { type: Number, required: true }, diastolic: { type: Number, required: true }, on: { type: Date, required: true } }, { _id: false }),
      default: null,
    },
  },
  { _id: false },
);

// A patient always belongs to exactly one hospital (tenantId, added by the tenantScoped plugin).
const patientSchema = new mongoose.Schema(
  {
    mrn: { type: String, required: true }, // hospital's own patient number, e.g. P-000001
    careType: { type: String, enum: CARE_TYPES, required: true },

    // Identity (agreed: name, age, phone, address; the emergency contact and the ID proof seen added 7 Oct 2026 at
    // the owner's request)
    fullName: { type: String, required: true, trim: true, maxlength: 150 },
    ageYears: num(0, 120), // age given at registration (adults)
    ageRecordedOn: { type: Date, default: null }, // so the current age can be worked out later
    // An adult's own sex, recorded only when the lab registers a walk-in (a man may come for his own tests): the lab's
    // usual ranges for men then apply (lab/labSetup.js rangeContext). '' = a women's-care patient. Never a fetus's sex
    // (PCPNDT): a baby's is in newborn.sex, recorded after birth.
    sex: { type: String, enum: ['', 'female', 'male'], default: '' },
    phone: { type: String, trim: true, maxlength: 30, default: '' },
    address: { type: String, trim: true, maxlength: 300, default: '' },
    // Whom to call in an emergency (a relative or attendant).
    emergencyContact: {
      name: { type: String, trim: true, maxlength: 100, default: '' },
      relation: { type: String, trim: true, maxlength: 50, default: '' },
      phone: { type: String, trim: true, maxlength: 30, default: '' },
    },
    // The address's PIN code, city and state (owner, 14 Oct 2026 – as other hospitals' registration asks)
    pinCode: { type: String, trim: true, maxlength: 6, default: '' },
    city: { type: String, trim: true, maxlength: 60, default: '' },
    state: { type: String, trim: true, maxlength: 60, default: '' },
    // Who sent her (a doctor, a clinic, an ASHA worker …) and who pays: for the bill and an insurance claim
    referredBy: { type: String, trim: true, maxlength: 100, default: '' },
    payer: {
      type: { type: String, enum: [...PAYER_TYPES, ''], default: '' },
      name: { type: String, trim: true, maxlength: 100, default: '' }, // the insurer / TPA, scheme or employer
      number: { type: String, trim: true, maxlength: 40, default: '' }, // the card or policy number
    },
    // The ID proof reception saw: its type and only the last 4 characters of its number – never a whole Aadhaar
    // (or other ID) number.
    idProof: {
      kind: { type: String, enum: [...ID_PROOF_TYPES, ''], default: '' },
      last4: { type: String, trim: true, maxlength: 4, default: '' },
    },

    // The doctor responsible for this patient (a member of the same hospital with the doctor role).
    assignedDoctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Sensitive records (e.g. infertility, pregnancy loss): medical details only for the treating doctor and RMOs.
    sensitive: { type: Boolean, default: false },
    // The day of the latest visit that was not cancelled (kept by utils/lastVisit.js; the list sorts by it).
    lastVisitOn: { type: Date }, // no default: a record without it is filled in by backfillLastVisits

    pregnancy: {
      lmp: { type: Date, default: null }, // last menstrual period
      edd: { type: Date, default: null }, // from LMP (calculated)
      scanEdd: { type: Date, default: null }, // corrected by the dating scan
      effectiveEdd: { type: Date, default: null }, // scan EDD if given, otherwise LMP EDD (calculated)
      // Findings made in THIS pregnancy (GDM, high blood pressure, twins, low-lying placenta, bleeding): ticked or
      // unticked only by those who may edit the clinical details. They raise the risk level and switch on
      // care-plan items. Entries are never deleted (an unticked one is ended).
      findings: {
        type: [findingSchema],
        default: [],
        validate: [(v) => v.length <= MAX_FINDING_ENTRIES, 'Too many changes to the findings of this pregnancy.'],
      },
      // Lowest haemoglobin and latest blood pressure of this pregnancy, as the risk rules last used them.
      readings: { type: readingsSchema, default: null },
    },

    // Pregnancy loss outside the MTP Act only; induced termination is never recorded. No fetal-sex field
    // (PC-PNDT). Only for the Abortion type of care; null for everyone else (and until step 2 is filled in).
    // pregnancy.* is never used for it: the LMP here gives no EDD, no calendar dates and no "weeks today".
    abortion: {
      type: new mongoose.Schema(
        {
          // Includes a type no longer chosen (threatened miscarriage, before 3 Oct 2026): old records still load and save.
          lossType: { type: String, enum: [...STORED_LOSS_TYPE_KEYS, null], default: null },
          lmp: { type: Date, default: null },
          presentedOn: { type: Date, default: null }, // the date she was seen for this loss
          weeks: num(0, MAX_WEEKS), // at presentation: worked out from the LMP when it is known
          days: num(0, 6),
          ectopicSite: { type: String, enum: [...Object.keys(ECTOPIC_SITES), null], default: null },
          moleKind: { type: String, enum: [...Object.keys(MOLE_KINDS), null], default: null },
          management: {
            method: { type: String, enum: [...Object.keys(MANAGEMENT), null], default: null },
            on: { type: Date, default: null },
            outcome: { type: String, enum: [...Object.keys(OUTCOME_LABELS), null], default: null },
          },
          histology: {
            status: { type: String, enum: [...Object.keys(HISTOLOGY), null], default: null },
            result: { type: String, trim: true, maxlength: 300, default: '' },
          },
          antiD: {
            status: { type: String, enum: [...Object.keys(ANTI_D), null], default: null },
            on: { type: Date, default: null },
          },
          note: { type: String, trim: true, maxlength: 500, default: '' },
          // What was found on examination and on the scan (os, products, sac, CRL, heartbeat, adnexal mass, free
          // fluid, signs of rupture, bleeding, fever with discharge): each value with who recorded it and when.
          // Written only through patients/lossFindings.js; entries are never deleted (a replaced one is ended).
          findings: {
            type: [lossFindingSchema],
            default: [],
            validate: [(v) => v.length <= MAX_LOSS_FINDING_ENTRIES, 'Too many changes to the findings of this pregnancy loss.'],
          },
        },
        { _id: false },
      ),
      default: null,
    },

    obstetric: {
      gravida: num(0, 30),
      para: num(0, 30),
      living: num(0, 30),
      abortions: num(0, 30),
      previousCaesareans: num(0, 10),
      pastComplications: { type: [{ type: String, enum: PAST_COMPLICATIONS }], default: [] },
      // Staff confirmed "no problems in previous pregnancies" (nothing ticked on its own is not enough).
      complicationsReviewed: { type: Boolean, default: false },
    },

    medical: {
      bloodGroup: { type: String, enum: [...BLOOD_GROUPS, ''], default: '' },
      heightCm: num(30, 250),
      weightKg: num(0.3, 300),
      allergies: { type: String, trim: true, maxlength: 500, default: '' },
      conditions: { type: [{ type: String, enum: CONDITIONS }], default: [] },
      // Staff confirmed "no known pre-existing conditions" (nothing ticked on its own is not enough).
      conditionsReviewed: { type: Boolean, default: false },
      otherConditions: { type: String, trim: true, maxlength: 500, default: '' },
    },

    // Automatic reminders (Version 2): only with her agreement – the channel and language she chose, and who
    // recorded it. consent false (or no entry) = no automatic messages.
    reminders: {
      type: new mongoose.Schema(
        {
          consent: { type: Boolean, default: false },
          channel: { type: String, enum: ['sms', 'whatsapp'], default: 'sms' },
          language: { type: String, enum: ['en', 'mr', 'hi'], default: 'en' },
          byName: String,
          at: Date,
        },
        { _id: false },
      ),
      default: null,
    },

    // Her ABHA (ABDM linking, M1 – docs/ABDM_PLAN.md): the ABHA number and ABHA address, verified with ABDM, with her
    // agreement. Never her Aadhaar number. Screens get it partly hidden (toJSON below); the full number only through
    // the ABDM routes. method: verified (existing ABHA, OTP), created (at the desk) or scan_share.
    abha: {
      type: new mongoose.Schema(
        {
          number: { type: String, required: true, match: /^\d{2}-\d{4}-\d{4}-\d{4}$/ },
          address: { type: String, trim: true, maxlength: 100, default: '' },
          nameOnAbha: { type: String, trim: true, maxlength: 150, default: '' },
          // As ABDM sent them when the ABHA was linked (ABDM asks for them again when the hospital links her records,
          // M2). '' / null on ABHAs linked before 5 Oct 2026: verifying her ABHA again fills them in.
          genderOnAbha: { type: String, trim: true, maxlength: 10, default: '' },
          yearOfBirthOnAbha: { type: Number, min: 1900, max: 2100, default: null },
          method: { type: String, enum: ['verified', 'created', 'scan_share'], required: true },
          consent: { type: Boolean, required: true },
          by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          byName: String,
          at: Date,
        },
        { _id: false },
      ),
      default: null,
    },

    // The latest delivery, from the delivery note a doctor confirmed (Version 2): the postnatal plan starts from it.
    lastDelivery: {
      type: new mongoose.Schema(
        { at: Date, mode: String, documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClinicalDocument' } },
        { _id: false },
      ),
      default: null,
    },
    // After delivery (postnatal care): whether she is breastfeeding – used by the medicine safety check.
    postnatal: {
      breastfeeding: { type: String, enum: BREASTFEEDING, default: '' },
    },
    newborn: {
      birthAt: { type: Date, default: null },
      birthWeightGrams: num(200, 7000),
      sex: { type: String, enum: [...NEWBORN_SEX, ''], default: '' },
      mother: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', default: null },
    },
    // A baby's care after birth (only on a baby's record; a clinical detail – reception sees the birth details above,
    // not these): admission to the NICU or SNCU with its dates, and breastfeeding at discharge. Every field has a
    // "not recorded" state ('' or null), which is what every record from before these fields has.
    newbornCare: {
      nicu: {
        admitted: { type: String, enum: NICU_ADMITTED, default: '' },
        from: { type: Date, default: null }, // the day admitted to the unit
        to: { type: Date, default: null }, // the day discharged from the unit (null: still there, or not recorded)
      },
      feedingAtDischarge: { type: String, enum: FEEDING_AT_DISCHARGE, default: '' },
    },

    // Automatic risk level (antenatal), recalculated whenever the patient's details or the rules change.
    // "level" is what is shown and filtered on: the doctor's override if any, otherwise the automatic result.
    risk: {
      level: { type: String, enum: ['high', 'moderate', 'low', 'incomplete', null], default: null },
      computedLevel: { type: String, enum: ['high', 'moderate', 'low', 'incomplete', null], default: null },
      reasons: { type: [{ _id: false, key: String, label: String, level: String, detail: String }], default: [] },
      missing: { type: [String], default: [] },
      // Readings a rule needs that were not measured yet in this pregnancy (shown; never called "incomplete")
      notMeasured: { type: [String], default: [] },
      // Findings ticked for this pregnancy that the hospital's rules have no rule for ("doctor to assess")
      findingsNotChecked: { type: [String], default: [] },
      // Readings recorded in this pregnancy ('lowestHb', 'latestBp') that the hospital's rules have no rule for
      readingsNotChecked: { type: [String], default: [] },
      mayBeHigher: { type: Boolean, default: false }, // moderate, but a high rule couldn't be checked
      freeTextNotChecked: { type: Boolean, default: false }, // "other conditions" text is not checked by rules
      overrideNeedsReview: { type: Boolean, default: false }, // automatic result changed since the override
      recheckAt: { type: Date, default: null }, // when the age next changes (re-check then)
      engineVersion: { type: Number, default: null }, // version of the risk logic that produced this result
      rulesChecked: { type: Number, default: 0 },
      templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'CarePlanTemplate', default: null },
      templateName: { type: String, default: null },
      templateVersion: { type: Number, default: null },
      templateApproved: { type: Boolean, default: false },
      computedAt: { type: Date, default: null },
      override: {
        type: new mongoose.Schema(
          {
            level: { type: String, enum: ['high', 'moderate', 'low'], required: true },
            reason: { type: String, required: true, maxlength: 500 },
            by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
            byName: { type: String, required: true },
            at: { type: Date, required: true },
            computedLevelAtOverride: { type: String, default: null },
            reasonKeysAtOverride: { type: [String], default: undefined },
          },
          { _id: false },
        ),
        default: null,
      },
    },

    // Every risk override ever made (kept on the record, behind clinical access – not in the audit log).
    riskOverrideHistory: {
      type: [
        {
          _id: false,
          level: String,
          reason: String,
          byName: String,
          at: Date,
          computedLevelAtOverride: String,
          endedAt: { type: Date, default: null },
          endedByName: { type: String, default: null },
          endedBecause: { type: String, default: null }, // 'removed' | 'replaced'
        },
      ],
      default: [],
    },

    notes: { type: String, trim: true, maxlength: 2000, default: '' },

    // Marked as a duplicate of another record of the same person (patients/duplicateRules.js): by her doctor or an
    // RMO, with a reason. null = not a duplicate (also every record from before this field). Nothing is moved or
    // deleted: the record stays readable, takes nothing new and is left out of the lists. mrn: the main record's
    // patient number, kept here so that a refusal can name it without another lookup (a number never changes).
    duplicateOf: {
      type: new mongoose.Schema(
        {
          patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
          mrn: { type: String, required: true },
          reason: { type: String, trim: true, maxlength: 300, default: '' },
          by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
          byName: { type: String, required: true, maxlength: 150 },
          at: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    // Earlier markings that were undone (kept on the record; the audit log has ids only, never the reason).
    duplicateHistory: {
      type: [
        {
          _id: false,
          patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' },
          mrn: String,
          reason: String,
          byName: String,
          at: Date,
          undoneByName: String,
          undoneAt: Date,
        },
      ],
      default: [],
    },

    // A death recorded on this record by a doctor (patients/deathRules.js): the record is then CLOSED – it stays
    // readable, takes nothing new and gets no reminder or message. null = not recorded (also every record from before
    // this field). A baby's record: the place and the age in completed days (worked out from the day of birth);
    // every other record: when it was in relation to the pregnancy. There is no cause-of-death field.
    death: {
      type: new mongoose.Schema(
        {
          on: { type: Date, required: true }, // the day (midnight UTC)
          place: { type: String, enum: [...Object.keys(DEATH_PLACES), null], default: null },
          timing: { type: String, enum: [...Object.keys(DEATH_TIMINGS), null], default: null },
          ageDays: { type: Number, min: 0, default: null },
          by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
          byName: { type: String, required: true, maxlength: 150 },
          at: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    // Deaths recorded in error and undone by a doctor, with the reason (kept on the record, behind clinical access;
    // the audit log has ids and counts only).
    deathHistory: {
      type: [
        {
          _id: false,
          on: Date,
          place: String,
          timing: String,
          byName: String,
          at: Date,
          undoneReason: String,
          undoneByName: String,
          undoneAt: Date,
        },
      ],
      default: [],
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  // optimisticConcurrency: a save based on an out-of-date copy fails instead of silently overwriting
  // someone else's change (e.g. a doctor's override saved at the same moment).
  { timestamps: true, optimisticConcurrency: true },
);
patientSchema.plugin(tenantScoped);
patientSchema.index({ tenantId: 1, mrn: 1 }, { unique: true });
patientSchema.index({ tenantId: 1, lastVisitOn: -1 });
patientSchema.index({ tenantId: 1, fullName: 1 });
patientSchema.index({ tenantId: 1, createdAt: -1 });
patientSchema.index({ tenantId: 1, careType: 1, createdAt: -1 });
patientSchema.index({ tenantId: 1, assignedDoctor: 1, createdAt: -1 });
patientSchema.index({ tenantId: 1, phone: 1 });
// One record per ABHA in a hospital.
patientSchema.index({ tenantId: 1, 'abha.number': 1 }, { unique: true, partialFilterExpression: { 'abha.number': { $type: 'string' } } });
patientSchema.index({ tenantId: 1, 'pregnancy.effectiveEdd': 1 });
patientSchema.index({ tenantId: 1, 'pregnancy.lmp': 1 }); // the calendar's LMP dates
patientSchema.index({ tenantId: 1, 'newborn.mother': 1 });
patientSchema.index({ tenantId: 1, 'risk.level': 1, createdAt: -1 });
patientSchema.index({ tenantId: 1, 'risk.templateId': 1 });
patientSchema.index({ tenantId: 1, careType: 1, 'risk.recheckAt': 1 });
patientSchema.index({ tenantId: 1, 'risk.overrideNeedsReview': 1 });
// The records marked as duplicates of a record ("Earlier record: P-…"): only duplicates are in this index.
patientSchema.index({ tenantId: 1, 'duplicateOf.patient': 1 }, { partialFilterExpression: { 'duplicateOf.patient': { $type: 'objectId' } } });
// The records closed after a death, by its day (the monthly report): only those are in this index.
patientSchema.index({ tenantId: 1, 'death.on': 1 }, { partialFilterExpression: { 'death.on': { $type: 'date' } } });

// Work out the due dates whenever the pregnancy details change. The dates are dates only (midnight UTC):
// a time of day (e.g. from older sample data) is dropped first.
patientSchema.pre('validate', function () {
  const p = this.pregnancy ?? {};
  p.lmp = utcDay(p.lmp);
  p.scanEdd = utcDay(p.scanEdd);
  p.edd = p.lmp ? addDays(p.lmp, PREGNANCY_DAYS) : null;
  p.effectiveEdd = p.scanEdd ?? p.edd ?? null;
  // A baby's stay in the NICU or SNCU, and a death: dates only.
  const nicu = this.newbornCare?.nicu;
  if (nicu) {
    nicu.from = utcDay(nicu.from);
    nicu.to = utcDay(nicu.to);
  }
  if (this.death?.on) this.death.on = utcDay(this.death.on);
  // A baby's age at death (completed days from the day of birth) is worked out again on every save, so a time of birth
  // entered or corrected after the death was recorded is counted (Analytics, the monthly report read the stored age).
  if (this.death?.on && this.careType === 'newborn') {
    this.death.ageDays = this.newborn?.birthAt ? ageInDays(toHospitalDate(this.newborn.birthAt), this.death.on) : null;
  }
  // Pregnancy loss: dates only, and the weeks at presentation from the LMP when it is known (never an EDD).
  const a = this.abortion;
  if (a) {
    a.lmp = utcDay(a.lmp);
    a.presentedOn = utcDay(a.presentedOn);
    if (a.management) a.management.on = utcDay(a.management.on);
    if (a.antiD) a.antiD.on = utcDay(a.antiD.on);
    const ga = a.lmp && a.presentedOn ? gaFrom(a.lmp, a.presentedOn) : null;
    if (ga) {
      a.weeks = ga.weeks;
      a.days = ga.days;
    }
  }
});

// Current age in whole years (adults) – age at registration plus the time since.
export function currentAge(patient, now = new Date()) {
  if (patient.ageYears == null) return null;
  const since = patient.ageRecordedOn ?? patient.createdAt ?? now;
  return patient.ageYears + Math.max(0, Math.floor((now - new Date(since)) / (365.25 * DAY)));
}

// How far along the pregnancy is today (the hospital's date), from the effective EDD.
export function gestationalAge(patient, now = new Date()) {
  const edd = utcDay(patient.pregnancy?.effectiveEdd);
  if (!edd) return null;
  return gaOn(edd, hospitalToday(now));
}

/** "91-1234-5678-9012" → "91-XXXX-XXXX-9012". */
export const maskAbha = (number) => String(number).replace(/^(\d{2})-\d{4}-\d{4}-(\d{4})$/, '$1-XXXX-XXXX-$2');

patientSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    ret.currentAge = currentAge(doc);
    ret.gestationalAge = doc.careType === 'antenatal' ? gestationalAge(doc) : null;
    // The ABHA leaves only partly hidden (91-XXXX-XXXX-1234); the full number through the ABDM routes.
    ret.abha = doc.abha?.number ? { linked: true, masked: maskAbha(doc.abha.number), method: doc.abha.method, at: doc.abha.at ?? null } : null;
    // Findings of this pregnancy: without staff ids, and with which ones count now.
    if (ret.pregnancy?.findings) ret.pregnancy.findings = findingsView(doc);
    // Findings of a pregnancy loss: without staff ids, and with which values count now (not when the list was
    // loaded without them – the Patients list reads only the type of loss).
    if (Array.isArray(ret.abortion?.findings)) ret.abortion.findings = lossFindingsView(doc.abortion);
    // A duplicate: the main record's id and number, who marked it and when – without staff ids. The reason and the
    // earlier markings are separate fields, shown only with the medical details (utils/patientAccess.js). A record
    // that is not (and never was) a duplicate has none of these fields.
    const dup = doc.duplicateOf?.patient ? doc.duplicateOf : null;
    delete ret.duplicateOf;
    delete ret.duplicateHistory;
    if (dup) {
      ret.duplicateOf = { id: String(dup.patient), mrn: dup.mrn, byName: dup.byName, at: dup.at };
      ret.duplicateReason = dup.reason ?? '';
    }
    if (doc.duplicateHistory?.length) {
      ret.duplicateHistory = doc.duplicateHistory.map((h) => ({ mrn: h.mrn, reason: h.reason ?? '', byName: h.byName, at: h.at, undoneByName: h.undoneByName, undoneAt: h.undoneAt }));
    }
    // A record closed after a death: `closed` for everyone who may open the record; the date, place or timing and
    // who recorded it are separate fields, shown only with the medical details (utils/patientAccess.js) – without
    // staff ids. A record that is not (and never was) closed has none of these fields. A baby's care after birth
    // (NICU, feeding) is only on a baby's record.
    const death = doc.death?.on ? doc.death : null;
    delete ret.death;
    delete ret.deathHistory;
    if (death) {
      ret.closed = true;
      ret.death = deathView(death);
    }
    if (doc.deathHistory?.length) ret.deathHistory = doc.deathHistory.map(deathHistoryView);
    if (doc.careType !== 'newborn') delete ret.newbornCare;
    return ret;
  },
});

export const Patient = mongoose.model('Patient', patientSchema);
