// Reads the calendar's entries from the database for one person and one range.
//
// Rules this file keeps:
//  - every query and aggregate starts with this hospital's tenantId;
//  - list filters (scope, pregnancy-visible) are combined with $and, never by spreading objects (two $or keys
//    would overwrite each other); they only narrow the rows – calendarLevel is checked again on every patient;
//  - every patient lookup selects PATIENT_FIELDS, and leaves out the records marked as a duplicate of another and
//    the records closed after a death (IN_USE): their dates and bookings are not on the calendar;
//  - only the requested types are read; each query reads at most MAX_ROWS rows (reaching it marks the answer
//    as possibly incomplete);
//  - nothing is audited (like the patient list).

import { addDays, hospitalToday, isoDay, utcDay } from '../careplans/dates.js';
import { closedForPregnancy } from '../careplans/plansService.js';
import { statesFor } from '../appointments/appointmentService.js';
import { Appointment } from '../models/Appointment.js';
import { Arrival } from '../models/Arrival.js';
import { CarePlan } from '../models/CarePlan.js';
import { Patient } from '../models/Patient.js';
import { IN_USE } from '../patients/deathRules.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { pregnancyVisibleFilter } from '../utils/patientAccess.js';
import { PATIENT_FIELDS, calendarLevel, clinicalRoles, personLevel, scopeFilter } from './calendarAccess.js';
import { appointmentEvent, bookedEvent, countDays, eddEvent, limitPerDay, lmpEvent, planEvents, projectPatient, receptionIds, sortEvents } from './calendarEvents.js';
import { MAX_EVENTS_PER_DAY, MAX_ROWS } from './calendarRules.js';

let limitsForTests = {};
/** Tests only: { perDay, rows } replace MAX_EVENTS_PER_DAY and MAX_ROWS; {} restores them. */
export const setCalendarLimitsForTests = (limits = {}) => {
  limitsForTests = { ...limits };
};
const maxRows = () => limitsForTests.rows ?? MAX_ROWS;
const maxPerDay = (view) => limitsForTests.perDay ?? MAX_EVENTS_PER_DAY[view];

const ANTENATAL = 'antenatal';
// A "YYYY-MM-DD" date inside [from, to].
const inRangeIso = (iso, [from, to]) => {
  const t = new Date(`${iso}T00:00:00Z`).getTime();
  return t >= from.getTime() && t <= to.getTime();
};

const nonEmpty = (filters) => filters.filter((f) => f && Object.keys(f).length);
// { tenantId, $and: [...] } – tenantId stays at the top (the tenancy guard looks for it there).
const scoped = (tenantId, filters) => {
  const and = nonEmpty(filters);
  return and.length ? { tenantId, $and: and } : { tenantId };
};

/**
 * Loads the calendar. q: { view, from, to, types, scope } (from/to: dates, inclusive).
 * Returns { patients, events, days, countsIncomplete }.
 */
export async function loadCalendar(req, { view, from, to, types, scope }) {
  const tenantId = req.tenantId;
  const today = hospitalToday(req.now);
  const range = [utcDay(from), utcDay(to)];
  const inRange = { $gte: range[0], $lt: addDays(range[1], 1) };
  const mine = scope === 'mine';
  const limit = maxRows();
  let incomplete = false;
  // Reads at most `limit` rows; one more tells that there were too many.
  const capped = (rows) => {
    if (rows.length > limit) {
      incomplete = true;
      return rows.slice(0, limit);
    }
    return rows;
  };

  const events = [];
  const patientsById = new Map(); // id -> { patient, level }
  const keep = (patient) => {
    const id = String(patient._id);
    if (!patientsById.has(id)) patientsById.set(id, { patient, level: calendarLevel(req, patient) });
    return patientsById.get(id).level;
  };

  // 0. "My patients": their ids first (plan and booked queries are narrowed to them).
  let myIds = null;
  if (mine) {
    myIds = capped(await Patient.find({ tenantId, assignedDoctor: req.user._id, ...IN_USE }, { _id: 1 }).limit(limit + 1).lean()).map((p) => p._id);
  }
  // The scope, and never a record marked as a duplicate or closed after a death (every patient lookup below carries this filter)
  const scopeF = { ...scopeFilter(req, scope), ...IN_USE };

  // 1–2. LMP and EDD of current pregnancies (doctors and RMOs, for patients whose pregnancy they may see).
  const pregnancyTypes = ['lmp', 'edd'].filter((t) => types.includes(t));
  const visible = pregnancyVisibleFilter(clinicalRoles(req), req.user._id);
  if (pregnancyTypes.length && visible) {
    const found = new Map();
    for (const type of pregnancyTypes) {
      const field = type === 'lmp' ? 'pregnancy.lmp' : 'pregnancy.effectiveEdd';
      const rows = await Patient.find(scoped(tenantId, [scopeF, visible, { careType: ANTENATAL, [field]: inRange }]))
        .select(PATIENT_FIELDS)
        .limit(limit + 1)
        .lean();
      for (const p of capped(rows)) {
        if (!found.has(String(p._id))) found.set(String(p._id), { patient: p, types: new Set() });
        found.get(String(p._id)).types.add(type);
      }
    }
    // A pregnancy whose plan was closed (delivered, ended, transferred …) is no longer shown.
    const ids = [...found.values()].map((f) => f.patient._id);
    const plans = ids.length
      ? await CarePlan.find(
          { tenantId, careType: ANTENATAL, patientId: { $in: ids } },
          { patientId: 1, current: 1, 'basis.edd': 1, 'closed.reason': 1, 'eddReview.toEdd': 1 },
        ).lean()
      : [];
    const plansOf = new Map();
    for (const p of plans) {
      const k = String(p.patientId);
      if (!plansOf.has(k)) plansOf.set(k, []);
      plansOf.get(k).push(p);
    }
    for (const [id, { patient, types: hit }] of found) {
      const own = plansOf.get(id) ?? [];
      const ended = !own.some((p) => p.current) && closedForPregnancy(own.filter((p) => !p.current), patient.pregnancy?.effectiveEdd);
      if (ended) continue;
      if (keep(patient) !== 'clinical') continue;
      if (hit.has('lmp')) {
        const e = lmpEvent(patient, 'clinical');
        if (e && inRangeIso(e.date, range)) events.push(e);
      }
      if (hit.has('edd')) {
        const e = eddEvent(patient, 'clinical');
        if (e && inRangeIso(e.date, range)) events.push(e);
      }
    }
  }

  // 3. Care-plan visits: current, active antenatal plans with a visit placed in the range.
  if (types.includes('plan')) {
    const pipeline = planVisitsPipeline({ tenantId, range, patientIds: mine ? myIds : null, limit });
    const plans = capped(await CarePlan.aggregate(pipeline));
    if (plans.length) {
      const patients = await Patient.find(
        scoped(tenantId, [{ _id: { $in: plans.map((p) => p.patientId) } }, { careType: ANTENATAL }, scopeF]),
      )
        .select(PATIENT_FIELDS)
        .limit(limit + 1)
        .lean();
      const byId = new Map(capped(patients).map((p) => [String(p._id), p]));
      for (const plan of plans) {
        const patient = byId.get(String(plan.patientId));
        if (!patient) continue;
        const level = keep(patient);
        if (!level) continue;
        events.push(...planEvents(plan, today, range, level, { sensitive: Boolean(patient.sensitive) }));
      }
    }
  }

  // 4. Booked next visits: the booking of each patient's latest visit that was not cancelled – and, kept on its
  //    day as "Arrived", the booking of an earlier visit when she came on the booked day (BOOKING_KEPT_AFTER_VISIT).
  //    A visit on any other day replaces the booking.
  if (types.includes('booked')) {
    const candidates = capped(
      await Visit.find(
        scoped(tenantId, [{ status: 'active', 'details.nextVisitOn': inRange }, ...(mine ? [{ patientId: { $in: myIds } }] : [])]),
      )
        .select('patientId visitOn createdAt details.nextVisitOn details.nextVisitNote')
        .limit(limit + 1)
        .lean(),
    );
    if (candidates.length) {
      const pidObjects = [...new Map(candidates.map((v) => [String(v.patientId), v.patientId])).values()];
      const latest = capped(
        await Visit.aggregate(latestVisitsPipeline({ tenantId, patientIds: pidObjects, limit })),
      );
      const latestOf = new Map(latest.map((l) => [String(l._id), String(l.visitId)]));
      const patients = await Patient.find(scoped(tenantId, [{ _id: { $in: pidObjects } }, scopeF]))
        .select(PATIENT_FIELDS)
        .limit(limit + 1)
        .lean();
      const byId = new Map(capped(patients).map((p) => [String(p._id), p]));
      // The first visit started for each patient on each day of the range: "<patientId>:<YYYY-MM-DD>" -> time.
      const dayVisits = capped(
        await Visit.find(scoped(tenantId, [{ status: 'active', patientId: { $in: pidObjects }, visitOn: inRange }]))
          .select('patientId visitOn createdAt')
          .limit(limit + 1)
          .lean(),
      );
      const arrivals = new Map();
      const earliest = (k, t) => {
        if (!arrivals.has(k) || t < arrivals.get(k)) arrivals.set(k, t);
      };
      for (const d of dayVisits) earliest(`${String(d.patientId)}:${isoDay(d.visitOn)}`, d.createdAt);
      // Marked as arrived by reception (before a visit was started) counts too
      const marked = await Arrival.find(scoped(tenantId, [{ patientId: { $in: pidObjects }, on: inRange }])).select('patientId on at').limit(limit + 1).lean();
      for (const m of capped(marked)) earliest(`${String(m.patientId)}:${isoDay(m.on)}`, m.at);
      // A next visit that made an appointment (appointment booking) is shown from the appointment (step 5).
      const linked = new Set(
        (await Appointment.find({ tenantId, visitId: { $in: candidates.map((v) => v._id) } }, { visitId: 1 }).lean()).map((a) => String(a.visitId)),
      );
      for (const v of candidates) {
        if (linked.has(String(v._id))) continue;
        const pid = String(v.patientId);
        const arrivedAt = arrivals.get(`${pid}:${isoDay(v.details.nextVisitOn)}`) ?? null;
        if (latestOf.get(pid) !== String(v._id) && !arrivedAt) continue; // a later visit, on another day, replaced this booking
        const patient = byId.get(pid);
        if (!patient) continue;
        const level = keep(patient);
        if (!level) continue;
        const edd = patient.careType === ANTENATAL ? patient.pregnancy?.effectiveEdd : null;
        const booking = { patientId: v.patientId, visitId: v._id, visitOn: v.visitOn, nextVisitOn: v.details.nextVisitOn, note: v.details.nextVisitNote ?? '', arrivedAt };
        const e = bookedEvent(booking, today, level, edd);
        if (e) events.push(e);
      }
    }
  }

  // 5. Booked appointments (appointment booking): time slots of registered patients, with the time and the doctor –
  //    also those that still need a time. Walk-in tokens are not bookings (the Today page shows them).
  if (types.includes('booked')) {
    const appts = capped(
      await Appointment.find(
        scoped(tenantId, [{ on: inRange, kind: 'slot', status: 'booked', patientId: { $ne: null } }, ...(mine ? [{ patientId: { $in: myIds } }] : [])]),
      )
        .limit(limit + 1)
        .lean(),
    );
    if (appts.length) {
      const pids = [...new Set(appts.map((a) => String(a.patientId)))];
      const patients = await Patient.find(scoped(tenantId, [{ _id: { $in: pids } }, scopeF])).select(PATIENT_FIELDS).limit(limit + 1).lean();
      const byId = new Map(capped(patients).map((p) => [String(p._id), p]));
      const [states, doctors, visits] = await Promise.all([
        statesFor(tenantId, appts),
        doctorNames(appts.map((a) => a.doctorId)),
        Visit.find({ tenantId, _id: { $in: appts.map((a) => a.visitId).filter(Boolean) } }, { patientId: 1, visitOn: 1, 'details.nextVisitNote': 1 }).lean(),
      ]);
      const visitOf = new Map(visits.map((v) => [String(v._id), { _id: v._id, patientId: v.patientId, visitOn: v.visitOn, note: v.details?.nextVisitNote ?? '' }]));
      // The visit whose "next visit" made the booking – only while both are on the same record: a booking that went
      // to the main record when its record was marked as a duplicate has no visit on the main record to open.
      const ownVisit = (a) => {
        const v = a.visitId ? visitOf.get(String(a.visitId)) : null;
        return v && String(v.patientId) === String(a.patientId) ? v : null;
      };
      for (const a of appts) {
        const patient = byId.get(String(a.patientId));
        if (!patient) continue;
        const level = keep(patient);
        if (!level) continue;
        const state = states.get(`${String(a.patientId)}:${isoDay(a.on)}`);
        const edd = patient.careType === ANTENATAL ? patient.pregnancy?.effectiveEdd : null;
        const e = appointmentEvent(a, today, level, {
          arrivedAt: state?.arrivedAt ?? null,
          doctorName: doctors.get(String(a.doctorId)) ?? null,
          visit: ownVisit(a),
          edd,
        });
        if (e) events.push(e);
      }
    }
  }

  // Ids, counts (before any cut), order and the per-day limit.
  receptionIds(events);
  const days = countDays(events, range, types, personLevel(req));
  if (view === 'month') return { patients: {}, events: [], days, countsIncomplete: incomplete };

  const names = await doctorNames([...patientsById.values()].map((p) => p.patient.assignedDoctor));
  const projected = {};
  for (const [id, { patient, level }] of patientsById) {
    if (!level) continue;
    projected[id] = projectPatient(patient, level, patient.assignedDoctor ? names.get(String(patient.assignedDoctor)) : null, today);
  }
  sortEvents(events, projected);
  const kept = limitPerDay(events, days, maxPerDay(view));
  const patients = {};
  for (const e of kept) patients[e.patientId] ??= projected[e.patientId];
  return { patients, events: kept, days, countsIncomplete: incomplete };
}

/**
 * The aggregate for each patient's latest visit that was not cancelled: { _id: patientId, visitId }.
 * Same order as the visit list (visitOn, then createdAt, newest first), so the order comes straight from the
 * index { tenantId, patientId, visitOn: -1, createdAt: -1 } with no sorting in memory – keep it that way.
 */
export function latestVisitsPipeline({ tenantId, patientIds, limit = maxRows() }) {
  return [
    { $match: { tenantId, status: 'active', patientId: { $in: patientIds } } },
    { $sort: { patientId: 1, visitOn: -1, createdAt: -1 } },
    { $group: { _id: '$patientId', visitId: { $first: '$_id' } } },
    { $limit: limit + 1 },
  ];
}

/**
 * The aggregate for care-plan visits: current, active antenatal plans (optionally of these patients) with a
 * visit whose window opens, or that was attended, in the range; only their visit items, projected whole.
 * Served by the unique index { tenantId, patientId, careType } (current plans); the item dates are filters.
 */
export function planVisitsPipeline({ tenantId, range, patientIds = null, limit = maxRows() }) {
  const inRange = { $gte: utcDay(range[0]), $lt: addDays(range[1], 1) };
  return [
    {
      $match: {
        tenantId,
        $and: [
          { careType: ANTENATAL, current: true, status: 'active' },
          ...(patientIds ? [{ patientId: { $in: patientIds } }] : []),
          {
            $or: [
              { items: { $elemMatch: { kind: 'visit', 'auto.dueFrom': inRange } } },
              { items: { $elemMatch: { kind: 'visit', 'done.on': inRange } } },
            ],
          },
        ],
      },
    },
    {
      $project: {
        patientId: 1,
        status: 1,
        eddReview: 1,
        'basis.edd': 1,
        items: { $filter: { input: '$items', cond: { $eq: ['$$this.kind', 'visit'] } } },
      },
    },
    { $limit: limit + 1 },
  ];
}

// Doctors' names (User is not hospital-scoped: looked up by id only, names only).
async function doctorNames(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const users = await User.find({ _id: { $in: unique } }, { name: 1 }).lean();
  return new Map(users.map((u) => [String(u._id), u.name]));
}
