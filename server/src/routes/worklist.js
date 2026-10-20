import { Router } from 'express';
import { z } from 'zod';
import { bookedAhead } from '../appointments/appointmentService.js';
import { addDays, hospitalDayStart, hospitalToday, isoDay } from '../careplans/dates.js';
import { babyVaccinations, overduePlanItems } from '../careplans/overdue.js';
import { carePlanSummaryFor, planCtx } from '../careplans/plansService.js';
import { refreshDueRisks } from '../careplans/templatesService.js';
import { Admission } from '../models/Admission.js';
import { CarePlan } from '../models/CarePlan.js';
import { LabOrder } from '../models/LabOrder.js';
import { hasRole } from '../models/Membership.js';
import { Patient, gestationalAge } from '../models/Patient.js';
import { IN_USE } from '../patients/deathRules.js';
import { User } from '../models/User.js';
import { Arrival } from '../models/Arrival.js';
import { Visit } from '../models/Visit.js';
import { redFlagCareTypes, redFlagsForPatients } from '../redflags/redFlagService.js';
import { VACCINATION_LIST_DAYS } from '../reminders/reminderRules.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { parse } from '../utils/validate.js';
import { config } from '../config.js';
import { cachedWorklist } from '../utils/worklistCache.js';

// Today's worklist (Smart features, step 1): /api/worklist. Who needs attention today, for doctors, RMOs and
// nurses – only patients whose medical details the person may see:
//  - red flags: from each patient's latest visit, the lab results reported in this pregnancy or episode of care and,
//    for a patient in hospital, the nursing chart (and today's weeks). Only patients whose type of care has a rule
//    are checked (rules.careTypes says which – the page names them and the types that are not checked). A patient
//    in hospital is listed as long as she has a flag, and so is a pregnancy patient for the flags of her latest
//    visit; every other flag – from a lab result alone, or of a patient who is not in pregnancy care – is listed for
//    RED_FLAG_LIST_DAYS after the value was recorded (her record keeps showing the flag after that);
//  - care-plan items overdue, due now or needing a decision, and missed visits – of pregnancy care, and of
//    pregnancy-loss care (5 Oct 2026: no automatic message goes out from a pregnancy-loss plan, so this list is where
//    staff see an overdue hCG test after a molar pregnancy and call her) for the plans with a test, visit or other
//    item due in the last RED_FLAG_LIST_DAYS days or later;
//  - the visits started today;
//  - babies with a vaccination that became overdue in the last six weeks (4 Oct 2026; VACCINATION_LIST_DAYS), each
//    with all its overdue vaccines by name – reception gets the same babies in general words only, on its own call
//    list (routes/today.js). Babies overdue for longer stay on their care plan, not on this daily list.
// scope=mine: the doctor's own and unassigned patients (the default for doctors); all: every patient.
// Audited as WORKLIST_VIEWED with counts only (no names, no medical details).

const ROLES = ['doctor', 'rmo', 'nurse'];
const MAX_PATIENTS = 500; // a day's list for one hospital; beyond this the list says it is cut short
const MAX_BABIES = 200; // babies on the "Vaccinations overdue" list; beyond this the list says it is cut short
// Outside pregnancy care (after delivery, babies …) nothing ends an episode by itself, and in pregnancy care a lab
// value stays the latest one until the lab repeats the test (an OGTT is never repeated) – so the daily list would
// only grow: a patient who is not in hospital is listed for six weeks after the flagged value was recorded, except
// for the flags of a pregnancy patient's latest visit, which stay until her next visit as before. The website says
// "6 weeks" under the list (redFlagFormat.js listedText).
export const RED_FLAG_LIST_DAYS = 42;
const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');

export const worklistRouter = Router();

worklistRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...ROLES)) throw forbidden('The worklist is for doctors, RMOs and nurses.');
  next();
});

const querySchema = z.object({ scope: z.enum(['mine', 'all']).optional() });

// Runs fn over the list, a few at a time (each care-plan summary reads the plan and may bring it up to date).
async function inBatches(list, size, fn) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(...(await Promise.all(list.slice(i, i + size).map(fn))));
  return out;
}

worklistRouter.get('/', async (req, res) => {
  const q = parse(querySchema, req.query);
  const data = await cachedWorklist(`${req.user._id}|${req.tenantId}|${q.scope ?? ''}`, config.WORKLIST_CACHE_SECONDS, () => worklistFor(req, q.scope));
  await audit(req, 'WORKLIST_VIEWED', {
    details: { scope: data.scope, redFlags: data.redFlags.length, carePlan: data.carePlan.length, seenToday: data.seenToday.length, vaccinations: data.vaccinationsOverdue.length },
  });
  res.json(data);
});

/**
 * The worklist's lists for this person (scope 'mine' | 'all', or undefined for their default) – also read by the
 * Today page's AI brief (routes/aiBrief.js). The caller checks the role; not audited here.
 */
export async function worklistFor(req, askedScope) {
  const isDoctor = hasRole(req.membership, 'doctor');
  const scope = askedScope ?? (isDoctor ? 'mine' : 'all');
  const now = req.now ?? new Date();
  const today = hospitalToday(now);
  // The scope, and never a record marked as a duplicate of another (she is on her main record's lists), nor a record
  // closed after a death (IN_USE)
  const scopeFilter = { ...(scope === 'mine' ? { assignedDoctor: { $in: [req.user._id, null] } } : {}), ...IN_USE };
  await refreshDueRisks(req.tenantId);

  // Today's visits (any type of care), then the antenatal patients in scope plus anyone seen today.
  const todays = await Visit.find({ tenantId: req.tenantId, visitOn: today, status: 'active' }, 'patientId createdAt createdByName vitals.rev details.rev prescription.items.drug').lean();
  const seenIds = [...new Set(todays.map((v) => String(v.patientId)))];
  const found = await Patient.find({ tenantId: req.tenantId, $or: [{ careType: 'antenatal', ...scopeFilter }, { _id: { $in: seenIds }, ...scopeFilter }] })
    .sort({ 'pregnancy.effectiveEdd': 1 })
    .limit(MAX_PATIENTS + 1);
  const patients = found.slice(0, MAX_PATIENTS).filter((p) => patientAccess(req, p).view.has('pregnancy'));
  const byId = new Map(patients.map((p) => [String(p._id), p]));

  // For the red flags only: patients of the other types of care that have a rule (after delivery, babies …) who are
  // in hospital now, or had a visit, a lab report or (pregnancy-loss care) a finding recorded on the record in the
  // last RED_FLAG_LIST_DAYS days – the most recently seen first.
  const otherTypes = (await redFlagCareTypes(req.tenantId)).filter((t) => t !== 'antenatal');
  let others = [];
  if (otherTypes.length) {
    const flagSince = addDays(today, -RED_FLAG_LIST_DAYS);
    const [recentVisits, recentLabs, inHospital, recentFindings] = await Promise.all([
      Visit.distinct('patientId', { tenantId: req.tenantId, status: 'active', visitOn: { $gte: flagSince }, careType: { $in: otherTypes } }),
      LabOrder.distinct('patientId', { tenantId: req.tenantId, status: { $in: ['reported', 'reviewed'] }, 'reported.at': { $gte: hospitalDayStart(flagSince) } }),
      Admission.distinct('patientId', { tenantId: req.tenantId, status: 'admitted' }),
      // Pregnancy-loss care: a finding recorded on her record in that time (signs of rupture, heavy bleeding … –
      // a flag from her record needs no visit)
      otherTypes.includes('abortion')
        ? Patient.distinct('_id', { tenantId: req.tenantId, careType: 'abortion', 'abortion.findings': { $elemMatch: { endedAt: null, at: { $gte: hospitalDayStart(flagSince) } } } })
        : [],
    ]);
    const otherIds = [...new Set([...recentVisits, ...recentLabs, ...inHospital, ...recentFindings].map(String))].filter((id) => !byId.has(id));
    if (otherIds.length) {
      others = await Patient.find({ tenantId: req.tenantId, _id: { $in: otherIds }, careType: { $in: otherTypes }, ...scopeFilter })
        .sort({ lastVisitOn: -1 })
        .limit(MAX_PATIENTS + 1);
    }
  }
  const cut = found.length > MAX_PATIENTS || others.length > MAX_PATIENTS;
  const flagPatients = [...patients, ...others.slice(0, MAX_PATIENTS).filter((p) => patientAccess(req, p).view.has('pregnancy'))];
  const flagById = new Map(flagPatients.map((p) => [String(p._id), p]));

  const doctorIds = [...new Set(flagPatients.map((p) => p.assignedDoctor && String(p.assignedDoctor)).filter(Boolean))];
  const doctors = new Map((await User.find({ _id: { $in: doctorIds } }, { name: 1 }).lean()).map((u) => [String(u._id), u.name]));
  const who = (p) => {
    const ga = gestationalAge(p, now);
    return {
      id: String(p._id),
      fullName: p.fullName,
      mrn: p.mrn,
      careType: p.careType,
      gestationalAge: p.careType === 'antenatal' && ga ? { weeks: ga.weeks, days: ga.days } : null,
      risk: p.careType === 'antenatal' && p.risk?.level ? { level: p.risk.level } : null,
      assignedDoctorName: p.assignedDoctor ? (doctors.get(String(p.assignedDoctor)) ?? null) : null,
    };
  };

  const antenatal = patients.filter((p) => p.careType === 'antenatal');
  const { byPatient, rules } = await redFlagsForPatients(planCtx(req), flagPatients, { recentDays: RED_FLAG_LIST_DAYS });
  const redFlags = [...byPatient.entries()]
    .map(([id, f]) => ({ patient: who(flagById.get(id)), ...f }))
    .sort((a, b) => {
      const urgent = (x) => x.flags.filter((f) => f.level === 'urgent').length;
      return urgent(b) - urgent(a) || b.flags.length - a.flags.length;
    });

  // Pregnancy-loss care: the patients in scope whose current plan has an open item that applies to her, due in the
  // last RED_FLAG_LIST_DAYS days or later (a plan whose items were all due long ago is for the doctor to close, not
  // a daily list). Their summaries are read as for pregnancy care.
  const lossPlans = await CarePlan.distinct('patientId', {
    tenantId: req.tenantId,
    careType: 'abortion',
    current: true,
    status: 'active',
    items: { $elemMatch: { state: 'open', 'auto.phase': { $nin: ['not_applicable', 'inactive'] }, 'auto.dueBy': { $gte: addDays(today, -RED_FLAG_LIST_DAYS) } } },
  });
  const lossFound = lossPlans.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: lossPlans }, careType: 'abortion', ...scopeFilter }).limit(MAX_PATIENTS + 1) : [];
  const lossPatients = lossFound.slice(0, MAX_PATIENTS).filter((p) => patientAccess(req, p).view.has('pregnancy'));
  const lossDoctors = [...new Set(lossPatients.map((p) => p.assignedDoctor && String(p.assignedDoctor)).filter((id) => id && !doctors.has(id)))];
  for (const u of lossDoctors.length ? await User.find({ _id: { $in: lossDoctors } }, { name: 1 }).lean() : []) doctors.set(String(u._id), u.name);

  const ctx = planCtx(req);
  const summaries = await inBatches([...antenatal, ...lossPatients], 16, async (p) => ({ p, s: await carePlanSummaryFor(ctx, p) }));
  const carePlan = summaries
    .filter(({ s }) => s?.exists && s.status === 'active' && s.counts && s.counts.overdue + s.counts.due + s.counts.needsDecision + s.counts.missedVisits > 0)
    .map(({ p, s }) => ({ patient: who(p), counts: s.counts, top: s.top, next: s.next }))
    .sort((a, b) => b.counts.overdue - a.counts.overdue || b.counts.missedVisits - a.counts.missedVisits || b.counts.due - a.counts.due);

  const seenToday = todays
    .filter((v) => byId.has(String(v.patientId)))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((v) => ({
      patient: who(byId.get(String(v.patientId))),
      visitId: String(v._id),
      startedAt: v.createdAt,
      startedByName: v.createdByName,
      vitalsSaved: (v.vitals?.rev ?? 0) > 0,
      detailsSaved: (v.details?.rev ?? 0) > 0,
      medicines: v.prescription?.items?.length ?? 0,
      flagged: byPatient.has(String(v.patientId)),
    }));

  // Marked as arrived today and no visit started yet: waiting to be seen (nurses start the visit).
  const startedToday = new Set(todays.map((v) => String(v.patientId)));
  const arrived = (await Arrival.find({ tenantId: req.tenantId, on: today }, { patientId: 1, at: 1 }).sort({ at: 1 }).lean()).filter((a) => !startedToday.has(String(a.patientId)));
  const waitingDocs = arrived.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: arrived.map((a) => a.patientId) }, ...scopeFilter }) : [];
  const waitingOk = new Map(waitingDocs.filter((p) => patientAccess(req, p).view.has('pregnancy')).map((p) => [String(p._id), p]));
  const extraDoctors = [...new Set([...waitingOk.values()].map((p) => p.assignedDoctor && String(p.assignedDoctor)).filter((id) => id && !doctors.has(id)))];
  for (const u of extraDoctors.length ? await User.find({ _id: { $in: extraDoctors } }, { name: 1 }).lean() : []) doctors.set(String(u._id), u.name);
  const waiting = arrived.filter((a) => waitingOk.has(String(a.patientId))).map((a) => ({ patient: who(waitingOk.get(String(a.patientId))), arrivedAt: a.at }));

  // Babies with a vaccination that became overdue in the last VACCINATION_LIST_DAYS days: those whose medical details
  // this person may see, the most recently overdue first, each with ALL its overdue vaccines by name (also older
  // ones), the phone number on the baby's record and the day booked (if any). If the list is cut short, the most
  // recently overdue babies are the ones kept (overduePlanItems orders before it cuts).
  const babyIds = scope === 'mine' ? (await Patient.find({ tenantId: req.tenantId, careType: 'newborn', ...scopeFilter }, { _id: 1 }).lean()).map((p) => p._id) : null;
  const overdue = await overduePlanItems(req.tenantId, { now, kindsFor: babyVaccinations, careTypes: ['newborn'], patientIds: babyIds, overdueSince: addDays(today, -VACCINATION_LIST_DAYS), withOlder: true, limit: MAX_BABIES });
  const babies = overdue.rows.filter((r) => patientAccess(req, r.patient).view.has('pregnancy'));
  const babyDoctors = [...new Set(babies.map((r) => r.patient.assignedDoctor && String(r.patient.assignedDoctor)).filter((id) => id && !doctors.has(id)))];
  for (const u of babyDoctors.length ? await User.find({ _id: { $in: babyDoctors } }, { name: 1 }).lean() : []) doctors.set(String(u._id), u.name);
  const booked = await bookedAhead(req.tenantId, babies.map((r) => r.patient._id), today);
  const latest = (r) => r.items[r.items.length - 1].dueBy;
  const vaccinationsOverdue = babies
    .sort((a, b) => latest(b) - latest(a) || a.patient.fullName.localeCompare(b.patient.fullName))
    .map((r) => ({
      patient: who(r.patient),
      phone: r.patient.phone ?? '',
      items: r.items.map((it) => ({ itemId: it.itemId, name: it.name, dueBy: it.dueBy })),
      draft: !r.approved, // the plan was built from a schedule no doctor has approved yet
      bookedFor: isoDay(booked.get(String(r.patient._id)) ?? null),
    }));

  return { today, scope, canChooseScope: isDoctor, redFlags, carePlan, seenToday, waiting, vaccinationsOverdue, rules, cut: cut || overdue.cut || lossFound.length > MAX_PATIENTS };
}
