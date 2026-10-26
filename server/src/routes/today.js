import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { bookedAhead } from '../appointments/appointmentService.js';
import { addDays, hospitalToday, isoDay } from '../careplans/dates.js';
import { babyVaccinations, overduePlanItems } from '../careplans/overdue.js';
import { planStatuses } from '../careplans/planEngine.js';
import { refreshStalePlans } from '../careplans/plansService.js';
import { PATIENT_FIELDS, calendarLevel } from '../calendar/calendarAccess.js';
import { latestVisitsPipeline, loadCalendar } from '../calendar/calendarLoad.js';
import { CALENDAR_ROLES, RECEPTION_PLAN_FOR_SENSITIVE } from '../calendar/calendarRules.js';
import { Appointment } from '../models/Appointment.js';
import { Arrival } from '../models/Arrival.js';
import { CarePlan } from '../models/CarePlan.js';
import { hasRole } from '../models/Membership.js';
import { Patient, currentAge } from '../models/Patient.js';
import { IN_USE } from '../patients/deathRules.js';
import { patientsWithMissingDetails } from '../patients/missingDetails.js';
import { openFollowUpsOf } from './addedFollowUps.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { inHospitalNow } from '../reminders/generalReminders.js';
import { VACCINATION_LIST_DAYS } from '../reminders/reminderRules.js';
import { HttpError } from '../utils/httpError.js';
import { parse } from '../utils/validate.js';

// The Today page's lists (Feature 10, daily lists): GET /api/today?scope=mine|all. For the calendar roles (doctors,
// RMOs, reception) – the same detail rules as the calendar (calendarAccess.js):
//  - patients: everyone booked for today (the booking stays, with the time she arrived), everyone marked as arrived,
//    and everyone whose visit was started today without a booking;
//  - reception only, the call lists: "due now" (a care-plan visit window is open) and "overdue" (a window has passed,
//    or a booked day in the last 4 weeks passed with no visit). Someone with a visit today or a booking from today on
//    is not listed: she is already coming. Reception sees the window's first day only, never its end or its name;
//  - reception only, "babies due" (4 Oct 2026): babies with a vaccination that became overdue in the last six weeks
//    (VACCINATION_LIST_DAYS) and nothing booked – in general words (a check-up or test is due, and from which day),
//    never the vaccine. A baby whose care plan was built from a schedule no doctor has approved is marked as a draft
//    (ask the doctor before calling); a baby still in hospital is not listed. Doctors, RMOs and nurses get the same
//    babies with the vaccines by name on the worklist (routes/worklist.js).
// scope=mine (doctors' default): their own and unassigned patients, as on the worklist. Not audited, like the calendar.

export const todayRouter = Router();

// What the Details missing list reads of a patient: identity only
const MISSING_SELECT = 'fullName mrn phone assignedDoctor careType ageYears address city emergencyContact.phone createdAt';

const MAX_PLANS = 1000;
const MAX_BABIES = 200;
const MISSED_BOOKING_DAYS = 28;
const querySchema = z.object({ scope: z.enum(['mine', 'all']).optional() });

todayRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...CALENDAR_ROLES)) throw new HttpError(403, "Your role in this hospital doesn't include today's appointments.", 'FORBIDDEN');
  next();
});

const inScope = (req, scope, patient) => scope === 'all' || !patient.assignedDoctor || String(patient.assignedDoctor) === String(req.user._id);

export async function doctorNames(patients) {
  const ids = [...new Set(patients.map((p) => p.assignedDoctor && String(p.assignedDoctor)).filter(Boolean))];
  const users = ids.length ? await User.find({ _id: { $in: ids } }, { name: 1 }).lean() : [];
  return new Map(users.map((u) => [String(u._id), u.name]));
}

// Name, patient number, phone and doctor – the same for every level (reception may see these).
export const who = (p, names) => ({
  id: String(p._id),
  fullName: p.fullName,
  mrn: p.mrn,
  phone: p.phone ?? '',
  doctorName: p.assignedDoctor ? (names.get(String(p.assignedDoctor)) ?? null) : null,
});

todayRouter.get('/', async (req, res) => {
  const q = parse(querySchema, req.query);
  res.json(await todayFor(req, q.scope));
});

/**
 * Today's lists for this person (scope 'mine' | 'all', or undefined for their default) – also read by the Today
 * page's AI brief (routes/aiBrief.js). The caller checks the role.
 */
export async function todayFor(req, askedScope) {
  const tenantId = req.tenantId;
  const isDoctor = hasRole(req.membership, 'doctor');
  const scope = askedScope ?? (isDoctor && !hasRole(req.membership, 'rmo') ? 'mine' : 'all');
  const today = hospitalToday(req.now);

  // Booked for today (with "arrived" from the calendar) and the visits started today.
  const booked = await loadCalendar(req, { view: 'day', from: today, to: today, types: ['booked'], scope: 'all' });
  const bookings = new Map(booked.events.filter((e) => e.type === 'booked').map((e) => [e.patientId, e]));
  const todays = await Visit.find({ tenantId, visitOn: today, status: 'active' }, { patientId: 1, createdAt: 1, 'signed.at': 1 }).sort({ createdAt: 1 }).lean();
  const signedToday = new Set(todays.filter((v) => v.signed?.at).map((v) => String(v.patientId)));
  const firstVisit = new Map();
  for (const v of todays) if (!firstVisit.has(String(v.patientId))) firstVisit.set(String(v.patientId), v);
  // Marked as arrived by reception (before any visit is started)
  const arrivals = new Map((await Arrival.find({ tenantId, on: today }, { patientId: 1, at: 1, byName: 1, emergency: 1, left: 1, purpose: 1 }).lean()).map((a) => [String(a.patientId), a]));

  const ids = [...new Set([...bookings.keys(), ...firstVisit.keys(), ...arrivals.keys()])];
  // (a record marked as a duplicate of another is not on today's lists: she is expected on her main record; nor is a
  // record closed after a death)
  const found = ids.length ? await Patient.find({ tenantId, _id: { $in: ids }, ...IN_USE }).select(`${PATIENT_FIELDS} ageYears ageRecordedOn createdAt`).lean() : [];
  const shown = found.map((p) => ({ p, level: calendarLevel(req, p) })).filter(({ p, level }) => level && inScope(req, scope, p));
  // Follow-ups added by hand that are still open (she has not checked in for them yet)
  const followUps = await openFollowUpsOf(tenantId, shown.map(({ p }) => p._id));

  // The call lists (reception).
  const seenToday = new Set([...firstVisit.keys(), ...arrivals.keys()]);
  const calls = hasRole(req.membership, 'receptionist') ? await callLists(req, today, seenToday) : null;
  const babies = hasRole(req.membership, 'receptionist') ? await babiesDue(req, today, seenToday) : null;
  // Reception: patients registered with details still missing (recent ones, and anyone on today's list)
  const incomplete = hasRole(req.membership, 'receptionist') ? await patientsWithMissingDetails(tenantId, { now: req.now, alsoIds: ids, select: MISSING_SELECT }) : null;

  // Today's appointments (appointment booking): the time or walk-in token and the doctor of each patient, and the
  // quick bookings of new patients not registered yet.
  const appts = await Appointment.find({ tenantId, on: today, status: 'booked' }, { patientId: 1, guest: 1, doctorId: 1, kind: 1, start: 1, token: 1, done: 1, visitType: 1 })
    .sort({ kind: 1, start: 1, token: 1 })
    .lean();
  const apptNames = await doctorNames(appts.map((a) => ({ assignedDoctor: a.doctorId })));
  const apptView = (a) => ({ id: String(a._id), kind: a.kind, start: a.start ?? null, token: a.token ?? null, needsTime: a.kind === 'slot' && !a.start, visitType: a.visitType ?? null, doctorId: String(a.doctorId), doctorName: apptNames.get(String(a.doctorId)) ?? null });
  const apptOf = new Map();
  for (const a of appts) if (a.patientId && !apptOf.has(String(a.patientId))) apptOf.set(String(a.patientId), apptView(a));
  const checkupDone = new Set(appts.filter((a) => a.patientId && a.done).map((a) => String(a.patientId)));

  const names = await doctorNames([...shown.map((s) => s.p), ...(calls?.patients ?? []), ...(babies?.rows ?? []).map((r) => r.p), ...(incomplete?.rows ?? []).map((r) => r.p)]);
  const patients = shown
    .map(({ p, level }) => {
      const id = String(p._id);
      const visit = firstVisit.get(id);
      const marked = arrivals.get(id);
      const times = [marked?.at, visit?.createdAt].filter(Boolean);
      const arrived = times.length > 0;
      return {
        patient: who(p, names),
        appointment: apptOf.get(id) ?? null,
        booked: bookings.has(id),
        // When she arrived: marked by reception, or her visit started – whichever came first
        arrivedAt: times.length ? new Date(Math.min(...times.map((t) => new Date(t).getTime()))) : null,
        arrivalMarked: Boolean(marked), // can be undone (until a visit is started)
        visitStarted: Boolean(visit),
        // The live queue (26 Oct 2026): expected → waiting (arrived) → with the doctor (her visit started) → done (the
        // visit signed, the checkup marked done, or reception marked that she left); emergency: seen first
        queue: marked?.left || signedToday.has(id) || checkupDone.has(id) ? 'done' : visit ? 'with_doctor' : arrived ? 'waiting' : 'expected',
        emergency: Boolean(marked?.emergency),
        leftMarked: Boolean(marked?.left), // reception's "Done – she left" (can be undone)
        // Her age today (identity, as on her card) – a baby's record says baby instead (reception's table)
        age: p.careType === 'newborn' ? null : currentAge(p, req.now ?? new Date()),
        baby: p.careType === 'newborn',
        // Why she came (marked at check-in), and her open follow-up (with which doctor, what for)
        purpose: marked?.purpose?.kind ? { kind: marked.purpose.kind, note: marked.purpose.note ?? '' } : null,
        followUp: followUps.get(id)?.[0] ?? null,
        // The visit to open: doctors and RMOs who may see this patient's visits only.
        ...(level === 'clinical' && visit ? { visitId: String(visit._id) } : {}),
      };
    })
    // Emergencies first (until done); then arrived, in the order they came; then those still expected, by booked
    // time, then name.
    .sort((a, b) => {
      const urgent = (r) => r.emergency && r.queue !== 'done';
      if (urgent(a) !== urgent(b)) return urgent(a) ? -1 : 1;
      if (a.arrivedAt && b.arrivedAt) return a.arrivedAt - b.arrivedAt;
      if (a.arrivedAt || b.arrivedAt) return a.arrivedAt ? -1 : 1;
      return (a.appointment?.start ?? '99:99').localeCompare(b.appointment?.start ?? '99:99') || a.patient.fullName.localeCompare(b.patient.fullName);
    });
  const guests = appts
    .filter((a) => !a.patientId && a.guest)
    .map((a) => ({ ...apptView(a), guest: { name: a.guest.name, phone: a.guest.phone } }))
    .filter((g) => scope === 'all' || g.doctorId === String(req.user._id));

  return {
    today: isoDay(today),
    scope,
    canChooseScope: isDoctor,
    canMarkArrived: true, // every role of this page may mark arrivals (routes/arrivals.js)
    patients,
    guests,
    dueNow: calls ? calls.dueNow.map((r) => ({ patient: who(r.p, names), dueFrom: r.dueFrom })) : null,
    overdue: calls ? calls.overdue.map((r) => ({ patient: who(r.p, names), dueFrom: r.dueFrom, bookedFor: r.bookedFor })) : null,
    // Reception's general list of babies to call: who, and the first day it was due – never what is due. draft: the
    // baby's schedule has not been approved by a doctor yet (the date comes from content nobody reviewed).
    babiesDue: babies ? babies.rows.map((r) => ({ patient: who(r.p, names), dueFrom: r.dueFrom, draft: r.draft })) : null,
    // Reception: registration details still missing – who, what (patients/missingDetails.js) and when registered
    incomplete: incomplete ? incomplete.rows.map((r) => ({ patient: who(r.p, names), missing: r.missing, registeredOn: isoDay(r.p.createdAt) })) : null,
    cut: Boolean(calls?.cut || babies?.cut || incomplete?.cut),
  };
}

/**
 * Babies to call (reception): a vaccination in the baby's care plan that became overdue in the last
 * VACCINATION_LIST_DAYS days, and nothing booked from today on. Not listed: a baby seen or marked arrived today, a
 * baby in hospital now (or whose mother on the baby's record is: the parents are in the ward), and – as for every
 * care-plan date – a sensitive record. Only the first day it was due and whether the schedule is still a draft
 * leave this function, never the vaccine's name.
 */
export async function babiesDue(req, today, seenToday) {
  // withOlder: "was due from" is the first day ANYTHING was due for this baby, also when that is longer ago
  const { rows, cut } = await overduePlanItems(req.tenantId, { now: req.now, kindsFor: babyVaccinations, careTypes: ['newborn'], overdueSince: addDays(today, -VACCINATION_LIST_DAYS), withOlder: true, limit: MAX_BABIES });
  const waiting = rows.filter((r) => !seenToday.has(String(r.patient._id)));
  const [booked, admitted] = await Promise.all([bookedAhead(req.tenantId, waiting.map((r) => r.patient._id), today), inHospitalNow(req.tenantId, waiting.map((r) => r.patient))]);
  const out = [];
  for (const r of waiting) {
    const p = r.patient;
    const level = calendarLevel(req, p);
    if (!level || booked.has(String(p._id)) || admitted.has(String(p._id))) continue;
    if (level !== 'clinical' && p.sensitive && !RECEPTION_PLAN_FOR_SENSITIVE) continue;
    out.push({ p, dueFrom: isoDay(r.items[0].dueFrom), draft: !r.approved });
  }
  out.sort((a, b) => a.dueFrom.localeCompare(b.dueFrom) || a.p.fullName.localeCompare(b.p.fullName));
  return { rows: out, cut };
}

/**
 * Patients to call: an open care-plan visit window (due now), a window that has passed (overdue) or a booked day in
 * the last 4 weeks with no visit. Not listed: anyone with a visit today or a booking from today on.
 */
export async function callLists(req, today, seenToday) {
  const tenantId = req.tenantId;
  await refreshStalePlans(tenantId, req.now);
  const plans = await CarePlan.find(
    { tenantId, careType: 'antenatal', current: true, status: 'active' },
    { patientId: 1, status: 1, eddReview: 1, 'basis.edd': 1, items: 1 },
  )
    .limit(MAX_PLANS + 1)
    .lean();
  const cut = plans.length > MAX_PLANS;

  // One window per patient: the earliest overdue one, else the earliest due one.
  const windows = new Map(); // patientId -> { status, dueFrom }
  for (const plan of plans.slice(0, MAX_PLANS)) {
    const visits = { ...plan, items: (plan.items ?? []).filter((it) => it.kind === 'visit') };
    const statuses = planStatuses(visits, today);
    for (const it of visits.items) {
      const status = statuses.get(it)?.status;
      if (!['due', 'overdue'].includes(status) || !it.auto?.dueFrom) continue;
      const pid = String(plan.patientId);
      const cur = windows.get(pid);
      const better = !cur || (status === 'overdue' && cur.status !== 'overdue') || (status === cur.status && it.auto.dueFrom < cur.dueFrom);
      if (better) windows.set(pid, { status, dueFrom: it.auto.dueFrom });
    }
  }

  // Booked days that passed with no visit (the calendar's "No visit recorded"), in the last 4 weeks.
  const missed = await loadCalendar(req, { view: 'week', from: addDays(today, -MISSED_BOOKING_DAYS), to: addDays(today, -1), types: ['booked'], scope: 'all' });
  const missedOn = new Map(missed.events.filter((e) => e.type === 'booked' && e.state === 'no_visit').map((e) => [e.patientId, e.date]));

  // Already coming: a booking from today on (the latest visit's next date).
  const candidates = [...new Set([...windows.keys(), ...missedOn.keys()])].filter((id) => !seenToday.has(id));
  const objectIds = candidates.map((id) => new mongoose.Types.ObjectId(id));
  const latest = objectIds.length ? await Visit.aggregate(latestVisitsPipeline({ tenantId, patientIds: objectIds, limit: MAX_PLANS })) : [];
  const latestVisits = latest.length ? await Visit.find({ tenantId, _id: { $in: latest.map((l) => l.visitId) } }, { patientId: 1, 'details.nextVisitOn': 1 }).lean() : [];
  // A next visit that made an appointment counts through the appointment (below): a cancelled one is not "coming"
  const linked = latestVisits.length ? new Set((await Appointment.find({ tenantId, visitId: { $in: latestVisits.map((v) => v._id) } }, { visitId: 1 }).lean()).map((a) => String(a.visitId))) : new Set();
  const bookedAhead = new Set(latestVisits.filter((v) => v.details?.nextVisitOn && v.details.nextVisitOn >= today && !linked.has(String(v._id))).map((v) => String(v.patientId)));
  // An appointment from today on (appointment booking) – unless it was cancelled
  const ahead = objectIds.length ? await Appointment.find({ tenantId, patientId: { $in: objectIds }, on: { $gte: today }, status: 'booked' }, { patientId: 1 }).lean() : [];
  for (const a of ahead) bookedAhead.add(String(a.patientId));

  const wanted = candidates.filter((id) => !bookedAhead.has(id));
  const found = wanted.length ? await Patient.find({ tenantId, _id: { $in: wanted }, ...IN_USE }).select(PATIENT_FIELDS).lean() : [];
  const dueNow = [];
  const overdue = [];
  for (const p of found) {
    const level = calendarLevel(req, p);
    if (!level) continue;
    const id = String(p._id);
    // Reception sees no care-plan windows of sensitive records (as on the calendar); their bookings, yes.
    const showWindow = level === 'clinical' || !p.sensitive || RECEPTION_PLAN_FOR_SENSITIVE;
    const w = showWindow ? windows.get(id) : null;
    const bookedFor = missedOn.get(id) ?? null;
    if (w?.status === 'overdue' || bookedFor) overdue.push({ p, dueFrom: w?.status === 'overdue' ? isoDay(w.dueFrom) : null, bookedFor });
    else if (w?.status === 'due') dueNow.push({ p, dueFrom: isoDay(w.dueFrom) });
  }
  const byDate = (r) => r.dueFrom ?? r.bookedFor ?? '';
  dueNow.sort((a, b) => byDate(a).localeCompare(byDate(b)) || a.p.fullName.localeCompare(b.p.fullName));
  overdue.sort((a, b) => byDate(a).localeCompare(byDate(b)) || a.p.fullName.localeCompare(b.p.fullName));
  return { dueNow, overdue, cut, patients: found };
}
