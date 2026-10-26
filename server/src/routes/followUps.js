import { Router } from 'express';
import { bookedAhead } from '../appointments/appointmentService.js';
import { addDays, hospitalToday, isoDay } from '../careplans/dates.js';
import { babyVaccinations, dueSoonPlanItems } from '../careplans/overdue.js';
import { PATIENT_FIELDS, calendarLevel } from '../calendar/calendarAccess.js';
import { loadCalendar } from '../calendar/calendarLoad.js';
import { RECEPTION_PLAN_FOR_SENSITIVE } from '../calendar/calendarRules.js';
import { Admission } from '../models/Admission.js';
import { Appointment } from '../models/Appointment.js';
import { Arrival } from '../models/Arrival.js';
import { hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { Visit } from '../models/Visit.js';
import { IN_USE } from '../patients/deathRules.js';
import { inHospitalNow } from '../reminders/generalReminders.js';
import { HttpError } from '../utils/httpError.js';
import { babiesDue, callLists, doctorNames, who } from './today.js';

// Reception's Follow-ups page (26 Oct 2026, docs/IDEAS_FOR_LATER.md ideas 24, 25 and 27): GET /api/follow-ups.
// Reception only – the front desk's calls, in one place:
//  - comingUp: everyone booked from today for the next COMING_UP_DAYS days – an appointment, or a next visit the
//    doctor wrote that made no appointment – with the day, the time, the doctor and New / Follow-up. Never the
//    reason for the visit (the calendar's reception level: no note, no visit id);
//  - dueNow, overdue: the Today page's call lists (routes/today.js, callLists);
//  - babiesDue: babies with a vaccination overdue in the last six weeks and nothing booked (today.js, babiesDue);
//  - babiesSoon: babies with a vaccination whose window opens within BABIES_SOON_DAYS days, nothing overdue and
//    nothing booked – so reception books them before they are late. As babiesDue: the first day only and whether
//    the schedule is still a draft, never the vaccine; not a baby seen or arrived today, in hospital, or (as for
//    every care-plan date) with a sensitive record.
// Each patient also says OPD, IPD or Day care (careSettings), for the page's filter.
// Not audited, like the calendar and the Today page: names, phone numbers and dates only.

export const followUpsRouter = Router();

export const COMING_UP_DAYS = 7;
export const BABIES_SOON_DAYS = 7;
const MAX_BABIES = 200;
// A stay that ended this many days ago still makes her follow-up an IPD (or day-care) one
export const STAY_FOLLOW_UP_DAYS = 90;

followUpsRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, 'receptionist')) throw new HttpError(403, 'The follow-ups list is for reception.', 'FORBIDDEN');
  next();
});

followUpsRouter.get('/', async (req, res) => {
  const tenantId = req.tenantId;
  const today = hospitalToday(req.now);
  // Seen today (a visit started) or marked as arrived: not on a call list
  const [visits, arrivals] = await Promise.all([Visit.find({ tenantId, visitOn: today, status: 'active' }, { patientId: 1 }).lean(), Arrival.find({ tenantId, on: today }, { patientId: 1 }).lean()]);
  const seenToday = new Set([...visits, ...arrivals].map((r) => String(r.patientId)));

  const [coming, calls, babies, soon] = await Promise.all([comingUp(req, today), callLists(req, today, seenToday), babiesDue(req, today, seenToday), babiesSoon(req, today, seenToday)]);
  // A baby already on the overdue list is not also "due soon"
  const overdueBabies = new Set(babies.rows.map((r) => String(r.p._id)));
  const soonRows = soon.rows.filter((r) => !overdueBabies.has(String(r.p._id)));

  const everyone = [...coming.rows.map((r) => r.p), ...calls.patients, ...babies.rows.map((r) => r.p), ...soonRows.map((r) => r.p)];
  const [names, settings] = await Promise.all([doctorNames(everyone), careSettings(tenantId, everyone, today)]);
  // Name, number, phone, doctor – and OPD / IPD / Day care, for the page's filter
  const person = (p) => ({ ...who(p, names), setting: settings.get(String(p._id)) ?? 'opd' });
  res.json({
    today: isoDay(today),
    days: COMING_UP_DAYS,
    comingUp: coming.rows.map((r) => ({ patient: person(r.p), ...r.booking })),
    dueNow: calls.dueNow.map((r) => ({ patient: person(r.p), dueFrom: r.dueFrom })),
    overdue: calls.overdue.map((r) => ({ patient: person(r.p), dueFrom: r.dueFrom, bookedFor: r.bookedFor })),
    babiesDue: babies.rows.map((r) => ({ patient: person(r.p), dueFrom: r.dueFrom, draft: r.draft })),
    babiesSoon: soonRows.map((r) => ({ patient: person(r.p), dueFrom: r.dueFrom, draft: r.draft })),
    cut: Boolean(coming.cut || calls.cut || babies.cut || soon.cut),
  });
});

/**
 * Booked from today for COMING_UP_DAYS days, from the calendar's booked entries (the same rules: the latest visit's
 * next date, or an appointment that was not cancelled). booking: { date, start, needsTime, doctorName, visitType,
 * arrived, fromNextVisit } – fromNextVisit: the doctor wrote the date, no appointment was made (it needs a time).
 */
async function comingUp(req, today) {
  const cal = await loadCalendar(req, { view: 'week', from: today, to: addDays(today, COMING_UP_DAYS - 1), types: ['booked'], scope: 'all' });
  const events = cal.events.filter((e) => e.type === 'booked');
  const apptIds = events.map((e) => e.appointmentId).filter(Boolean);
  const appts = apptIds.length ? await Appointment.find({ tenantId: req.tenantId, _id: { $in: apptIds } }, { visitType: 1 }).lean() : [];
  const typeOf = new Map(appts.map((a) => [String(a._id), a.visitType]));
  const ids = [...new Set(events.map((e) => e.patientId))];
  const found = ids.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: ids }, ...IN_USE }).select(PATIENT_FIELDS).lean() : [];
  const byId = new Map(found.map((p) => [String(p._id), p]));
  const rows = [];
  for (const e of events) {
    const p = byId.get(String(e.patientId));
    if (!p) continue;
    rows.push({
      p,
      booking: {
        date: e.date,
        start: e.start ?? null,
        needsTime: e.appointmentId ? Boolean(e.needsTime) : true,
        doctorName: e.doctorName ?? null,
        visitType: e.appointmentId ? (typeOf.get(String(e.appointmentId)) ?? 'follow_up') : 'follow_up',
        arrived: e.state === 'arrived',
        fromNextVisit: !e.appointmentId,
      },
    });
  }
  rows.sort((a, b) => a.booking.date.localeCompare(b.booking.date) || (a.booking.start ?? '99:99').localeCompare(b.booking.start ?? '99:99') || a.p.fullName.localeCompare(b.p.fullName));
  // (the week view keeps at most MAX_EVENTS_PER_DAY.week entries a day – far more than one front desk books)
  return { rows, patients: found, cut: Boolean(cal.countsIncomplete) };
}

/**
 * OPD, IPD or day care for each patient (patientId -> 'ipd' | 'day_care'; not in the map: 'opd'): her latest stay,
 * when it is still going or ended in the last STAY_FOLLOW_UP_DAYS days – a day-care stay is 'day_care', every other
 * stay 'ipd'. Reception admits and discharges, so this tells nothing new; never the reason for the stay.
 */
async function careSettings(tenantId, patients, today) {
  const ids = [...new Set(patients.map((p) => String(p._id)))];
  if (!ids.length) return new Map();
  const since = addDays(today, -STAY_FOLLOW_UP_DAYS);
  const stays = await Admission.find({ tenantId, patientId: { $in: ids }, $or: [{ status: 'admitted' }, { dischargedAt: { $gte: since } }] }, { patientId: 1, admittedAt: 1, admissionType: 1 })
    .sort({ admittedAt: -1 })
    .lean();
  const out = new Map();
  for (const s of stays) if (!out.has(String(s.patientId))) out.set(String(s.patientId), s.admissionType === 'day_care' ? 'day_care' : 'ipd');
  return out;
}

/** Babies with a vaccination due within BABIES_SOON_DAYS days and nothing booked (see the top of this file). */
async function babiesSoon(req, today, seenToday) {
  const { rows, cut } = await dueSoonPlanItems(req.tenantId, { now: req.now, kindsFor: babyVaccinations, careTypes: ['newborn'], withinDays: BABIES_SOON_DAYS, limit: MAX_BABIES });
  const waiting = rows.filter((r) => !seenToday.has(String(r.patient._id)));
  const [booked, admitted] = await Promise.all([bookedAhead(req.tenantId, waiting.map((r) => r.patient._id), today), inHospitalNow(req.tenantId, waiting.map((r) => r.patient))]);
  const out = [];
  for (const r of waiting) {
    const p = r.patient;
    const level = calendarLevel(req, p);
    if (!level || booked.has(String(p._id)) || admitted.has(String(p._id))) continue;
    if (level !== 'clinical' && p.sensitive && !RECEPTION_PLAN_FOR_SENSITIVE) continue;
    out.push({ p, dueFrom: isoDay(new Date(Math.min(...r.items.map((it) => it.dueFrom.getTime())))), draft: !r.approved });
  }
  return { rows: out, cut };
}
