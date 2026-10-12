import { z } from 'zod';
import { Router } from 'express';
import { addDays, gaOn, hospitalToday, isoDay, sameDay, timeIn, utcDay } from '../careplans/dates.js';
import { markDoneAtVisit, planCtx, syncPlanSafely, visitPlanInfo } from '../careplans/plansService.js';
import { refreshPatientRiskSafely } from '../careplans/templatesService.js';
import { eddInUse, suggestedFindings } from '../patients/pregnancyFindings.js';
import { isDuplicate, refuseNewOnDuplicate } from '../patients/duplicateRules.js';
import { isClosed, refuseNewOnClosed } from '../patients/deathRules.js';
import { hasRole } from '../models/Membership.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { AuditLog } from '../models/AuditLog.js';
import { audit } from '../utils/audit.js';
import { updateLastVisit } from '../utils/lastVisit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { loadPatientForPlan } from '../utils/patientLookup.js';
import { parse } from '../utils/validate.js';
import { checkKey, checkPrescription } from '../ai/prescriptionCheck.js';
import { cancelForVisit, syncNextVisit, visitBooking } from '../appointments/appointmentService.js';
import { billVisitCancelled, billVisitStarted } from '../billing/hooks.js';
import { redFlagsForVisit } from '../redflags/redFlagService.js';
import { designFor } from '../visits/designs.js';
import { mobileNumber } from '../reminders/reminderService.js';
import { PRINT_COPIES, visitParams, visitSchemas } from '../visits/visitSchemas.js';
import { sendDocument, whatsappStatus } from '../visits/whatsappSender.js';
import { rxItemView, visitSummary, visitView } from '../visits/visitView.js';

// A patient's visits (Feature 8): /api/patients/:id/visits. Mounted inside the patients router, after its role
// gate. Who may do what follows the patient access rules (utils/patientAccess.js):
//  - see visits: those who may see the medical details (the doctor's private note: those who may see
//    doctors' notes – not nurses);
//  - start a visit and record vital signs: nurses (not on sensitive records), the treating or an unassigned
//    doctor, RMOs;
//  - write the details, the prescription, tick care-plan items, mark a visit entered in error: the treating or
//    an unassigned doctor, RMOs.
// Each part of a visit is saved on its own, only if it is still the version the person edited (rev). The
// audit log gets ids and part names only – never what was written.
// A record marked as a duplicate of another takes no new visit, and its visits can no longer be written in (vital
// signs, details, prescription): the server refuses and names the main record. They can still be read, printed,
// signed, corrected below the signature and marked entered in error.
// Signing (the treating or an unassigned doctor, or an RMO) locks the visit: nothing in it can be changed any more.
// Corrections and additions are then added below it (nurses too) and can never be changed or removed. A signed
// visit can still be printed, and still be marked entered in error (with a reason).

export const visitsRouter = Router({ mergeParams: true });

const MAX_WHATSAPP_PDF_BYTES = 5 * 1024 * 1024;

const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const conflict = (message, code = 'CONFLICT') => new HttpError(409, message, code);
const invalid = (fields) => Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });
const CLINICAL_ROLES = ['doctor', 'rmo', 'nurse'];
const PART_WORDS = { vitals: 'the vital signs', details: 'the visit details', prescription: 'the prescription' };
const MAX_PAST_DAYS = 365;

function visitAccess(req, patient) {
  const a = patientAccess(req, patient);
  return { view: a.view.has('pregnancy'), vitals: a.recordVitals, edit: a.editClinical, notes: a.viewNotes, level: a.level, emergencyNote: a.emergencyNote };
}

function assertCanView(req, patient) {
  const a = visitAccess(req, patient);
  if (a.view) return a;
  if (!hasRole(req.membership, ...CLINICAL_ROLES)) throw forbidden("Your role doesn't include visits.");
  throw forbidden('This is a sensitive record: visits are only visible to the treating doctor and RMOs.');
}

function assertCanRecordVitals(req, patient) {
  const a = assertCanView(req, patient);
  if (a.vitals) return a;
  if (a.emergencyNote) throw forbidden("This is another doctor's patient: you can view her visits but not add to them.");
  throw forbidden("Only nurses, the patient's doctor and RMOs record visits.");
}

function assertCanEdit(req, patient) {
  const a = assertCanView(req, patient);
  if (a.edit) return a;
  if (a.emergencyNote) throw forbidden("This is another doctor's patient: you can view her visits but not change them.");
  throw forbidden("Only the patient's doctor or an RMO can write the visit details and prescriptions.");
}

async function findVisit(req, patient) {
  const { visitId } = parse(visitParams, req.params);
  const visit = await Visit.findOne({ _id: visitId, tenantId: req.tenantId, patientId: patient._id });
  if (!visit) throw new HttpError(404, 'Visit not found.', 'NOT_FOUND');
  return visit;
}

const assertActive = (visit) => {
  if (visit.status === 'cancelled') throw conflict('This visit was marked as entered in error, so it can no longer be changed.');
};

const assertNotSigned = (visit) => {
  if (visit.signed) {
    throw conflict(`This visit was signed by ${visit.signed.byName} at ${timeIn(visit.signed.at)}, so it can no longer be changed. Add a correction below it instead.`, 'VISIT_SIGNED');
  }
};

// Free text is checked for words about the baby's sex, except for newborns (their sex is recorded after birth).
const schemasFor = (patient) => visitSchemas({ pcpndt: patient.careType !== 'newborn' });

const ids = (patient, visit, extra = {}) => ({ patientId: String(patient._id), mrn: patient.mrn, ...(visit ? { visitId: String(visit._id) } : {}), ...extra });

// Someone saved the same part meanwhile: say who and when; the person reloads and makes the change again.
function partChanged(visit, part) {
  const p = visit[part] ?? {};
  const when = p.at ? ` at ${timeIn(p.at)}` : '';
  return conflict(`${p.byName ?? 'Someone'} saved ${PART_WORDS[part]}${when}, after you opened this visit. Reload to see the latest, then make your change again.`);
}

// Saves one part atomically: only if it is still the version the person edited, and the visit is not cancelled.
async function savePart(req, patient, visit, part, { rev, ...data }) {
  const set = Object.fromEntries(Object.entries(data).map(([k, v]) => [`${part}.${k}`, v]));
  Object.assign(set, { [`${part}.by`]: req.user._id, [`${part}.byName`]: req.user.name, [`${part}.at`]: req.now ?? new Date() });
  const r = await Visit.updateOne(
    { _id: visit._id, tenantId: req.tenantId, patientId: patient._id, status: 'active', signed: null, [`${part}.rev`]: rev },
    { $set: set, $inc: { [`${part}.rev`]: 1 } },
    { runValidators: true },
  );
  if (r.matchedCount === 1) return;
  const latest = await Visit.findOne({ _id: visit._id, tenantId: req.tenantId, patientId: patient._id });
  assertActive(latest);
  assertNotSigned(latest);
  throw partChanged(latest, part);
}

// The doctor who signs the printed prescription: whoever saved the prescription, else whoever wrote the doctor's
// notes (always a doctor or an RMO). Their name, professional details and print design – a prescription prints
// in the design of the doctor who wrote it, whoever presses Print. null until one of the two is written.
async function prescriberOf(req, visit) {
  const by = visit.prescription?.by ?? visit.details?.by;
  if (!by) return null;
  const user = await User.findById(by, { name: 1, professional: 1 }).lean();
  if (!user) return null;
  const p = user.professional ?? {};
  return {
    id: String(user._id),
    name: user.name,
    professional: { qualification: p.qualification ?? '', registrationNumber: p.registrationNumber ?? '', council: p.council ?? '' },
    design: await designFor(req.tenant, by),
  };
}

// ---------- The list ----------

visitsRouter.get('/', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const access = assertCanView(req, patient);
  const visits = await Visit.find({ tenantId: req.tenantId, patientId: patient._id }).sort({ visitOn: -1, createdAt: -1 }).limit(200);
  await audit(req, 'VISITS_VIEWED', { details: ids(patient, null, { access: access.level }) });
  res.json({
    visits: visits.map((v) => visitSummary(v, { notes: access.notes })),
    today: hospitalToday(req.now),
    // (a record marked as a duplicate, or closed after a death, takes no new visit)
    canCreate: access.vitals && !isDuplicate(patient) && !isClosed(patient),
    canEdit: access.edit,
  });
});

// A new visit (today unless a date is given). 201 with the visit; 200 when the same request was already saved.
visitsRouter.post('/', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const access = assertCanRecordVitals(req, patient);
  const body = parse(schemasFor(patient).create, req.body);
  const same = await Visit.findOne({ tenantId: req.tenantId, clientRequestId: body.clientRequestId });
  if (same) {
    if (!same.patientId.equals(patient._id)) throw conflict('Please reload the page and try again.');
    return res.status(200).json({ visit: visitView(same, { notes: access.notes }) });
  }
  refuseNewOnDuplicate(patient, 'visit');
  refuseNewOnClosed(patient, 'visit'); // a closed record takes no new visit (one already started can be finished)
  const today = hospitalToday(req.now);
  const visitOn = utcDay(body.visitOn) ?? today;
  if (visitOn > today) throw invalid({ visitOn: "A visit can't be in the future." });
  if (visitOn < addDays(today, -MAX_PAST_DAYS)) throw invalid({ visitOn: 'This date is more than a year ago – please check it.' });
  let visit;
  try {
    visit = await Visit.create({
      tenantId: req.tenantId,
      patientId: patient._id,
      visitOn,
      careType: patient.careType,
      clientRequestId: body.clientRequestId,
      createdBy: req.user._id,
      createdByName: req.user.name,
    });
  } catch (e) {
    if (e?.code !== 11000) throw e;
    // The same request arrived twice at the same moment: the first one is kept.
    const first = await Visit.findOne({ tenantId: req.tenantId, clientRequestId: body.clientRequestId });
    if (!first?.patientId.equals(patient._id)) throw conflict('Please reload the page and try again.');
    return res.status(200).json({ visit: visitView(first, { notes: access.notes }) });
  }
  await updateLastVisit(req.tenantId, patient._id);
  await audit(req, 'VISIT_CREATED', { details: ids(patient, visit) });
  await billVisitStarted(req, patient, visit); // billing: the consultation
  res.status(201).json({ visit: visitView(visit, { notes: access.notes }) });
});

// ---------- One visit ----------

// What this person may do on this visit's page. canEdit / canRecordVitals: change it (never once it is signed);
// canSign: sign and finish it; canAddAddition: add a correction once it is signed; canCancel: mark it entered in
// error; canCheckPrescription: the AI check before printing.
// duplicate: the record is marked as a duplicate – the visit can no longer be written in (it can still be signed,
// corrected below the signature, printed and marked entered in error).
function visitPageAccess(visit, access, duplicate = false) {
  const open = visit.status === 'active' && !visit.signed;
  const signedActive = visit.status === 'active' && Boolean(visit.signed);
  return {
    canRecordVitals: access.vitals && open && !duplicate,
    canEdit: access.edit && open && !duplicate,
    canViewNotes: access.notes,
    canSign: access.edit && open,
    canAddAddition: access.vitals && signedActive,
    canCancel: access.edit && visit.status === 'active',
    canCheckPrescription: access.edit,
  };
}

/**
 * Findings of this pregnancy that the vital signs saved at this visit suggest, for the doctor or RMO to confirm
 * with one click ("Add to her record") – nothing is ever ticked by itself. Only for those who may edit the
 * clinical details; what is suggested, and when, is decided by suggestedFindings (patients/pregnancyFindings.js –
 * the same check the "Add to her record" request is held to). beforeWeek20: before 20 weeks high blood pressure
 * usually counts as chronic (the screen says so).
 */
function findingOffers(req, patient, visit, access) {
  if (!access.edit || isDuplicate(patient)) return [];
  const edd = eddInUse(patient);
  const ga = edd ? gaOn(edd, visit.visitOn) : null;
  return suggestedFindings(patient, visit, req.now).map((s) => ({ key: s.key, bp: `${s.systolic}/${s.diastolic}`, beforeWeek20: Boolean(ga && ga.weeks < 20) }));
}

// After a visit's vital signs changed (saved, or the visit marked entered in error): her risk level is worked
// out again from the readings of this pregnancy, and the care plan follows it. Never fails the visit's save.
// Returns the patient as saved now, whether the level shown changed (for the message), and whether anything on
// her record changed at all – the reasons, the readings, "override needs review" can change while the level
// stays the same; the page then reads the record again, so the Overview is not left showing the old ones.
async function riskAfterReadings(req, patient) {
  if (patient.careType !== 'antenatal') return { patient, riskChanged: false, recordChanged: false };
  const r = await refreshPatientRiskSafely(planCtx(req), patient._id);
  if (r.saved) await syncPlanSafely(planCtx(req), patient._id);
  return { patient: r.patient ?? patient, riskChanged: r.changed, recordChanged: r.saved };
}

// The visit, the care plan as the visit needs it, the latest earlier prescription (to copy), the prescriber
// (name, registration details and print design), and what this person may do.
async function visitPage(req, patient, visit, access) {
  const [carePlan, previous, prescriber, redFlags, booking] = await Promise.all([
    visitPlanInfo(planCtx(req), patient, visit._id),
    Visit.findOne({
      tenantId: req.tenantId,
      patientId: patient._id,
      _id: { $ne: visit._id },
      status: 'active',
      'prescription.items.0': { $exists: true },
      visitOn: { $lte: visit.visitOn },
    }).sort({ visitOn: -1, createdAt: -1 }),
    prescriberOf(req, visit),
    // Red flags from what was recorded at this visit (the hospital's rules for her type of care; worked out now)
    redFlagsForVisit(planCtx(req), patient, visit),
    // The appointment the next visit booked (appointment booking): day, time and doctor
    visitBooking(req.tenantId, visit, hospitalToday(req.now)),
  ]);
  return {
    ...(redFlags === undefined ? {} : { redFlags }),
    visit: visitView(visit, { notes: access.notes }),
    carePlan,
    previousPrescription: previous ? { visitOn: previous.visitOn, items: previous.prescription.items.map(rxItemView), notes: previous.prescription.notes ?? '' } : null,
    prescriber,
    today: hospitalToday(req.now),
    booking,
    findingOffers: findingOffers(req, patient, visit, access),
    access: visitPageAccess(visit, access, isDuplicate(patient)),
  };
}

visitsRouter.get('/:visitId', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const access = assertCanView(req, patient);
  const visit = await findVisit(req, patient);
  await audit(req, 'VISIT_VIEWED', { details: ids(patient, visit, { access: access.level }) });
  res.json(await visitPage(req, patient, visit, access));
});

// Vital signs and/or the doctor's details, and the care-plan items ticked at this visit.
visitsRouter.patch('/:visitId', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const body = parse(schemasFor(patient).patch, req.body);
  const access = body.vitals ? assertCanRecordVitals(req, patient) : assertCanView(req, patient);
  if (body.details || body.doneItems.length) assertCanEdit(req, patient);
  if (body.details && !access.notes) delete body.details.privateNote; // only those who may read doctors' notes write it
  refuseNewOnDuplicate(patient, 'visit');
  const visit = await findVisit(req, patient);
  assertActive(visit);
  assertNotSigned(visit);

  // Checks before anything is saved.
  const next = body.details?.nextVisitOn;
  if (next && (next <= visit.visitOn || next > addDays(visit.visitOn, 365))) {
    throw invalid({ 'details.nextVisitOn': 'The next visit must be after this visit, and within a year.' });
  }
  // A closed record (a death was recorded on it): a visit already started can be finished, but no next visit is set
  // (it would book an appointment and send messages). A date already there may be cleared.
  if (next && isClosed(patient) && !sameDay(next, visit.details?.nextVisitOn)) {
    throw invalid({ 'details.nextVisitOn': 'This record is closed, so no next visit is set. Leave the next visit empty.' });
  }
  for (const part of ['vitals', 'details']) {
    if (body[part] && body[part].rev !== (visit[part]?.rev ?? 0)) throw partChanged(visit, part);
  }

  // Care-plan items first: if the plan changed meanwhile, nothing of the visit is saved yet.
  if (body.doneItems.length) {
    try {
      await markDoneAtVisit(planCtx(req), patient._id, { visitId: visit._id, on: visit.visitOn, items: body.doneItems });
    } catch (err) {
      if (err instanceof HttpError && [404, 409].includes(err.status)) {
        const why = err.message.replace(/ The latest plan is shown.*$/, '').replace(/\.$/, '');
        throw conflict(`The care plan changed meanwhile: ${why}. Nothing was saved – the care-plan items are shown again; tick them and save.`, 'PLAN_CONFLICT');
      }
      throw err;
    }
  }
  const saved = [];
  const nextBefore = visit.details?.nextVisitOn ?? null;
  for (const part of ['vitals', 'details']) {
    if (!body[part]) continue;
    await savePart(req, patient, visit, part, body[part]);
    saved.push(part);
  }
  if (saved.length) await audit(req, 'VISIT_UPDATED', { details: ids(patient, visit, { sections: saved }) });
  // New vital signs: the risk level is worked out again (lowest haemoglobin, latest blood pressure). Covered by
  // the VISIT_UPDATED entry – a change of level is never audited on its own.
  const risk = saved.includes('vitals') ? await riskAfterReadings(req, patient) : { patient, riskChanged: false, recordChanged: false };
  const latest = await findVisit(req, patient);
  // The next visit books itself (appointment booking): first free slot that day with her doctor, else "needs a time"
  if (saved.includes('details')) {
    try {
      const booked = await syncNextVisit(req, patient, latest, nextBefore);
      if (booked && String(booked.visitId) === String(latest._id) && !nextBefore) {
        await audit(req, 'APPOINTMENT_BOOKED', { details: { appointmentId: String(booked._id), patientId: String(patient._id), doctorId: String(booked.doctorId), date: booked.on.toISOString().slice(0, 10), start: booked.start, fromVisit: true } });
      }
    } catch (err) {
      console.error('The next visit could not be booked:', err?.message ?? err);
    }
  }
  res.json({ ...(await visitPage(req, risk.patient, latest, access)), riskChanged: risk.riskChanged, recordChanged: risk.recordChanged });
});

// The whole prescription (the medicines, in order, and notes).
visitsRouter.put('/:visitId/prescription', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const access = assertCanEdit(req, patient);
  refuseNewOnDuplicate(patient, 'prescription');
  const body = parse(schemasFor(patient).prescription, req.body);
  const visit = await findVisit(req, patient);
  assertActive(visit);
  assertNotSigned(visit);
  await savePart(req, patient, visit, 'prescription', body);
  // How many warnings the doctor went ahead with (the count only – never the medicines or the reasons)
  await audit(req, 'PRESCRIPTION_UPDATED', { details: ids(patient, visit, body.warningReasons.length ? { warningsOverridden: body.warningReasons.length } : {}) });
  const latest = await findVisit(req, patient);
  res.json(await visitPage(req, patient, latest, access));
});

// The AI check before printing or sharing (Smart features). Checks the SAVED prescription; a version already checked
// (nothing found, or printed as it is) is not checked again. Only the treating doctor or an RMO. The answer is shown,
// not saved – the visit keeps only the version checked, how many points and what the doctor did.
visitsRouter.post('/:visitId/ai-check', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  assertCanEdit(req, patient);
  const visit = await findVisit(req, patient);
  if (!visit.prescription?.items?.length) return res.json({ skipped: 'empty', issues: [] });
  const key = checkKey(visit);
  if (visit.aiCheck?.key === key && ['clean', 'printed_anyway'].includes(visit.aiCheck.decision)) return res.json({ skipped: 'checked', key, issues: [] });
  const issues = await checkPrescription(req, patient, visit, ids(patient, visit));
  const decision = issues.length ? 'pending' : 'clean';
  await Visit.updateOne({ _id: visit._id, tenantId: req.tenantId }, { $set: { aiCheck: { key, at: req.now ?? new Date(), issues: issues.length, decision } } });
  res.json({ key, issues });
});

// The doctor printed without changing what the check pointed out: recorded (ids, version and count only).
visitsRouter.post('/:visitId/ai-check/print-anyway', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  assertCanEdit(req, patient);
  const visit = await findVisit(req, patient);
  const { key } = parse(z.object({ key: z.string().max(40) }), req.body);
  if (visit.aiCheck?.key !== key) throw conflict('The prescription changed after it was checked. Press Print or share again.');
  await Visit.updateOne({ _id: visit._id, tenantId: req.tenantId, 'aiCheck.key': key }, { $set: { 'aiCheck.decision': 'printed_anyway' } });
  await audit(req, 'AI_CHECK_PRINTED_ANYWAY', { details: ids(patient, visit, { issues: visit.aiCheck.issues }) });
  res.json({ ok: true });
});

// Sign and finish: only the version the person saw (each part's rev), and only once a doctor or an RMO has written
// the notes or the prescription. From then on the visit can't be changed (see assertNotSigned).
visitsRouter.post('/:visitId/sign', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const access = assertCanEdit(req, patient);
  const { revs } = parse(schemasFor(patient).sign, req.body);
  const visit = await findVisit(req, patient);
  assertActive(visit);
  assertNotSigned(visit);
  if (!(visit.prescription?.by ?? visit.details?.by)) {
    throw conflict('Nothing to sign yet – write and save the notes or the prescription first.', 'NOTHING_TO_SIGN');
  }
  for (const part of ['vitals', 'details', 'prescription']) {
    if (revs[part] !== (visit[part]?.rev ?? 0)) throw partChanged(visit, part);
  }
  const signed = {
    by: req.user._id,
    byName: req.user.name,
    role: hasRole(req.membership, 'doctor') ? 'doctor' : 'rmo',
    at: req.now ?? new Date(),
    revs,
  };
  const r = await Visit.updateOne(
    {
      _id: visit._id,
      tenantId: req.tenantId,
      patientId: patient._id,
      status: 'active',
      signed: null,
      'vitals.rev': visit.vitals?.rev ?? 0,
      'details.rev': visit.details?.rev ?? 0,
      'prescription.rev': visit.prescription?.rev ?? 0,
    },
    { $set: { signed } },
  );
  if (r.matchedCount === 0) {
    // Signed, cancelled or changed at the same moment: say which.
    const latest = await findVisit(req, patient);
    assertActive(latest);
    assertNotSigned(latest);
    throw conflict('Someone saved this visit at the same moment. Reload to see the latest, then sign again.');
  }
  await audit(req, 'VISIT_SIGNED', { details: ids(patient, visit) });
  res.json(await visitPage(req, patient, await findVisit(req, patient), access));
});

// A correction or addition to a signed visit: added with the person's name and the time; never changed or removed.
// Before signing, the visit itself is changed instead.
visitsRouter.post('/:visitId/additions', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const access = assertCanRecordVitals(req, patient);
  const { text } = parse(schemasFor(patient).addition, req.body);
  const visit = await findVisit(req, patient);
  assertActive(visit);
  if (!visit.signed) throw conflict('This visit is not signed yet – change the visit itself instead.', 'NOT_SIGNED');
  const r = await Visit.updateOne(
    { _id: visit._id, tenantId: req.tenantId, patientId: patient._id, status: 'active', signed: { $ne: null } },
    { $push: { additions: { text: text.trim(), by: req.user._id, byName: req.user.name, at: req.now ?? new Date() } } },
    { runValidators: true },
  );
  if (r.matchedCount === 0) assertActive(await findVisit(req, patient));
  await audit(req, 'VISIT_ADDITION_ADDED', { details: ids(patient, visit) });
  res.json(await visitPage(req, patient, await findVisit(req, patient), access));
});

// The visit's history from the audit log: who started, saved, signed, corrected, printed or cancelled it, and when.
// Which parts were saved, never what was written. Views are left out.
const HISTORY_ACTIONS = [
  'VISIT_CREATED',
  'VISIT_UPDATED',
  'PRESCRIPTION_UPDATED',
  'VISIT_SIGNED',
  'VISIT_ADDITION_ADDED',
  'VISIT_CANCELLED',
  'PRESCRIPTION_PRINTED',
  'PRESCRIPTION_PDF_SAVED',
  'VISIT_SUMMARY_PRINTED',
  'VISIT_SUMMARY_PDF_SAVED',
  'AI_CHECK_PRINTED_ANYWAY',
];
visitsRouter.get('/:visitId/history', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  assertCanView(req, patient);
  const visit = await findVisit(req, patient);
  const entries = await AuditLog.find({ tenantId: req.tenantId, 'details.visitId': String(visit._id), action: { $in: HISTORY_ACTIONS } })
    .sort({ createdAt: 1, _id: 1 })
    .limit(300)
    .lean();
  const actorIds = [...new Set(entries.map((e) => e.actor?.toString()).filter(Boolean))];
  const users = await User.find({ _id: { $in: actorIds } }, { name: 1 }).lean();
  const names = new Map(users.map((u) => [u._id.toString(), u.name]));
  res.json({
    history: entries.map((e) => ({
      action: e.action,
      byName: names.get(e.actor?.toString()) ?? e.actorEmail ?? null,
      at: e.createdAt,
      ...(Array.isArray(e.details?.sections) ? { sections: e.details.sections } : {}),
      ...(e.details?.via ? { via: e.details.via } : {}),
    })),
  });
});

// Entered in error: kept, but no longer counted or changed. Care-plan items ticked at it stay done (the
// doctor can reopen them on the Care plan tab).
visitsRouter.post('/:visitId/cancel', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const access = assertCanEdit(req, patient);
  const { reason } = parse(schemasFor(patient).cancel, req.body);
  const visit = await findVisit(req, patient);
  assertActive(visit);
  const r = await Visit.updateOne(
    { _id: visit._id, tenantId: req.tenantId, patientId: patient._id, status: 'active' },
    { $set: { status: 'cancelled', cancelled: { reason: reason.trim(), by: req.user._id, byName: req.user.name, at: req.now ?? new Date() } } },
  );
  if (r.matchedCount === 0) assertActive(await findVisit(req, patient));
  await cancelForVisit(req, visit); // the booking its next visit made goes too
  await billVisitCancelled(req, visit); // and its consultation charge
  await updateLastVisit(req.tenantId, patient._id);
  await audit(req, 'VISIT_CANCELLED', { details: ids(patient, visit) });
  // Its readings no longer count: the risk level is worked out again without them.
  const risk = await riskAfterReadings(req, patient);
  res.json({ ...(await visitPage(req, risk.patient, await findVisit(req, patient), access)), riskChanged: risk.riskChanged, recordChanged: risk.recordChanged });
});

// The prescription or the visit summary was printed, or saved as a PDF – also to send on WhatsApp (recorded in the
// audit log only, never the phone number; both are made in the browser). A printout is signed, so a doctor or an
// RMO must have written the notes or the prescription.
const PRINT_ACTIONS = {
  prescription: { paper: 'PRESCRIPTION_PRINTED', pdf: 'PRESCRIPTION_PDF_SAVED' },
  summary: { paper: 'VISIT_SUMMARY_PRINTED', pdf: 'VISIT_SUMMARY_PDF_SAVED' },
};
visitsRouter.post('/:visitId/printed', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const access = assertCanView(req, patient);
  const { copy, as } = parse(schemasFor(patient).printed, req.body ?? {});
  const visit = await findVisit(req, patient);
  assertActive(visit);
  if (!(visit.prescription?.by ?? visit.details?.by)) {
    throw conflict('Nothing to print yet – a doctor or RMO needs to save the notes or the prescription first.', 'NOTHING_TO_PRINT');
  }
  if (copy === 'prescription' && !visit.prescription?.items?.length) {
    throw new HttpError(400, 'This visit has no medicines – print the visit summary instead.', 'NO_MEDICINES');
  }
  const via = as === 'whatsapp' ? { via: 'whatsapp' } : {};
  await audit(req, PRINT_ACTIONS[copy][as === 'paper' ? 'paper' : 'pdf'], { details: ids(patient, visit, { access: access.level, ...via }) });
  res.json({ printed: true });
});

// ---------- Sent to the patient on WhatsApp in one click (visits/whatsappSender.js) ----------
// Only when WhatsApp is set up in server/.env, the hospital admin switched it on, and she agreed to WhatsApp
// messages. The PDF is made in the browser (as for Download PDF) and sent here; it goes only to the mobile number
// on her own record – the browser never chooses the number. The audit log gets ids only, never the number.

const SENT_ACTIONS = { prescription: 'PRESCRIPTION_SENT_WHATSAPP', summary: 'VISIT_SUMMARY_SENT_WHATSAPP' };

/** Whether this visit's printout can be sent in one click now, and if not, why ({ available, reason, practice }). */
async function whatsappOffer(req, patient) {
  const status = whatsappStatus();
  const tenant = await Tenant.findById(req.tenantId, { name: 1, letterhead: 1, messaging: 1 }).lean();
  const to = mobileNumber(patient.phone);
  let reason = null;
  if (isClosed(patient)) reason = 'record_closed'; // a closed record gets no message of any kind
  else if (!status.ready) reason = 'not_set_up';
  else if (!tenant?.messaging?.whatsappDocuments) reason = 'switched_off';
  else if (!to) reason = 'no_mobile';
  else if (!(patient.reminders?.consent && patient.reminders?.channel === 'whatsapp')) reason = 'no_agreement';
  return { available: !reason, reason, practice: status.mode === 'practice', to, tenant };
}

visitsRouter.get('/:visitId/whatsapp', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  assertCanView(req, patient);
  const { available, reason, practice } = await whatsappOffer(req, patient);
  res.json({ available, reason, practice });
});

visitsRouter.post('/:visitId/whatsapp', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const access = assertCanView(req, patient);
  const body = parse(z.object({ copy: z.enum(PRINT_COPIES), pdf: z.string().min(100).max(7_500_000) }).strict(), req.body ?? {});
  const visit = await findVisit(req, patient);
  assertActive(visit);
  if (!(visit.prescription?.by ?? visit.details?.by)) throw conflict('Nothing to send yet – a doctor or RMO needs to save the notes or the prescription first.', 'NOTHING_TO_PRINT');
  if (body.copy === 'prescription' && !visit.prescription?.items?.length) throw new HttpError(400, 'This visit has no medicines – send the visit summary instead.', 'NO_MEDICINES');
  const offer = await whatsappOffer(req, patient);
  if (!offer.available) {
    const words = {
      not_set_up: 'Sending on WhatsApp is not set up on this server.',
      switched_off: 'Sending on WhatsApp is switched off for this hospital (Hospital admin → Patient messages).',
      no_mobile: 'Her record has no mobile number.',
      no_agreement: 'She has not agreed to WhatsApp messages (her page: More → Reminders and portal).',
      record_closed: 'This record is closed, so nothing is sent from it. Print it, or use Download PDF.',
    };
    throw conflict(words[offer.reason], 'WHATSAPP_UNAVAILABLE');
  }
  const pdf = Buffer.from(body.pdf, 'base64');
  if (pdf.length > MAX_WHATSAPP_PDF_BYTES) throw new HttpError(400, 'The PDF is too large to send (5 MB at most).', 'VALIDATION');
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'Only a PDF can be sent.', 'VALIDATION');
  // The file's name has the patient number and the date, never her name
  const fileName = `${body.copy === 'summary' ? 'Visit-summary' : 'Prescription'}-${patient.mrn}-${isoDay(visit.visitOn)}.pdf`;
  try {
    await sendDocument({ to: offer.to, pdf, fileName, hospital: offer.tenant.letterhead?.name || offer.tenant.name });
  } catch (err) {
    console.error('WhatsApp: a document could not be sent:', err?.message ?? err);
    throw new HttpError(502, `It was not sent: ${err?.message ?? 'WhatsApp could not be reached'}. Print it, or use Download PDF.`, 'WHATSAPP_FAILED');
  }
  await audit(req, SENT_ACTIONS[body.copy], { details: ids(patient, visit, { access: access.level, ...(offer.practice ? { practice: true } : {}) }) });
  res.status(201).json({ sent: true, practice: offer.practice });
});
