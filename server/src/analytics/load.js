// Loads ONE hospital's rows for Analytics, once per request, with only the fields the numbers need.
//
// Rules kept here (Analytics specification, sections 3.4 and 4.2):
//  - every query has the hospital's id in its filter, and every aggregate starts with a $match on it (the
//    tenantScoped guard refuses anything else). The id must be an ObjectId: an aggregate does not convert a
//    string, which would silently match nothing;
//  - names, record numbers, phone numbers, addresses, notes, allergies, free text of visits and care plans, and
//    the reason for a risk override are never selected;
//  - no distinct, estimatedDocumentCount or Model.collection calls (the guard does not cover them).

import mongoose from 'mongoose';
import { addDays, hospitalDayStart, isoDay, utcDay } from '../careplans/dates.js';
import { CarePlan } from '../models/CarePlan.js';
import { CarePlanTemplate } from '../models/CarePlanTemplate.js';
import { ClinicalDocument } from '../models/ClinicalDocument.js';
import { Patient } from '../models/Patient.js';
import { NOT_DUPLICATE } from '../patients/duplicateRules.js';
import { mainRecordOf } from '../patients/duplicateService.js';
import { Visit } from '../models/Visit.js';

// Patients: what the numbers use, plus what careplans/planEngine.js#planFacts needs (for the care-plan cards).
export const PATIENT_FIELDS = [
  '_id',
  'careType',
  'createdAt',
  'ageYears',
  'ageRecordedOn',
  'assignedDoctor',
  'sensitive',
  'pregnancy.lmp',
  'pregnancy.effectiveEdd',
  'pregnancy.scanEdd',
  // Findings ticked for this pregnancy (planFacts: which care-plan items apply) – which, when, and whether ended
  'pregnancy.findings.key',
  'pregnancy.findings.at',
  'pregnancy.findings.endedAt',
  'obstetric.gravida',
  'obstetric.para',
  'obstetric.living',
  'obstetric.abortions',
  'obstetric.previousCaesareans',
  'obstetric.complicationsReviewed',
  'medical.bloodGroup',
  'medical.heightCm',
  'medical.weightKg',
  'medical.conditions',
  'medical.conditionsReviewed',
  'newborn.birthAt',
  'newborn.birthWeightGrams',
  'newborn.mother',
  'risk.level',
  'risk.mayBeHigher',
  'risk.override.level',
  'risk.reasons.key',
  'risk.reasons.label',
  'risk.missing',
  'risk.computedAt',
  // A death a doctor recorded on the record (Deliveries tab, card H7): the day, when it was in relation to the
  // pregnancy, and a baby's age in days. Never who recorded it, nor a death recorded in error and undone.
  'death.on',
  'death.timing',
  'death.ageDays',
  '__v',
].join(' ');

// Delivery notes (Deliveries tab): only what the cards count. Never the babies' sex or weight, the indication, the
// notes, who conducted it, or any other text typed on the note.
export const DELIVERY_FIELDS = [
  '_id',
  'patientId',
  'content.deliveredAt',
  'content.mode',
  'content.pph',
  'content.babies.outcome',
  'content.babies.stillbirthType',
  'content.babies.apgar5',
  'content.babies.breastfedWithinHour',
  'content.babies.nicu',
].join(' ');
// Days loaded on each side of the period, so that a delivery on the first or last hospital day of the period is
// there in any time zone (the cards keep only those whose hospital date is in the period).
const DELIVERY_MARGIN_DAYS = 2;

const WINDOW_VISIT_LIGHT = ['_id', 'patientId', 'visitOn', 'careType', 'createdAt'];
const WINDOW_VISIT_FIELDS = [
  ...WINDOW_VISIT_LIGHT,
  'vitals.bpSystolic',
  'vitals.bpDiastolic',
  'vitals.weightKg',
  'vitals.hb',
  'vitals.urineAlbumin',
  'details.fetalHeartRate',
  'details.fundalHeightCm',
  'details.presentation',
].join(' ');

const PLAN_LIGHT_FIELDS = '_id patientId current status closed.reason closed.at bookedOn basis.edd basis.eddSource eddReview.toEdd';

// Care plans in full (Care section): everything the plan engine needs, without item history, notes, results,
// reasons or any other text typed by staff. Of the plan log only the time and the action of each entry are
// kept (E4 needs the day a plan was paused): never its text or who wrote it.
const PLAN_FULL_EXCLUDE = [
  // Never read by the plan engine on a preview (it only writes them) nor by a card.
  'items.name',
  'items.rev',
  'items.revByName',
  'items.revAt',
  'items.clientRequestId',
  'items.added',
  'items.notNeeded',
  'log.text',
  'log.by',
  'log.byName',
  'log.auto',
  'items.history',
  'items.note',
  'items.done.result',
  'items.done.note',
  'items.patientText',
  'items.source',
  'items.manualDate.reason',
  'items.forceInclude.reason',
  'closed.note',
]
  .map((f) => `-${f}`)
  .join(' ');

// Visits of the last 60 days are always loaded (visit gaps, 36-week checks), whatever the period.
export const WINDOW_DAYS_BEFORE_TODAY = 60;
/** The first day of the visits loaded for a period (the same for a page of numbers and its patient lists). */
export function windowFromOf(period, today) {
  const back = addDays(today, -WINDOW_DAYS_BEFORE_TODAY);
  return period.from < back ? period.from : back;
}

/** What a request may ask to load (metrics list theirs in `needs`). */
// 'visitVitals': the window's visits also carry their vitals and examination findings (only the cards that read
// them ask for it; the others get the visits' dates and types only, which is much less to load).
// 'deliveries': the delivery notes a doctor confirmed, delivered around the period (Deliveries tab).
export const NEEDS = ['patients', 'visitSummary', 'windowVisits', 'visitVitals', 'cancelled', 'plansLight', 'plansFull', 'template', 'g2Rows', 'deliveries'];

/**
 * One hospital's rows. opts: { now, today, windowFrom, periodFrom, periodTo, needs }.
 * Returns { tenantId, patients, visitSummary, windowVisits, cancelledVisits, plans, fullPlans, template, g2Rows,
 * deliveries } (lean rows; empty when not needed). g2Rows are for metrics/sexAtBirth.js only (card G2).
 */
export async function loadHospital(tenantId, { now, today, windowFrom, periodFrom, periodTo, needs }) {
  if (!(tenantId instanceof mongoose.Types.ObjectId)) throw new Error('loadHospital needs the hospital id as an ObjectId');
  const need = new Set(needs);
  for (const n of need) if (!NEEDS.includes(n)) throw new Error(`Unknown analytics load: ${n}`);
  const data = { tenantId, patients: [], visitSummary: [], windowVisits: [], cancelledVisits: [], plans: [], fullPlans: [], template: null, g2Rows: [], deliveries: [] };
  const jobs = [];

  if (need.has('patients')) {
    // (records marked as a duplicate of another are left out: one person counts once, under her main record)
    jobs.push(
      Patient.find({ tenantId, ...NOT_DUPLICATE })
        .select(PATIENT_FIELDS)
        .lean()
        .then((rows) => {
          data.patients = rows;
        }),
    );
  }
  if (need.has('visitSummary')) {
    // One row per patient over all her active visits: the first (by date, then time saved) and the latest.
    jobs.push(
      Visit.aggregate([
        { $match: { tenantId, status: 'active' } },
        { $sort: { patientId: 1, visitOn: -1, createdAt: -1 } },
        {
          $group: {
            _id: '$patientId',
            firstId: { $last: '$_id' },
            firstOn: { $last: '$visitOn' },
            firstCareType: { $last: '$careType' },
            lastOn: { $first: '$visitOn' },
            lastNextVisitOn: { $first: '$details.nextVisitOn' },
            firstAntenatalOn: { $min: { $cond: [{ $eq: ['$careType', 'antenatal'] }, '$visitOn', null] } },
            antenatalVisits: { $sum: { $cond: [{ $eq: ['$careType', 'antenatal'] }, 1, 0] } },
          },
        },
      ])
        .allowDiskUse(true)
        .then((rows) => {
          data.visitSummary = rows;
        }),
    );
  }
  if (need.has('windowVisits')) {
    jobs.push(
      Visit.find({ tenantId, status: 'active', visitOn: { $gte: windowFrom, $lte: today } })
        .select(need.has('visitVitals') ? WINDOW_VISIT_FIELDS : WINDOW_VISIT_LIGHT.join(' '))
        .lean()
        .then((rows) => {
          data.windowVisits = rows;
        }),
    );
  }
  if (need.has('cancelled')) {
    // Visits marked "entered in error" in the period (Records to tidy up). patientId is read so that doctors
    // count only their visible patients, and "My patients" only theirs; visitOn so that the hospital admin's
    // view (one load for four periods, analytics/adminView.js) can count each period.
    jobs.push(
      Visit.find({ tenantId, status: 'cancelled', visitOn: { $gte: periodFrom, $lte: periodTo } })
        .select('_id patientId visitOn')
        .lean()
        .then((rows) => {
          data.cancelledVisits = rows;
        }),
    );
  }
  if (need.has('plansLight')) {
    jobs.push(
      CarePlan.find({ tenantId, careType: 'antenatal' })
        .select(PLAN_LIGHT_FIELDS)
        .lean()
        .then((rows) => {
          data.plans = rows;
        }),
    );
  }
  if (need.has('plansFull')) {
    // Current plans, and plans closed on or after the first day of the period (E4 "done by the due date").
    // A current ACTIVE plan is always worked out again before it is read (populations.js currentPlansNow,
    // previewSync: derivePlan writes every item's auto values from the plan and the patient alone), so its stored
    // auto values are not loaded – they are the largest part of a plan. A paused plan (a preview may leave it as
    // it is) and a closed plan (read as stored) are loaded with them.
    const closedFrom = hospitalDayStart(periodFrom);
    const active = CarePlan.find({ tenantId, careType: 'antenatal', current: true, status: 'active' })
      .select(`${PLAN_FULL_EXCLUDE} -items.auto`)
      .lean();
    const others = CarePlan.find({
      tenantId,
      careType: 'antenatal',
      $or: [
        { current: true, status: { $ne: 'active' } },
        { current: { $ne: true }, 'closed.at': { $gte: closedFrom } },
      ],
    })
      .select(PLAN_FULL_EXCLUDE)
      .lean();
    jobs.push(
      Promise.all([active, others]).then(([a, b]) => {
        data.fullPlans = [...a, ...b];
      }),
    );
  }
  if (need.has('template')) {
    // The hospital's standard antenatal template: item names and "applies when" (care-plan cards), and the
    // grand multipara rule (mothers' profile). Template content only, nothing about a patient.
    jobs.push(
      CarePlanTemplate.findOne({ tenantId, careType: 'antenatal', kind: 'standard' })
        .select('items.key items.name items.appliesWhen riskRules.key riskRules.factor riskRules.op riskRules.value')
        .lean()
        .then((row) => {
          data.template = row ?? null;
        }),
    );
  }
  if (need.has('g2Rows')) {
    // Babies already born, with the sex recorded at birth: read ONLY by metrics/sexAtBirth.js (card G2). A
    // value saved on any other type of record, or on a baby whose birth time is in the future, is never read.
    jobs.push(
      Patient.find({ tenantId, careType: 'newborn', 'newborn.birthAt': { $ne: null, $lte: now }, ...NOT_DUPLICATE })
        .select('_id newborn.sex newborn.birthAt newborn.mother assignedDoctor sensitive')
        .lean()
        .then((rows) => {
          data.g2Rows = rows;
        }),
    );
  }
  if (need.has('deliveries')) {
    // Delivery notes a doctor CONFIRMED (status 'signed'): a draft, and a note marked "entered in error" (status
    // 'cancelled'), are never counted. The time of delivery is kept on the note as an ISO date-time text (a Date
    // from older data is matched too); two days either side of the period are loaded and the cards keep the notes
    // whose hospital date is in the period. Every query has the hospital's id.
    const from = addDays(utcDay(periodFrom), -DELIVERY_MARGIN_DAYS);
    const to = addDays(utcDay(periodTo), DELIVERY_MARGIN_DAYS + 1);
    jobs.push(
      ClinicalDocument.find({
        tenantId,
        kind: 'delivery',
        status: 'signed',
        $or: [{ 'content.deliveredAt': { $gte: isoDay(from), $lt: isoDay(to) } }, { 'content.deliveredAt': { $gte: from, $lt: to } }],
      })
        .select(DELIVERY_FIELDS)
        .lean()
        .then((rows) => {
          data.deliveries = rows;
        }),
    );
  }
  // Records marked as duplicates (usually none): their visits are read as their main record's – see underMainRecord.
  let mainOf = null;
  if (need.has('visitSummary') || need.has('windowVisits') || need.has('cancelled') || need.has('deliveries')) {
    jobs.push(
      mainRecordOf(tenantId).then((map) => {
        mainOf = map;
      }),
    );
  }
  await Promise.all(jobs);
  if (mainOf?.size) underMainRecord(data, mainOf);
  return data;
}

/**
 * A visit made on a record marked as a duplicate took place, and it was hers: it is counted under her main record
 * (the duplicate itself is not among the patients – one person counts once). Only the loaded rows are read that way;
 * nothing is changed in the database. mainOf: Map "<duplicate's id>" → "<main record's id>".
 * The monthly report counts visits by the same rule (reports/monthlyReport.js). A delivery note on a duplicate is
 * counted the same way, under her main record.
 */
export function underMainRecord(data, mainOf) {
  const mainId = (id) => {
    const main = mainOf.get(String(id));
    return main ? new mongoose.Types.ObjectId(main) : null;
  };
  const asMain = (v) => {
    const main = mainId(v.patientId);
    return main ? { ...v, patientId: main } : v;
  };
  data.windowVisits = data.windowVisits.map(asMain);
  data.cancelledVisits = data.cancelledVisits.map(asMain);
  data.deliveries = (data.deliveries ?? []).map(asMain);
  // One row per person: a duplicate's row is joined with its main record's (the first and the latest visit of both)
  if (data.visitSummary.some((s) => mainOf.has(String(s._id)))) {
    const rows = new Map();
    const earliest = (a, b) => (a && b ? (a <= b ? a : b) : (a ?? b ?? null));
    // The main record's own rows first, so that it wins when two visits are on the same day
    for (const s of [...data.visitSummary].sort((a, b) => Number(mainOf.has(String(a._id))) - Number(mainOf.has(String(b._id))))) {
      const id = mainId(s._id) ?? s._id;
      const had = rows.get(String(id));
      if (!had) {
        rows.set(String(id), { ...s, _id: id });
        continue;
      }
      const first = s.firstOn < had.firstOn ? s : had;
      const last = s.lastOn > had.lastOn ? s : had;
      rows.set(String(id), {
        _id: id,
        firstId: first.firstId,
        firstOn: first.firstOn,
        firstCareType: first.firstCareType,
        lastOn: last.lastOn,
        lastNextVisitOn: last.lastNextVisitOn,
        firstAntenatalOn: earliest(had.firstAntenatalOn, s.firstAntenatalOn),
        antenatalVisits: (had.antenatalVisits ?? 0) + (s.antenatalVisits ?? 0),
      });
    }
    data.visitSummary = [...rows.values()];
  }
}
